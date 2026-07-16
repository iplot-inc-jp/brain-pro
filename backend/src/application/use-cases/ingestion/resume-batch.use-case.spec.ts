import { IngestionBatch, IngestionFile } from '../../../domain';
import { ResumeBatchUseCase } from './resume-batch.use-case';

describe('ResumeBatchUseCase paged hierarchy', () => {
  it('keeps a failed PDF on its existing parent while resuming the batch', async () => {
    const batch = IngestionBatch.create({ projectId: 'p1', name: 'batch', status: 'FAILED' }, 'batch-1');
    const file = IngestionFile.create(
      {
        batchId: batch.id,
        projectId: 'p1',
        sourceType: 'UPLOAD',
        filename: 'deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        blobUrl: 'blob://original',
        status: 'FAILED',
      },
      'file-1',
    );
    file.setJobId('parent-1');
    const batches = {
      findById: jest.fn(async () => batch),
      save: jest.fn(async () => undefined),
    };
    const files = {
      findByBatchId: jest.fn(async () => [file]),
      save: jest.fn(async () => undefined),
      setJobId: jest.fn(async () => undefined),
    };
    const jobs = {
      resumeIngestionParent: jest.fn(async () => ({ id: 'parent-1' })),
      enqueue: jest.fn(),
    };
    const useCase = new ResumeBatchUseCase(
      batches as never,
      files as never,
      { assertPrincipalAccess: jest.fn(async () => undefined) } as never,
      jobs as never,
    );

    await useCase.execute({
      id: batch.id,
      userId: 'u1',
      principal: { id: 'u1' },
    });

    expect(jobs.resumeIngestionParent).toHaveBeenCalledWith('parent-1', 'file-1', 'p1');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(files.setJobId).not.toHaveBeenCalled();
    expect(file.jobId).toBe('parent-1');
  });
});
