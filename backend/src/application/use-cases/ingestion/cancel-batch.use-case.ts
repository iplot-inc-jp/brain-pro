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

export interface CancelBatchInput {
  userId: string;
  id: string;
}

/**
 * キャンセルユースケース。
 * バッチを CANCELLED にし、未実行（PENDING）のファイルを SKIPPED にする。
 * 既に実行中/完了したファイルは尊重する（途中までの成果は残す）。
 */
@Injectable()
export class CancelBatchUseCase {
  constructor(
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: CancelBatchInput): Promise<IngestionBatchDetailOutput> {
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
    for (const file of files) {
      if (file.status === 'PENDING') {
        file.skip('バッチキャンセルによりスキップ');
        await this.fileRepository.save(file);
      }
    }

    batch.cancel();
    await this.batchRepository.save(batch);

    const updated = await this.fileRepository.findByBatchId(batch.id);
    return {
      ...toIngestionBatchOutput(batch),
      files: updated.map((f) => toIngestionFileOutput(f)),
    };
  }
}
