import { IngestionFile } from '../../../domain';
import { RetryFileUseCase } from './retry-file.use-case';

function pagedFile() {
  const file = IngestionFile.create(
    {
      batchId: 'batch-1',
      projectId: 'p1',
      sourceType: 'UPLOAD',
      filename: 'deck.pdf',
      mimeType: 'application/pdf',
      blobUrl: 'blob://original',
      status: 'FAILED',
    },
    'file-1',
  );
  file.setJobId('parent-1');
  return file;
}

describe('RetryFileUseCase paged hierarchy', () => {
  it('is a no-op for a successful file and never creates another root', async () => {
    const file = pagedFile();
    file.update({ status: 'SUCCEEDED', progress: 100 });
    const files = {
      findById: jest.fn(async () => file),
      save: jest.fn(),
      setJobId: jest.fn(),
    };
    const jobs = {
      resumeIngestionParent: jest.fn(),
      enqueue: jest.fn(),
    };
    const useCase = new RetryFileUseCase(
      files as never,
      { assertPrincipalAccess: jest.fn(async () => undefined) } as never,
      jobs as never,
    );

    const result = await useCase.execute({
      id: 'file-1',
      userId: 'u1',
      principal: { id: 'u1' },
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(files.save).not.toHaveBeenCalled();
    expect(jobs.resumeIngestionParent).toHaveBeenCalledWith(
      'parent-1',
      'file-1',
      'p1',
      true,
    );
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('resumes the existing PDF parent and keeps its child hierarchy', async () => {
    const file = pagedFile();
    const files = {
      findById: jest.fn(async () => file),
      save: jest.fn(async () => undefined),
      setJobId: jest.fn(async () => undefined),
    };
    const jobs = {
      resumeIngestionParent: jest.fn(async () => ({ id: 'parent-1' })),
      enqueue: jest.fn(),
    };
    const useCase = new RetryFileUseCase(
      files as never,
      { assertPrincipalAccess: jest.fn(async () => undefined) } as never,
      jobs as never,
    );

    await useCase.execute({
      id: 'file-1',
      userId: 'u1',
      principal: { id: 'u1' },
    });

    expect(jobs.resumeIngestionParent).toHaveBeenCalledWith('parent-1', 'file-1', 'p1');
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect(files.setJobId).not.toHaveBeenCalled();
    expect(file.jobId).toBe('parent-1');
  });

  it('uses a partial jobId update for a new root so inline completion is not rolled back', async () => {
    const file = pagedFile();
    file.update({ jobId: null });
    const files = {
      findById: jest.fn(async () => file),
      save: jest.fn(async () => undefined),
      setJobId: jest.fn(async () => undefined),
    };
    const jobs = {
      resumeIngestionParent: jest.fn(),
      enqueue: jest.fn(async () => ({ id: 'new-parent' })),
    };
    const useCase = new RetryFileUseCase(
      files as never,
      { assertPrincipalAccess: jest.fn(async () => undefined) } as never,
      jobs as never,
    );

    await useCase.execute({
      id: 'file-1',
      userId: 'u1',
      principal: { id: 'u1' },
    });

    expect(files.setJobId).toHaveBeenCalledWith('file-1', 'new-parent');
    expect(files.save).toHaveBeenCalledTimes(1);
  });
});
