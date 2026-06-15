import { Inject, Injectable } from '@nestjs/common';
import {
  IngestionBatch,
  IngestionFile,
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  IProjectKnowledgeSettingsRepository,
  PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY,
  IngestionSourceTypeValue,
  ValidationError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { JobService } from '../../../infrastructure/services/job.service';
import {
  IngestionBatchDetailOutput,
  toIngestionBatchOutput,
  toIngestionFileOutput,
} from './ingestion-output';

/** バッチに含める1ファイルの指定（ソース正規化済み） */
export interface CreateIngestionFileSpec {
  sourceType: IngestionSourceTypeValue;
  sourceRef?: string | null;
  filename: string;
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  blobUrl?: string | null;
}

export interface CreateIngestionBatchInput {
  userId: string;
  projectId: string;
  /** 未指定（null/undefined）なら「取り込み <件数>件」を補完する。 */
  name?: string | null;
  files: CreateIngestionFileSpec[];
  options?: Record<string, unknown> | null;
}

// ProjectKnowledgeSettings 未作成プロジェクトの既定上限。
const DEFAULT_MAX_FILES_PER_BATCH = 200;

/** ZIP（アーカイブ）判定 — mimeType または拡張子で。 */
function isArchiveFile(spec: CreateIngestionFileSpec): boolean {
  const mime = (spec.mimeType ?? '').toLowerCase();
  if (
    mime.includes('zip') ||
    mime === 'application/x-zip-compressed' ||
    mime === 'application/x-zip'
  ) {
    return true;
  }
  return /\.zip$/i.test(spec.filename);
}

/**
 * 取り込みバッチ作成ユースケース。
 * ソース指定 → Batch＋File 群作成 → 各 File に Job を enqueue する。
 *   - 通常ファイル: KG_INGEST_FILE
 *   - ZIP（アーカイブ）: KG_EXPAND_ARCHIVE
 *   payload は { fileId }、opts に { projectId, createdById }。
 */
@Injectable()
export class CreateIngestionBatchUseCase {
  constructor(
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    @Inject(PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: IProjectKnowledgeSettingsRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly jobService: JobService,
  ) {}

  async execute(
    input: CreateIngestionBatchInput,
  ): Promise<IngestionBatchDetailOutput> {
    // 認可: 書込（バッチ作成 = 課金処理の起票）のため edit 強制
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'edit',
    );

    if (!input.files || input.files.length === 0) {
      throw new ValidationError('取り込むファイルが指定されていません');
    }

    // maxFilesPerBatch ガード（プロジェクト設定、無ければ既定 200）。
    // 上限超過は無音打ち切りにせず 400 で止める（上限と実数をメッセージに含める）。
    const settings = await this.settingsRepository.findByProjectId(
      input.projectId,
    );
    const maxFiles = settings?.maxFilesPerBatch ?? DEFAULT_MAX_FILES_PER_BATCH;
    if (input.files.length > maxFiles) {
      throw new ValidationError(
        `1バッチあたりのファイル数の上限（${maxFiles}件）を超えています（指定: ${input.files.length}件）`,
      );
    }

    // バッチ名: 未指定なら「取り込み <件数>件」を補完。
    const name =
      input.name && input.name.trim()
        ? input.name.trim()
        : `取り込み ${input.files.length}件`;

    // 1. バッチ生成（PENDING）。
    const batchId = this.batchRepository.generateId();
    const batch = IngestionBatch.create(
      {
        projectId: input.projectId,
        name,
        totalFiles: input.files.length,
        pendingFiles: input.files.length,
        options: input.options ?? null,
        createdById: input.userId,
      },
      batchId,
    );
    batch.markStarted();
    await this.batchRepository.save(batch);

    // 2. 各ソースを IngestionFile に正規化して一括登録。
    const files: IngestionFile[] = input.files.map((spec) =>
      IngestionFile.create(
        {
          batchId,
          projectId: input.projectId,
          sourceType: spec.sourceType,
          sourceRef: spec.sourceRef ?? null,
          filename: spec.filename,
          displayName: spec.displayName ?? null,
          mimeType: spec.mimeType ?? null,
          size: spec.size ?? null,
          blobUrl: spec.blobUrl ?? null,
          isArchive: isArchiveFile(spec),
        },
        this.fileRepository.generateId(),
      ),
    );
    await this.fileRepository.saveMany(files);

    // 3. 各 File に Job を enqueue（ZIP は展開ジョブ、通常は取り込みジョブ）。
    //    payload は fileId のみ（秘匿情報は載せない）。opts に projectId/createdById。
    for (const file of files) {
      const type = file.isArchive ? 'KG_EXPAND_ARCHIVE' : 'KG_INGEST_FILE';
      const job = await this.jobService.enqueue(
        type,
        { fileId: file.id },
        { projectId: input.projectId, createdById: input.userId },
      );
      // jobId だけ部分更新する。enqueue は inline 経路で processFile を同期実行し
      // DB の status を SUCCEEDED まで進めるため、ここで古い file を save すると巻き戻す。
      await this.fileRepository.setJobId(file.id, job.id);
    }

    // 4. 詳細を返却（作成直後の状態。実行は非同期/inline）。
    const savedFiles = await this.fileRepository.findByBatchId(batchId);
    const savedBatch = await this.batchRepository.findById(batchId);
    return {
      ...toIngestionBatchOutput(savedBatch ?? batch),
      files: savedFiles.map((f) => toIngestionFileOutput(f)),
    };
  }
}
