import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  IngestionFile,
  IngestionFileStatusValue,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { JobService } from '../../../infrastructure/services/job.service';
import {
  IngestionBatchDetailOutput,
  toIngestionBatchOutput,
  toIngestionFileOutput,
} from './ingestion-output';

export interface ResumeBatchInput {
  userId: string;
  id: string;
}

/** stale（落ちた）とみなす active 状態の updatedAt 超過閾値（ミリ秒）。 */
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

const ACTIVE_STATUSES: IngestionFileStatusValue[] = [
  'FETCHING',
  'EXPANDING',
  'PREPROCESSING',
  'EXTRACTING',
  'MERGING',
];

/**
 * 再開ユースケース。
 * バッチ内の PENDING / FAILED / stale active（updatedAt が閾値超過）のファイルを再 enqueue する。
 * MERGE が冪等なので安全。ZIP（isArchive）は KG_EXPAND_ARCHIVE、通常は KG_INGEST_FILE。
 */
@Injectable()
export class ResumeBatchUseCase {
  constructor(
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly jobService: JobService,
  ) {}

  private isResumable(file: IngestionFile, now: number): boolean {
    if (file.status === 'PENDING' || file.status === 'FAILED') return true;
    // stale active: active 状態のまま updatedAt が閾値超過 → 落ちたとみなす。
    if (ACTIVE_STATUSES.includes(file.status)) {
      return now - file.updatedAt.getTime() > STALE_THRESHOLD_MS;
    }
    return false;
  }

  async execute(input: ResumeBatchInput): Promise<IngestionBatchDetailOutput> {
    const batch = await this.batchRepository.findById(input.id);
    if (!batch) {
      throw new EntityNotFoundError('IngestionBatch', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      batch.projectId,
      input.userId,
      'edit',
    );

    const files = await this.fileRepository.findByBatchId(batch.id);
    const now = Date.now();

    for (const file of files) {
      if (!this.isResumable(file, now)) continue;
      file.requeue();
      await this.fileRepository.save(file);
      const type = file.isArchive ? 'KG_EXPAND_ARCHIVE' : 'KG_INGEST_FILE';
      const job = await this.jobService.enqueue(
        type,
        { fileId: file.id },
        { projectId: batch.projectId, createdById: input.userId },
      );
      file.setJobId(job.id);
      await this.fileRepository.save(file);
    }

    // バッチを RUNNING へ（CANCELLED から再開する場合も含め進行中扱い）。
    batch.markStarted();
    await this.batchRepository.save(batch);

    const updated = await this.fileRepository.findByBatchId(batch.id);
    return {
      ...toIngestionBatchOutput(batch),
      files: updated.map((f) => toIngestionFileOutput(f)),
    };
  }
}
