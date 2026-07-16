import type { BackgroundJob } from '@prisma/client';
import { JobService } from './job.service';

const jobRow = (overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'job-1',
  projectId: 'p1',
  parentJobId: null,
  type: 'KG_INGEST_PAGE',
  status: 'QUEUED',
  payload: { pageId: 'page-1' },
  result: null,
  error: null,
  progress: 0,
  attempts: 0,
  maxAttempts: 4,
  createdById: 'u1',
  createdAt: new Date('2026-07-16T00:00:00.000Z'),
  updatedAt: new Date('2026-07-16T00:00:00.000Z'),
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

function makeService() {
  const prisma = {
    backgroundJob: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => jobRow(data as Partial<BackgroundJob>)),
      findUnique: jest.fn<Promise<BackgroundJob | null>, [unknown]>(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: { data: Partial<BackgroundJob> }) => jobRow(data)),
    },
    backgroundJobAttempt: {
      create: jest.fn(async () => ({ id: 'attempt-1' })),
      update: jest.fn(async () => ({ id: 'attempt-1' })),
    },
  };
  const qstash = {
    publishEnabled: true,
    publishJob: jest.fn(async () => undefined),
  };
  const knowledgeIngestion = {
    processFile: jest.fn(async () => ({ deferred: true })),
    processPage: jest.fn(async () => ({ merged: false })),
    mergePagedFile: jest.fn(async () => ({ knowledgeDocumentId: 'doc-1' })),
    handlePageJobTerminalFailure: jest.fn(async () => undefined),
    resumePagedFile: jest.fn(async () => undefined),
    expandArchive: jest.fn(),
  };
  const service = new JobService(
    prisma as never,
    qstash as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    knowledgeIngestion as never,
  );
  return { service, prisma, qstash, knowledgeIngestion };
}

describe('JobService page ingestion jobs', () => {
  it('persists parentJobId when enqueueing a child page job', async () => {
    const { service, prisma } = makeService();

    await service.enqueue(
      'KG_INGEST_PAGE',
      { pageId: 'page-1' },
      { projectId: 'p1', createdById: 'u1', parentJobId: 'parent-1' },
    );

    expect(prisma.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ parentJobId: 'parent-1' }),
    });
  });

  it('passes the executing job id to file, page and merge handlers', async () => {
    const { service, knowledgeIngestion } = makeService();

    await service['dispatch'](
      jobRow({
        id: 'parent-1',
        type: 'KG_INGEST_FILE',
        payload: { fileId: 'file-1' },
      }),
    );
    await service['dispatch'](
      jobRow({
        id: 'child-1',
        type: 'KG_INGEST_PAGE',
        payload: { pageId: 'page-1' },
      }),
    );
    await service['dispatch'](
      jobRow({
        id: 'merge-1',
        type: 'KG_MERGE_INGEST_FILE',
        payload: { fileId: 'file-1' },
      }),
    );

    expect(knowledgeIngestion.processFile).toHaveBeenCalledWith('file-1', 'parent-1');
    expect(knowledgeIngestion.processPage).toHaveBeenCalledWith('page-1', 'child-1');
    expect(knowledgeIngestion.mergePagedFile).toHaveBeenCalledWith('file-1', 'merge-1');
  });

  it('uses a deterministic job id to atomically deduplicate merge enqueue races', async () => {
    const { service, prisma, qstash } = makeService();
    const existing = jobRow({
      id: 'stable-merge-id',
      type: 'KG_MERGE_INGEST_FILE',
      payload: { fileId: 'file-1' },
    });
    prisma.backgroundJob.create.mockResolvedValueOnce(existing).mockRejectedValueOnce({ code: 'P2002' });
    prisma.backgroundJob.findUnique.mockResolvedValue(existing);

    const [first, second] = await Promise.all([
      service.enqueue('KG_MERGE_INGEST_FILE', { fileId: 'file-1' }, { projectId: 'p1', dedupeId: 'stable-merge-id' }),
      service.enqueue('KG_MERGE_INGEST_FILE', { fileId: 'file-1' }, { projectId: 'p1', dedupeId: 'stable-merge-id' }),
    ]);

    expect(first.id).toBe('stable-merge-id');
    expect(second.id).toBe('stable-merge-id');
    expect(qstash.publishJob).toHaveBeenCalledTimes(1);
  });

  it('retries a matching failed merge claim instead of stranding the file', async () => {
    const { service, prisma } = makeService();
    const failed = jobRow({
      id: 'stable-merge-id',
      type: 'KG_MERGE_INGEST_FILE',
      status: 'FAILED',
      parentJobId: 'parent-1',
      payload: { fileId: 'file-1' },
    });
    prisma.backgroundJob.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(failed);
    const retry = jest.spyOn(service, 'retry').mockResolvedValue(failed);

    await service.enqueue(
      'KG_MERGE_INGEST_FILE',
      { fileId: 'file-1' },
      {
        projectId: 'p1',
        parentJobId: 'parent-1',
        dedupeId: 'stable-merge-id',
      },
    );

    expect(retry).toHaveBeenCalledWith('stable-merge-id');
  });

  it('rejects a dedupe id collision with another parent identity', async () => {
    const { service, prisma } = makeService();
    prisma.backgroundJob.create.mockRejectedValueOnce({ code: 'P2002' });
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(
      jobRow({
        id: 'collision',
        type: 'KG_MERGE_INGEST_FILE',
        parentJobId: 'other-parent',
        payload: { fileId: 'file-1' },
      }),
    );

    await expect(
      service.enqueue(
        'KG_MERGE_INGEST_FILE',
        { fileId: 'file-1' },
        { projectId: 'p1', parentJobId: 'parent-1', dedupeId: 'collision' },
      ),
    ).rejects.toThrow('belongs to another job');
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'does not overwrite an inline-finalized %s parent after deferred fan-out returns',
    async (terminalStatus) => {
      const { service, prisma } = makeService();
      const parent = jobRow({
        id: 'parent-1',
        type: 'KG_INGEST_FILE',
        status: 'QUEUED',
        payload: { fileId: 'file-1' },
        parentJobId: null,
      });
      prisma.backgroundJob.findUnique
        .mockResolvedValueOnce(parent)
        .mockResolvedValueOnce(jobRow({ ...parent, status: terminalStatus }));
      prisma.backgroundJob.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      const result = await service.runJob('parent-1');

      expect(result.status).toBe(terminalStatus);
      expect(prisma.backgroundJob.update).not.toHaveBeenCalled();
    },
  );

  it('replenishes the rolling page window only after a child is permanently failed', async () => {
    const { service, prisma, knowledgeIngestion } = makeService();
    const child = jobRow({
      id: 'child-1',
      type: 'KG_INGEST_PAGE',
      status: 'QUEUED',
      maxAttempts: 1,
      payload: { pageId: 'page-1' },
      parentJobId: 'parent-1',
    });
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(child);
    prisma.backgroundJob.update.mockResolvedValueOnce(jobRow({ ...child, status: 'FAILED' }));
    knowledgeIngestion.processPage.mockRejectedValueOnce(new Error('permanent'));

    await service.runJob('child-1');

    expect(knowledgeIngestion.handlePageJobTerminalFailure).toHaveBeenCalledWith('page-1', 'child-1');
  });

  it('resumes a running paged file under its existing parent hierarchy', async () => {
    const { service, prisma, knowledgeIngestion } = makeService();
    const parent = jobRow({
      id: 'parent-1',
      type: 'KG_INGEST_FILE',
      status: 'RUNNING',
      payload: { fileId: 'file-1' },
      parentJobId: null,
    });
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(parent);

    const result = await service.resumeIngestionParent('parent-1', 'file-1', 'p1');

    expect(result?.id).toBe('parent-1');
    expect(knowledgeIngestion.resumePagedFile).toHaveBeenCalledWith('file-1', 'parent-1');
  });

  it('retries the existing failed parent instead of creating a replacement root', async () => {
    const { service, prisma } = makeService();
    const parent = jobRow({
      id: 'parent-1',
      type: 'KG_INGEST_FILE',
      status: 'FAILED',
      payload: { fileId: 'file-1' },
      parentJobId: null,
    });
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(parent);
    const retry = jest.spyOn(service, 'retry').mockResolvedValue(parent);

    const result = await service.resumeIngestionParent('parent-1', 'file-1', 'p1');

    expect(result?.id).toBe('parent-1');
    expect(retry).toHaveBeenCalledWith('parent-1');
  });
});
