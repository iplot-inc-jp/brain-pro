import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EntityAlreadyExistsError, ValidationError } from '../../../domain';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { BlobStorageService } from '../../../infrastructure/services/blob-storage.service';
import { JobService } from '../../../infrastructure/services/job.service';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export const EXTERNAL_MATERIAL_MAX_FILE_BYTES = 50 * 1024 * 1024;

const PDF_MIME = 'application/pdf';
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_ID_LENGTH = 512;
const MAX_FILENAME_LENGTH = 255;

export interface ImportExternalMaterialInput {
  userId: string;
  principal: AccessPrincipal;
  projectId: string;
  idempotencyKey: string;
  sourcePlatform: string;
  sourceChannelId: string;
  sourceMessageId: string;
  sourceFileId: string;
  file: {
    filename: string;
    mimeType: string;
    size: number;
    bytes: Buffer;
  };
}

export interface ExternalMaterialResponse {
  importId: string;
  attachmentId: string;
  batchId: string;
  status: 'BATCHED';
}

interface NormalizedInput extends ImportExternalMaterialInput {
  idempotencyKey: string;
  sourcePlatform: 'line' | 'slack';
  sourceChannelId: string;
  sourceMessageId: string;
  sourceFileId: string;
  file: ImportExternalMaterialInput['file'] & {
    filename: string;
    mimeType: typeof PDF_MIME | typeof PPTX_MIME;
  };
  contentSha256: string;
}

interface ImportRow {
  id: string;
  projectId: string;
  idempotencyKey: string;
  attachmentId: string | null;
  ingestionBatchId: string | null;
  sourcePlatform: string;
  sourceChannelId: string;
  sourceMessageId: string;
  sourceFileId: string;
  filename: string | null;
  mimeType: string | null;
  size: number | null;
  contentSha256: string | null;
  status: 'PENDING' | 'STORED' | 'BATCHED' | 'FAILED';
  error: string | null;
}

interface ArtifactIds {
  attachmentId: string;
  batchId: string;
  fileId: string;
  jobId: string;
}

/**
 * LINE / Slack 原本を共有 Attachment とページ取り込みバッチへ一度だけ登録する。
 *
 * 外部 Blob 書込は DB transaction に含められないため、次の crash-safe な段階へ分ける。
 *  1. unique(projectId,idempotencyKey) 行へ内容 fingerprint を先に固定
 *  2. 決定的 Blob pathname へ保存し、決定的 Attachment ID を保存して STORED
 *  3. Batch / File / root Job を一つの transaction で upsert して BATCHED
 *  4. transaction 済み QUEUED job を開始（publish 失敗時は次の同一リクエストで再開）
 */
@Injectable()
export class ImportExternalMaterialUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobStorageService,
    private readonly projectAccess: ProjectAccessService,
    private readonly jobs: JobService,
  ) {}

  async execute(
    rawInput: ImportExternalMaterialInput,
  ): Promise<ExternalMaterialResponse> {
    await this.projectAccess.assertPrincipalAccess(
      rawInput.principal,
      rawInput.projectId,
      'edit',
    );
    const input = this.normalizeAndValidate(rawInput);
    let importRow = await this.getOrCreateImport(input);

    if (!importRow.attachmentId) {
      try {
        importRow = await this.storeOriginal(importRow, input);
      } catch (error) {
        await this.markFailed(importRow, error);
        throw error;
      }
    }

    let artifacts: ArtifactIds;
    try {
      artifacts = await this.ensureBatchArtifacts(importRow, input);
    } catch (error) {
      await this.markFailed(importRow, error);
      throw error;
    }

    // BATCHED is committed before transport publish. If publish fails, the same request
    // finds this exact QUEUED root and starts it; no second billable root can be created.
    await this.startOrResumeRoot(artifacts, input.projectId);

    return {
      importId: importRow.id,
      attachmentId: artifacts.attachmentId,
      batchId: artifacts.batchId,
      status: 'BATCHED',
    };
  }

  private normalizeAndValidate(
    input: ImportExternalMaterialInput,
  ): NormalizedInput {
    const projectId = this.required(
      input.projectId,
      'projectId',
      MAX_ID_LENGTH,
    );
    const idempotencyKey = this.required(
      input.idempotencyKey,
      'idempotencyKey',
      MAX_ID_LENGTH,
    );
    const sourceChannelId = this.required(
      input.sourceChannelId,
      'sourceChannelId',
      MAX_ID_LENGTH,
    );
    const sourceMessageId = this.required(
      input.sourceMessageId,
      'sourceMessageId',
      MAX_ID_LENGTH,
    );
    const sourceFileId = this.required(
      input.sourceFileId,
      'sourceFileId',
      MAX_ID_LENGTH,
    );
    const sourcePlatform = input.sourcePlatform?.trim().toLowerCase();
    if (sourcePlatform !== 'line' && sourcePlatform !== 'slack') {
      throw new ValidationError(
        'sourcePlatform は line または slack を指定してください',
      );
    }

    const filename = this.required(
      input.file?.filename,
      'filename',
      MAX_FILENAME_LENGTH,
    ).normalize('NFC');
    if (
      /[/\\\0\r\n]/u.test(filename) ||
      filename === '.' ||
      filename === '..'
    ) {
      throw new ValidationError('ファイル名が不正です');
    }
    const mimeType = input.file?.mimeType
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    const bytes = input.file?.bytes;
    const declaredSize = input.file?.size;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw new ValidationError('空のファイルは取り込めません');
    }
    if (
      !Number.isSafeInteger(declaredSize) ||
      declaredSize <= 0 ||
      declaredSize > EXTERNAL_MATERIAL_MAX_FILE_BYTES ||
      bytes.length > EXTERNAL_MATERIAL_MAX_FILE_BYTES
    ) {
      throw new ValidationError('ファイルサイズは50MB以下にしてください');
    }
    if (declaredSize !== bytes.length) {
      throw new ValidationError(
        '申告されたファイルサイズと実データが一致しません',
      );
    }

    const isPdf = filename.toLowerCase().endsWith('.pdf');
    const isPptx = filename.toLowerCase().endsWith('.pptx');
    if (!isPdf && !isPptx) {
      throw new ValidationError('PDF または PPTX ファイルだけ取り込めます');
    }
    if (isPdf && mimeType !== PDF_MIME) {
      throw new ValidationError('PDF の MIME タイプが一致しません');
    }
    if (isPptx && mimeType !== PPTX_MIME) {
      throw new ValidationError('PPTX の MIME タイプが一致しません');
    }
    if (isPdf && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new ValidationError('PDF のファイル署名が一致しません');
    }
    if (
      isPptx &&
      !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    ) {
      throw new ValidationError('PPTX のファイル署名が一致しません');
    }

    return {
      ...input,
      projectId,
      idempotencyKey,
      sourcePlatform,
      sourceChannelId,
      sourceMessageId,
      sourceFileId,
      file: {
        filename,
        mimeType: mimeType as typeof PDF_MIME | typeof PPTX_MIME,
        size: declaredSize,
        bytes,
      },
      contentSha256: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  private required(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new ValidationError(`${field} は必須です`);
    }
    const normalized = value.trim();
    if (normalized.length > max) {
      throw new ValidationError(`${field} が長すぎます`);
    }
    return normalized;
  }

  private async getOrCreateImport(input: NormalizedInput): Promise<ImportRow> {
    let row = (await this.prisma.externalMaterialImport.upsert({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      create: {
        id: randomUUID(),
        projectId: input.projectId,
        idempotencyKey: input.idempotencyKey,
        sourcePlatform: input.sourcePlatform,
        sourceChannelId: input.sourceChannelId,
        sourceMessageId: input.sourceMessageId,
        sourceFileId: input.sourceFileId,
        filename: input.file.filename,
        mimeType: input.file.mimeType,
        size: input.file.size,
        contentSha256: input.contentSha256,
      },
      update: {},
    })) as ImportRow;

    // Rollout-safe legacy binding: only an entirely unbound row can acquire a fingerprint.
    if (
      row.filename === null &&
      row.mimeType === null &&
      row.size === null &&
      row.contentSha256 === null
    ) {
      await this.prisma.externalMaterialImport.updateMany({
        where: {
          id: row.id,
          projectId: input.projectId,
          filename: null,
          mimeType: null,
          size: null,
          contentSha256: null,
        },
        data: {
          filename: input.file.filename,
          mimeType: input.file.mimeType,
          size: input.file.size,
          contentSha256: input.contentSha256,
        },
      });
      row = (await this.prisma.externalMaterialImport.findUnique({
        where: { id: row.id },
      })) as ImportRow;
    }

    this.assertSameRequest(row, input);
    return row;
  }

  private assertSameRequest(row: ImportRow, input: NormalizedInput): void {
    const matches =
      row.projectId === input.projectId &&
      row.idempotencyKey === input.idempotencyKey &&
      row.sourcePlatform.toLowerCase() === input.sourcePlatform &&
      row.sourceChannelId === input.sourceChannelId &&
      row.sourceMessageId === input.sourceMessageId &&
      row.sourceFileId === input.sourceFileId &&
      row.filename === input.file.filename &&
      row.mimeType?.toLowerCase() === input.file.mimeType &&
      row.size === input.file.size &&
      row.contentSha256 === input.contentSha256;
    if (!matches) {
      // The key can contain source identifiers. Keep it out of the HTTP conflict response.
      throw new EntityAlreadyExistsError(
        'ExternalMaterialImport',
        'idempotencyKey',
        '[redacted]',
      );
    }
  }

  private async storeOriginal(
    row: ImportRow,
    input: NormalizedInput,
  ): Promise<ImportRow> {
    const attachmentId = this.stableId('external_attachment', row.id);
    const saved = await this.blob.save(
      `external-materials/${input.projectId}/${row.id}/${this.safeFilename(input.file.filename)}`,
      input.file.bytes,
      input.file.mimeType,
      { stable: true },
    );

    const stored = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `external-material:${input.projectId}:${row.id}`,
      );
      const order = await tx.attachment.count({
        where: {
          projectId: input.projectId,
          phaseId: null,
          taskId: null,
          informationTypeId: null,
          flowId: null,
        },
      });
      const attachment = await tx.attachment.upsert({
        where: { id: attachmentId },
        create: {
          id: attachmentId,
          projectId: input.projectId,
          kind: input.file.mimeType === PDF_MIME ? 'PDF' : 'FILE',
          filename: input.file.filename,
          displayName: null,
          folder: 'LINE・Slack',
          mimeType: input.file.mimeType,
          url: `/api/attachments/${attachmentId}/file`,
          size: input.file.size,
          order,
          data: null,
          blobUrl: saved.url,
        },
        update: {},
      });
      if (
        attachment.projectId !== input.projectId ||
        attachment.filename !== input.file.filename ||
        attachment.mimeType !== input.file.mimeType ||
        attachment.size !== input.file.size ||
        attachment.blobUrl !== saved.url
      ) {
        throw new Error('External material attachment association is invalid');
      }
      await tx.externalMaterialImport.updateMany({
        where: { id: row.id, projectId: input.projectId, attachmentId: null },
        data: { attachmentId, status: 'STORED', error: null },
      });
      return tx.externalMaterialImport.findUnique({ where: { id: row.id } });
    });
    if (!stored || stored.projectId !== input.projectId) {
      throw new Error('External material import disappeared while storing');
    }
    if (stored.attachmentId !== attachmentId) {
      throw new Error(
        'External material import is already bound to another attachment',
      );
    }
    return stored as ImportRow;
  }

  private async ensureBatchArtifacts(
    row: ImportRow,
    input: NormalizedInput,
  ): Promise<ArtifactIds> {
    if (!row.attachmentId) {
      throw new Error('External material has not been stored');
    }
    const attachmentId = row.attachmentId;
    const batchId =
      row.ingestionBatchId ?? this.stableId('external_batch', row.id);
    const fileId = this.stableId('external_file', row.id);
    const jobId = this.stableId('external_root_job', row.id);
    const platformLabel = input.sourcePlatform === 'line' ? 'LINE' : 'Slack';

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `external-material:${input.projectId}:${row.id}`,
      );
      const attachment = await tx.attachment.findFirst({
        where: {
          id: attachmentId,
          projectId: input.projectId,
          filename: input.file.filename,
          mimeType: input.file.mimeType,
          size: input.file.size,
        },
      });
      if (!attachment) {
        throw new Error(
          'External material attachment is outside the project scope',
        );
      }
      const batch = await tx.ingestionBatch.upsert({
        where: { id: batchId },
        create: {
          id: batchId,
          projectId: input.projectId,
          name: `${platformLabel}資料: ${input.file.filename}`,
          status: 'RUNNING',
          totalFiles: 1,
          succeededFiles: 0,
          failedFiles: 0,
          pendingFiles: 1,
          options: Prisma.JsonNull,
          createdById: input.userId,
          startedAt: new Date(),
        },
        update: {},
      });
      if (batch.projectId !== input.projectId) {
        throw new Error('External material batch is outside the project scope');
      }
      const rootJob = await tx.backgroundJob.upsert({
        where: { id: jobId },
        create: {
          id: jobId,
          projectId: input.projectId,
          parentJobId: null,
          type: 'KG_INGEST_FILE',
          status: 'QUEUED',
          payload: { fileId },
          createdById: input.userId,
          maxAttempts: JobService.MAX_ATTEMPTS,
        },
        update: {},
      });
      const payload = (rootJob.payload ?? {}) as Record<string, unknown>;
      if (
        rootJob.projectId !== input.projectId ||
        rootJob.parentJobId !== null ||
        rootJob.type !== 'KG_INGEST_FILE' ||
        payload.fileId !== fileId
      ) {
        throw new Error('External material root job association is invalid');
      }
      const file = await tx.ingestionFile.upsert({
        where: { id: fileId },
        create: {
          id: fileId,
          batchId,
          projectId: input.projectId,
          sourceType: 'ATTACHMENT',
          sourceRef: attachmentId,
          filename: input.file.filename,
          displayName: input.file.filename,
          mimeType: input.file.mimeType,
          size: input.file.size,
          blobUrl: attachment.blobUrl,
          isArchive: false,
          status: 'PENDING',
          step: '開始待ち',
          progress: 0,
          maxAttempts: JobService.MAX_ATTEMPTS,
          jobId,
        },
        update: {},
      });
      if (
        file.projectId !== input.projectId ||
        file.batchId !== batchId ||
        file.sourceType !== 'ATTACHMENT' ||
        file.sourceRef !== attachmentId ||
        file.jobId !== jobId
      ) {
        throw new Error(
          'External material ingestion file association is invalid',
        );
      }
      const updated = await tx.externalMaterialImport.updateMany({
        where: {
          id: row.id,
          projectId: input.projectId,
          attachmentId,
          ingestionBatchId: row.ingestionBatchId,
        },
        data: { ingestionBatchId: batchId, status: 'BATCHED', error: null },
      });
      if (updated.count !== 1 && row.ingestionBatchId === null) {
        const current = await tx.externalMaterialImport.findUnique({
          where: { id: row.id },
        });
        if (current?.ingestionBatchId !== batchId) {
          throw new Error('External material import is bound to another batch');
        }
      }
    });

    return { attachmentId, batchId, fileId, jobId };
  }

  private async startOrResumeRoot(
    artifacts: ArtifactIds,
    projectId: string,
  ): Promise<void> {
    const job = await this.prisma.backgroundJob.findUnique({
      where: { id: artifacts.jobId },
    });
    if (!job || job.projectId !== projectId) {
      throw new Error(
        'External material root job was not found in the project',
      );
    }
    if (job.status === 'QUEUED') {
      await this.jobs.startReserved(job.id);
      return;
    }
    if (job.status === 'FAILED') {
      await this.jobs.resumeIngestionParent(
        job.id,
        artifacts.fileId,
        projectId,
      );
    }
  }

  private async markFailed(row: ImportRow, error: unknown): Promise<void> {
    const message = this.safeError(error);
    await this.prisma.externalMaterialImport.updateMany({
      where: {
        id: row.id,
        projectId: row.projectId,
        status: { in: ['PENDING', 'STORED', 'FAILED'] },
      },
      data: { status: 'FAILED', error: message },
    });
  }

  private safeError(error: unknown): string {
    const raw =
      error instanceof Error
        ? error.message
        : 'External material import failed';
    return raw
      .replace(/https?:\/\/\S+/giu, '[url redacted]')
      .replace(
        /(?:bearer|token|secret|api[-_ ]?key)\s*[:=]?\s*\S+/giu,
        '[secret redacted]',
      )
      .slice(0, 2000);
  }

  private stableId(kind: string, importId: string): string {
    return `${kind}_${createHash('sha256').update(`${kind}:${importId}`).digest('hex').slice(0, 40)}`;
  }

  private safeFilename(filename: string): string {
    return filename
      .replace(/[\u0000-\u001f\u007f/\\]/gu, '_')
      .replace(/\.\.+/gu, '_')
      .replace(/\s+/gu, '_')
      .slice(0, MAX_FILENAME_LENGTH);
  }
}
