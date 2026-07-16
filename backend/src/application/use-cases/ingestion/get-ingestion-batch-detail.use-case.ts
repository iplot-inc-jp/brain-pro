import { Inject, Injectable } from '@nestjs/common';
import {
  IIngestionBatchRepository,
  INGESTION_BATCH_REPOSITORY,
  IIngestionFileRepository,
  INGESTION_FILE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import {
  IngestionBatchDetailOutput,
  toIngestionBatchOutput,
  toIngestionFileOutput,
} from './ingestion-output';
import { KnowledgePageRepository } from '../../../infrastructure/knowledge/knowledge-page.repository';

export interface GetIngestionBatchDetailInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 取り込みバッチ詳細取得ユースケース（files 込み）。
 * id 指定（projectId はバッチから解決）→ assertPrincipalAccess('view')。
 */
@Injectable()
export class GetIngestionBatchDetailUseCase {
  constructor(
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepository: IIngestionBatchRepository,
    @Inject(INGESTION_FILE_REPOSITORY)
    private readonly fileRepository: IIngestionFileRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly pageRepository: KnowledgePageRepository,
  ) {}

  async execute(
    input: GetIngestionBatchDetailInput,
  ): Promise<IngestionBatchDetailOutput> {
    const batch = await this.batchRepository.findById(input.id);
    if (!batch) {
      throw new EntityNotFoundError('IngestionBatch', input.id);
    }
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      batch.projectId,
      'view',
    );
    const [files, pages] = await Promise.all([
      this.fileRepository.findByBatchId(batch.id),
      this.pageRepository.listForBatch({
        projectId: batch.projectId,
        batchId: batch.id,
      }),
    ]);
    const progressByFile = new Map<
      string,
      { succeeded: number; total: number; failedPageNumbers: number[] }
    >();
    for (const page of pages) {
      const progress = progressByFile.get(page.ingestionFileId) ?? {
        succeeded: 0,
        total: 0,
        failedPageNumbers: [],
      };
      progress.total += 1;
      if (page.status === 'SUCCEEDED') progress.succeeded += 1;
      if (page.status === 'FAILED') {
        progress.failedPageNumbers.push(page.pageNumber);
      }
      progressByFile.set(page.ingestionFileId, progress);
    }
    return {
      ...toIngestionBatchOutput(batch),
      files: files.map((file) => ({
        ...toIngestionFileOutput(file),
        pageProgress: progressByFile.get(file.id) ?? null,
      })),
    };
  }
}
