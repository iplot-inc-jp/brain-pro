import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  IngestionBatchOutput,
  toIngestionBatchOutput,
} from './ingestion-output';

export interface GetIngestionBatchesInput {
  userId: string;
  projectId: string;
}

/**
 * 取り込みバッチ一覧取得ユースケース（プロジェクト内、作成日降順）。
 */
@Injectable()
export class GetIngestionBatchesUseCase {
  constructor(
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: GetIngestionBatchesInput,
  ): Promise<IngestionBatchOutput[]> {
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'view',
    );
    const batches = await this.batchRepository.findByProjectId(input.projectId);
    return batches.map((b) => toIngestionBatchOutput(b));
  }
}
