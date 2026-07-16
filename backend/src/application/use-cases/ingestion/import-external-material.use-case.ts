import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { EntityAlreadyExistsError, ValidationError } from '../../../domain';
import {
  validatePdfStructure,
  validatePptxStructure,
} from '../../../infrastructure/knowledge/lib/document-pages';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { BlobStorageService } from '../../../infrastructure/services/blob-storage.service';
import { JobService } from '../../../infrastructure/services/job.service';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export const EXTERNAL_MATERIAL_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const EXTERNAL_MATERIAL_LEGACY_MAX_FILE_BYTES = 4 * 1024 * 1024;

const PDF_MIME = 'application/pdf';
const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const MAX_ID_LENGTH = 512;
const MAX_FILENAME_LENGTH = 255;

interface ExternalSourceInput {
  userId: string;
  principal: AccessPrincipal;
  projectId: string;
  idempotencyKey: string;
  sourcePlatform: string;
  sourceChannelId: string;
  sourceMessageId: string;
  sourceFileId: string;
}

export interface PrepareExternalMaterialInput extends ExternalSourceInput {
  file: {
    filename: string;
    mimeType: string;
    size: number;
    contentSha256: string;
  };
}

export interface ImportExternalMaterialInput extends ExternalSourceInput {
  file: {
    filename: string;
    mimeType: string;
    size: number;
    bytes: Buffer;
  };
}

export interface ExternalMaterialResponse {
  importId: string;
  attachmentId: string | null;
  batchId: string | null;
  verifierJobId: string | null;
  rootJobId: string | null;
  status: 'PENDING' | 'STORED' | 'BATCHED' | 'FAILED';
  error: string | null;
}

export interface PrepareExternalMaterialResponse extends ExternalMaterialResponse {
  upload: {
    uploadUrl: string;
    pathname: string;
    expiresAt: number;
  } | null;
}

interface NormalizedPrepareInput extends PrepareExternalMaterialInput {
  sourcePlatform: 'line' | 'slack';
  file: PrepareExternalMaterialInput['file'] & {
    mimeType: typeof PDF_MIME | typeof PPTX_MIME;
  };
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

@Injectable()
export class ImportExternalMaterialUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobStorageService,
    private readonly projectAccess: ProjectAccessService,
    @Inject(forwardRef(() => JobService))
    private readonly jobs: JobService,
  ) {}

  /** Bind the fingerprint before issuing an exact-path private upload URL. */
  async prepare(
    rawInput: PrepareExternalMaterialInput,
  ): Promise<PrepareExternalMaterialResponse> {
    await this.projectAccess.assertPrincipalAccess(
      rawInput.principal,
      rawInput.projectId,
      'edit',
    );
    const input = this.normalizePrepare(rawInput);
    let row = await this.getOrCreateImport(input);
    if (row.status === 'BATCHED' || row.status === 'STORED') {
      return { ...(await this.toResponse(row)), upload: null };
    }
    if (row.status === 'FAILED') {
      await this.prisma.externalMaterialImport.updateMany({
        where: { id: row.id, projectId: row.projectId, status: 'FAILED' },
        data: { status: 'PENDING', error: null },
      });
      row = { ...row, status: 'PENDING', error: null };
    }
    const upload = await this.blob.createPrivateUpload(
      this.pathname(row),
      input.file.mimeType,
      input.file.size,
    );
    return { ...(await this.toResponse(row)), upload };
  }

  /** HEAD only; expensive download/hash/OOXML parsing runs in the durable verifier. */
  async finalize(input: {
    userId: string;
    principal: AccessPrincipal;
    projectId: string;
    importId: string;
  }): Promise<ExternalMaterialResponse> {
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      input.projectId,
      'edit',
    );
    let row = await this.findImport(input.projectId, input.importId);
    if (row.status === 'BATCHED') {
      await this.ensureRootRecovery(row);
      return this.toResponse(row);
    }
    if (!row.filename || !row.mimeType || !row.size) {
      throw new ValidationError('資料メタデータが未登録です');
    }
    const metadata = await this.blob.headPrivate(this.pathname(row));
    if (
      metadata.pathname !== this.pathname(row) ||
      metadata.size !== row.size ||
      metadata.contentType?.toLowerCase() !== row.mimeType.toLowerCase()
    ) {
      throw new ValidationError('アップロード済みファイルの情報が一致しません');
    }

    const verifierJobId = this.verifierJobId(row.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `external-material:${row.projectId}:${row.id}`,
      );
      await tx.externalMaterialImport.updateMany({
        where: {
          id: row.id,
          projectId: row.projectId,
          status: { in: ['PENDING', 'FAILED', 'STORED'] },
        },
        data: { status: 'STORED', error: null },
      });
      const job = await tx.backgroundJob.upsert({
        where: { id: verifierJobId },
        create: {
          id: verifierJobId,
          projectId: row.projectId,
          parentJobId: null,
          type: 'KG_FINALIZE_EXTERNAL_MATERIAL',
          status: 'QUEUED',
          payload: { importId: row.id },
          createdById: input.userId,
          maxAttempts: JobService.MAX_ATTEMPTS,
        },
        update: {},
      });
      this.assertVerifierJob(job, row);
    });

    await this.startOrRecoverJob(verifierJobId);
    row = await this.findImport(input.projectId, input.importId);
    return this.toResponse(row);
  }

  async getStatus(input: {
    principal: AccessPrincipal;
    projectId: string;
    importId: string;
  }): Promise<ExternalMaterialResponse> {
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      input.projectId,
      'view',
    );
    return this.toResponse(
      await this.findImport(input.projectId, input.importId),
    );
  }

  async getDownload(input: {
    principal: AccessPrincipal;
    projectId: string;
    importId: string;
  }): Promise<{ downloadUrl: string; expiresAt: number }> {
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      input.projectId,
      'view',
    );
    const row = await this.findImport(input.projectId, input.importId);
    if (row.status !== 'STORED' && row.status !== 'BATCHED') {
      throw new ValidationError('資料はまだダウンロードできません');
    }
    return this.blob.createPrivateDownload(this.pathname(row));
  }

  /** Called only by JobService after its atomic QUEUED -> RUNNING claim. */
  async verifyAndBatch(
    importId: string,
    verifierJobId: string,
  ): Promise<ExternalMaterialResponse> {
    const row = (await this.prisma.externalMaterialImport.findUnique({
      where: { id: importId },
    })) as ImportRow | null;
    if (!row) throw new Error('External material import was not found');
    const verifier = await this.prisma.backgroundJob.findUnique({
      where: { id: verifierJobId },
    });
    this.assertVerifierJob(verifier, row);
    if (row.status === 'BATCHED') {
      await this.ensureRootRecovery(row);
      return this.toResponse(row);
    }
    if (
      row.status !== 'STORED' ||
      !row.filename ||
      !row.mimeType ||
      !row.size ||
      !row.contentSha256
    ) {
      throw new Error('External material is not ready for verification');
    }

    let bytes: Buffer;
    try {
      bytes = await this.blob.readPrivate(
        this.pathname(row),
        EXTERNAL_MATERIAL_MAX_FILE_BYTES,
      );
      if (bytes.length !== row.size) {
        throw new ValidationError('ファイルサイズが申告値と一致しません');
      }
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== row.contentSha256) {
        throw new ValidationError('ファイル内容のSHA-256が一致しません');
      }
      if (row.mimeType === PDF_MIME) {
        await validatePdfStructure(bytes);
      } else if (row.mimeType === PPTX_MIME) {
        validatePptxStructure(bytes);
      } else {
        throw new ValidationError('未対応の資料形式です');
      }
    } catch (error) {
      try {
        await this.blob.deletePrivate(this.pathname(row));
      } catch {
        // The import remains FAILED even when cleanup itself is unavailable.
      }
      await this.markFailed(row, error);
      throw error;
    }

    const reference = `private-blob:${this.pathname(row)}`;
    const artifacts = await this.ensureBatchArtifacts(
      row,
      verifier!.createdById ?? null,
      reference,
    );
    await this.startOrResumeRoot(artifacts, row.projectId);
    return this.toResponse(await this.findImport(row.projectId, row.id));
  }

  /** Deprecated server upload path. Kept only for <=4 MiB local/backcompat clients. */
  async execute(
    rawInput: ImportExternalMaterialInput,
  ): Promise<ExternalMaterialResponse> {
    if (
      !Buffer.isBuffer(rawInput.file?.bytes) ||
      rawInput.file.bytes.length === 0 ||
      rawInput.file.bytes.length > EXTERNAL_MATERIAL_LEGACY_MAX_FILE_BYTES
    ) {
      throw new ValidationError('従来アップロードは4MB以下にしてください');
    }
    const contentSha256 = createHash('sha256')
      .update(rawInput.file.bytes)
      .digest('hex');
    await this.projectAccess.assertPrincipalAccess(
      rawInput.principal,
      rawInput.projectId,
      'edit',
    );
    const normalized = this.normalizePrepare({
      ...rawInput,
      file: { ...rawInput.file, contentSha256 },
    });
    let row = await this.getOrCreateImport(normalized);
    if (row.status === 'BATCHED') {
      await this.ensureRootRecovery(row);
      return this.toResponse(row);
    }
    if (rawInput.file.bytes.length !== normalized.file.size) {
      throw new ValidationError(
        '申告されたファイルサイズと実データが一致しません',
      );
    }
    if (normalized.file.mimeType === PDF_MIME) {
      await validatePdfStructure(rawInput.file.bytes);
    } else {
      validatePptxStructure(rawInput.file.bytes);
    }
    const saved = await this.blob.savePrivate(
      this.pathname(row),
      rawInput.file.bytes,
      normalized.file.mimeType,
    );
    await this.prisma.externalMaterialImport.updateMany({
      where: { id: row.id, projectId: row.projectId },
      data: { status: 'STORED', error: null },
    });
    row = { ...row, status: 'STORED', error: null };
    const artifacts = await this.ensureBatchArtifacts(
      row,
      rawInput.userId,
      saved.reference,
    );
    await this.startOrResumeRoot(artifacts, row.projectId);
    return this.toResponse(await this.findImport(row.projectId, row.id));
  }

  private normalizePrepare(
    input: PrepareExternalMaterialInput,
  ): NormalizedPrepareInput {
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
    const size = input.file?.size;
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > EXTERNAL_MATERIAL_MAX_FILE_BYTES
    ) {
      throw new ValidationError('ファイルサイズは50MB以下にしてください');
    }
    const isPdf = filename.toLowerCase().endsWith('.pdf');
    const isPptx = filename.toLowerCase().endsWith('.pptx');
    if (!isPdf && !isPptx)
      throw new ValidationError('PDF または PPTX ファイルだけ取り込めます');
    if (
      (isPdf && mimeType !== PDF_MIME) ||
      (isPptx && mimeType !== PPTX_MIME)
    ) {
      throw new ValidationError('拡張子と MIME タイプが一致しません');
    }
    const contentSha256 = input.file?.contentSha256?.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/u.test(contentSha256 ?? '')) {
      throw new ValidationError(
        'contentSha256 は64桁のSHA-256（hex）で指定してください',
      );
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
        size,
        contentSha256,
      },
    };
  }

  private required(value: unknown, field: string, max: number): string {
    if (typeof value !== 'string' || !value.trim())
      throw new ValidationError(`${field} は必須です`);
    const normalized = value.trim();
    if (normalized.length > max)
      throw new ValidationError(`${field} が長すぎます`);
    return normalized;
  }

  private async getOrCreateImport(
    input: NormalizedPrepareInput,
  ): Promise<ImportRow> {
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
        contentSha256: input.file.contentSha256,
      },
      update: {},
    })) as ImportRow;
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
          contentSha256: input.file.contentSha256,
        },
      });
      row = (await this.prisma.externalMaterialImport.findUnique({
        where: { id: row.id },
      })) as ImportRow;
    }
    this.assertSameRequest(row, input);
    return row;
  }

  private assertSameRequest(
    row: ImportRow,
    input: NormalizedPrepareInput,
  ): void {
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
      row.contentSha256 === input.file.contentSha256;
    if (!matches)
      throw new EntityAlreadyExistsError(
        'ExternalMaterialImport',
        'idempotencyKey',
        '[redacted]',
      );
  }

  private async ensureBatchArtifacts(
    row: ImportRow,
    createdById: string | null,
    reference: string,
  ): Promise<ArtifactIds> {
    if (!row.filename || !row.mimeType || !row.size)
      throw new Error('External material metadata is missing');
    const filename = row.filename;
    const mimeType = row.mimeType;
    const size = row.size;
    const attachmentId =
      row.attachmentId ?? this.stableId('external_attachment', row.id);
    const batchId =
      row.ingestionBatchId ?? this.stableId('external_batch', row.id);
    const fileId = this.stableId('external_file', row.id);
    const jobId = this.stableId('external_root_job', row.id);
    const platformLabel =
      row.sourcePlatform.toLowerCase() === 'line' ? 'LINE' : 'Slack';
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        `external-material:${row.projectId}:${row.id}`,
      );
      const order = await tx.attachment.count({
        where: {
          projectId: row.projectId,
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
          projectId: row.projectId,
          kind: mimeType === PDF_MIME ? 'PDF' : 'FILE',
          filename,
          displayName: null,
          folder: 'LINE・Slack',
          mimeType,
          url: `/api/projects/${row.projectId}/external-materials/${row.id}/download-url`,
          size,
          order,
          data: null,
          blobUrl: reference,
        },
        update: {},
      });
      if (
        attachment.projectId !== row.projectId ||
        attachment.blobUrl !== reference
      )
        throw new Error('External material attachment association is invalid');
      const batch = await tx.ingestionBatch.upsert({
        where: { id: batchId },
        create: {
          id: batchId,
          projectId: row.projectId,
          name: `${platformLabel}資料: ${filename}`,
          status: 'RUNNING',
          totalFiles: 1,
          succeededFiles: 0,
          failedFiles: 0,
          pendingFiles: 1,
          options: Prisma.JsonNull,
          createdById,
          startedAt: new Date(),
        },
        update: {},
      });
      if (batch.projectId !== row.projectId)
        throw new Error('External material batch is outside the project scope');
      const rootJob = await tx.backgroundJob.upsert({
        where: { id: jobId },
        create: {
          id: jobId,
          projectId: row.projectId,
          parentJobId: null,
          type: 'KG_INGEST_FILE',
          status: 'QUEUED',
          payload: { fileId },
          createdById,
          maxAttempts: JobService.MAX_ATTEMPTS,
        },
        update: {},
      });
      const payload = (rootJob.payload ?? {}) as Record<string, unknown>;
      if (
        rootJob.projectId !== row.projectId ||
        rootJob.parentJobId !== null ||
        rootJob.type !== 'KG_INGEST_FILE' ||
        payload.fileId !== fileId
      )
        throw new Error('External material root job association is invalid');
      const file = await tx.ingestionFile.upsert({
        where: { id: fileId },
        create: {
          id: fileId,
          batchId,
          projectId: row.projectId,
          sourceType: 'ATTACHMENT',
          sourceRef: attachmentId,
          filename,
          displayName: filename,
          mimeType,
          size,
          blobUrl: reference,
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
        file.projectId !== row.projectId ||
        file.batchId !== batchId ||
        file.jobId !== jobId
      )
        throw new Error(
          'External material ingestion file association is invalid',
        );
      await tx.externalMaterialImport.updateMany({
        where: {
          id: row.id,
          projectId: row.projectId,
          status: { in: ['STORED', 'BATCHED'] },
        },
        data: {
          attachmentId,
          ingestionBatchId: batchId,
          status: 'BATCHED',
          error: null,
        },
      });
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
    if (!job || job.projectId !== projectId)
      throw new Error(
        'External material root job was not found in the project',
      );
    if (job.status === 'QUEUED')
      return void (await this.jobs.startReserved(job.id));
    if (job.status === 'FAILED')
      return void (await this.jobs.resumeIngestionParent(
        job.id,
        artifacts.fileId,
        projectId,
      ));
    if (job.status === 'RUNNING') {
      const recovered = await this.jobs.recoverStaleRunning(job.id);
      if (!recovered.recoveryTriggered)
        await this.jobs.resumeIngestionParent(
          job.id,
          artifacts.fileId,
          projectId,
        );
    }
  }

  private async ensureRootRecovery(row: ImportRow): Promise<void> {
    if (!row.ingestionBatchId) return;
    await this.startOrResumeRoot(
      {
        attachmentId:
          row.attachmentId ?? this.stableId('external_attachment', row.id),
        batchId: row.ingestionBatchId,
        fileId: this.stableId('external_file', row.id),
        jobId: this.rootJobId(row.id),
      },
      row.projectId,
    );
  }

  private async startOrRecoverJob(jobId: string): Promise<void> {
    const job = await this.prisma.backgroundJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new Error('External material verifier job was not found');
    if (job.status === 'QUEUED') await this.jobs.startReserved(job.id);
    else if (job.status === 'FAILED') await this.jobs.retry(job.id);
    else if (job.status === 'RUNNING')
      await this.jobs.recoverStaleRunning(job.id);
  }

  private assertVerifierJob(job: any, row: ImportRow): void {
    const payload = (job?.payload ?? {}) as Record<string, unknown>;
    if (
      !job ||
      job.id !== this.verifierJobId(row.id) ||
      job.projectId !== row.projectId ||
      job.parentJobId !== null ||
      job.type !== 'KG_FINALIZE_EXTERNAL_MATERIAL' ||
      payload.importId !== row.id
    ) {
      throw new Error('External material verifier job association is invalid');
    }
  }

  private async findImport(
    projectId: string,
    importId: string,
  ): Promise<ImportRow> {
    const row = (await this.prisma.externalMaterialImport.findUnique({
      where: { id: importId },
    })) as ImportRow | null;
    if (!row || row.projectId !== projectId)
      throw new ValidationError('外部資料が見つかりません');
    return row;
  }

  private async toResponse(row: ImportRow): Promise<ExternalMaterialResponse> {
    const verifierJobId = this.verifierJobId(row.id);
    const rootJobId = this.rootJobId(row.id);
    const [verifier, root] = await Promise.all([
      this.prisma.backgroundJob.findUnique({ where: { id: verifierJobId } }),
      this.prisma.backgroundJob.findUnique({ where: { id: rootJobId } }),
    ]);
    return {
      importId: row.id,
      attachmentId: row.attachmentId,
      batchId: row.ingestionBatchId,
      verifierJobId: verifier?.id ?? null,
      rootJobId: root?.id ?? null,
      status: row.status,
      error: row.error,
    };
  }

  private async markFailed(row: ImportRow, error: unknown): Promise<void> {
    await this.prisma.externalMaterialImport.updateMany({
      where: {
        id: row.id,
        projectId: row.projectId,
        status: { in: ['PENDING', 'STORED', 'FAILED'] },
      },
      data: { status: 'FAILED', error: this.safeError(error) },
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

  private pathname(
    row: Pick<ImportRow, 'projectId' | 'id' | 'filename'>,
  ): string {
    if (!row.filename) throw new Error('External material filename is missing');
    return `external-materials/${row.projectId}/${row.id}/${this.safeFilename(row.filename)}`;
  }

  private verifierJobId(importId: string): string {
    return this.stableId('external_verifier_job', importId);
  }

  private rootJobId(importId: string): string {
    return this.stableId('external_root_job', importId);
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
