import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { JobService } from '../../../infrastructure/services/job.service';
import {
  IngestionFileOutput,
  toIngestionFileOutput,
} from './ingestion-output';

export interface RetryFileInput {
  userId: string;
  id: string;
}

/**
 * 個別ファイルの手動リトライ。
 * 当該ファイルを PENDING に戻し、ジョブを再投入する（attempts は保持＝試行履歴を残す）。
 * MERGE が冪等なので安全。ZIP（isArchive）は KG_EXPAND_ARCHIVE、通常は KG_INGEST_FILE。
 */
@Injectable()
export class RetryFileUseCase {
  constructor(
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly jobService: JobService,
  ) {}

  async execute(input: RetryFileInput): Promise<IngestionFileOutput> {
    const file = await this.fileRepository.findById(input.id);
    if (!file) {
      throw new EntityNotFoundError('IngestionFile', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      file.projectId,
      input.userId,
      'edit',
    );

    file.requeue();
    await this.fileRepository.save(file);

    const type = file.isArchive ? 'KG_EXPAND_ARCHIVE' : 'KG_INGEST_FILE';
    const job = await this.jobService.enqueue(
      type,
      { fileId: file.id },
      { projectId: file.projectId, createdById: input.userId },
    );
    file.setJobId(job.id);
    await this.fileRepository.save(file);

    return toIngestionFileOutput(file);
  }
}
