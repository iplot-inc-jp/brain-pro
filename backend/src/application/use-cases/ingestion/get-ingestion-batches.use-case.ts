import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import {
  IngestionBatchOutput,
  toIngestionBatchOutput,
} from './ingestion-output';

export interface GetIngestionBatchesInput {
  userId: string;
  principal: AccessPrincipal;
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
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      input.projectId,
      'view',
    );
    const batches = await this.batchRepository.findByProjectId(input.projectId);
    return batches.map((b) => toIngestionBatchOutput(b));
  }
}
