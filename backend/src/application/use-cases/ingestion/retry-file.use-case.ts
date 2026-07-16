import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import { JobService } from '../../../infrastructure/services/job.service';
import {
  IngestionFileOutput,
  toIngestionFileOutput,
} from './ingestion-output';

export interface RetryFileInput {
  userId: string;
  principal: AccessPrincipal;
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
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      file.projectId,
      'edit',
    );

    // 成功済み資料は確定成果物を保持する。再試行で新rootや再課金を発生させない。
    if (file.status === 'SUCCEEDED') {
      return toIngestionFileOutput(file);
    }

    file.requeue();
    await this.fileRepository.save(file);

    if (this.isPaged(file) && file.jobId) {
      const resumed = await this.jobService.resumeIngestionParent(
        file.jobId,
        file.id,
        file.projectId,
      );
      if (resumed) {
        const refreshed = await this.fileRepository.findById(file.id);
        return toIngestionFileOutput(refreshed ?? file);
      }
    }

    const type = file.isArchive ? 'KG_EXPAND_ARCHIVE' : 'KG_INGEST_FILE';
    const job = await this.jobService.enqueue(
      type,
      { fileId: file.id },
      { projectId: file.projectId, createdById: input.userId },
    );
    // enqueue のinline経路がstatusを終端済みでも、古いPENDING entityのfull saveで巻き戻さない。
    await this.fileRepository.setJobId(file.id, job.id);
    file.setJobId(job.id);

    const refreshed = await this.fileRepository.findById(file.id);
    return toIngestionFileOutput(refreshed ?? file);
  }

  private isPaged(file: { filename: string; mimeType: string | null }): boolean {
    return (
      /\.(pdf|pptx)$/i.test(file.filename) ||
      /application\/pdf|presentationml\.presentation/i.test(file.mimeType ?? '')
    );
  }
}
