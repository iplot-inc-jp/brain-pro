import { IngestionBatch, IngestionFile } from '../../../domain';
import { GetIngestionBatchDetailUseCase } from './get-ingestion-batch-detail.use-case';

describe('GetIngestionBatchDetailUseCase page progress', () => {
  it('groups one batch-scoped page query into per-file progress', async () => {
    const batch = IngestionBatch.create(
      { projectId: 'project-1', name: '資料取り込み', totalFiles: 2 },
      'batch-1',
    );
    const paged = IngestionFile.create(
      {
        batchId: 'batch-1',
        projectId: 'project-1',
        sourceType: 'UPLOAD',
        filename: 'deck.pdf',
      },
      'file-1',
    );
    const ordinary = IngestionFile.create(
      {
        batchId: 'batch-1',
        projectId: 'project-1',
        sourceType: 'UPLOAD',
        filename: 'notes.txt',
      },
      'file-2',
    );
    const pageRepository = {
      listForBatch: jest.fn(async () => [
        { ingestionFileId: 'file-1', pageNumber: 1, status: 'SUCCEEDED' },
        { ingestionFileId: 'file-1', pageNumber: 2, status: 'FAILED' },
        { ingestionFileId: 'file-1', pageNumber: 3, status: 'PENDING' },
      ]),
    };
    const useCase = new GetIngestionBatchDetailUseCase(
      { findById: jest.fn(async () => batch) } as never,
      { findByBatchId: jest.fn(async () => [paged, ordinary]) } as never,
      { assertPrincipalAccess: jest.fn(async () => undefined) } as never,
      pageRepository as never,
    );

    const result = await useCase.execute({
      id: 'batch-1',
      userId: 'u1',
      principal: { id: 'u1' } as never,
    });

    expect(pageRepository.listForBatch).toHaveBeenCalledTimes(1);
    expect(pageRepository.listForBatch).toHaveBeenCalledWith({
      projectId: 'project-1',
      batchId: 'batch-1',
    });
    expect(result.files[0].pageProgress).toEqual({
      succeeded: 1,
      total: 3,
      failedPageNumbers: [2],
    });
    expect(result.files[1].pageProgress).toBeNull();
  });
});
