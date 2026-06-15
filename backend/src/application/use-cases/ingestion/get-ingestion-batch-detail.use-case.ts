import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  IngestionBatchDetailOutput,
  toIngestionBatchOutput,
  toIngestionFileOutput,
} from './ingestion-output';

export interface GetIngestionBatchDetailInput {
  userId: string;
  id: string;
}

/**
 * 取り込みバッチ詳細取得ユースケース（files 込み）。
 * id 指定（projectId はバッチから解決）→ assertProjectAccess('view')。
 */
@Injectable()
export class GetIngestionBatchDetailUseCase {
  constructor(
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: GetIngestionBatchDetailInput,
  ): Promise<IngestionBatchDetailOutput> {
    const batch = await this.batchRepository.findById(input.id);
    if (!batch) {
      throw new EntityNotFoundError('IngestionBatch', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      batch.projectId,
      input.userId,
      'view',
    );
    const files = await this.fileRepository.findByBatchId(batch.id);
    return {
      ...toIngestionBatchOutput(batch),
      files: files.map((f) => toIngestionFileOutput(f)),
    };
  }
}
