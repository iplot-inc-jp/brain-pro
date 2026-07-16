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
  const prisma: any = {
    backgroundJob: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => jobRow(data as Partial<BackgroundJob>)),
      findUnique: jest.fn<Promise<BackgroundJob | null>, [unknown]>(async () => null),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async ({ data }: { data: Partial<BackgroundJob> }) => jobRow(data)),
    },
    backgroundJobAttempt: {
      create: jest.fn(async () => ({ id: 'attempt-1' })),
      update: jest.fn(async () => ({ id: 'attempt-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    $executeRawUnsafe: jest.fn(async () => 1),
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
    resumePagedFile: jest.fn(async () => false),
    expandArchive: jest.fn(),
  };
  const importExternalMaterial = {
    verifyAndBatch: jest.fn(async () => ({
      importId: 'import-1',
      status: 'STORED',
    })),
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
    {} as never,
    importExternalMaterial as never,
  );
  return {
    service,
    prisma,
    qstash,
    knowledgeIngestion,
    importExternalMaterial,
  };
}

describe('JobService page ingestion jobs', () => {
  it('dispatches the durable external-material verifier with its claimed job id', async () => {
    const { service, importExternalMaterial } = makeService();

    await service['dispatch'](
      jobRow({
        id: 'verifier-1',
        type: 'KG_FINALIZE_EXTERNAL_MATERIAL',
        payload: { importId: 'import-1' },
      }),
    );

    expect(importExternalMaterial.verifyAndBatch).toHaveBeenCalledWith(
      'import-1',
      'verifier-1',
    );
  });

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

  it('recovers a completed file under a FAILED parent without rerunning file extraction', async () => {
    const { service, prisma, knowledgeIngestion } = makeService();
    const parent = jobRow({
      id: 'parent-1',
      type: 'KG_INGEST_FILE',
      status: 'FAILED',
      payload: { fileId: 'file-1' },
      parentJobId: null,
    });
    prisma.backgroundJob.findUnique
      .mockResolvedValueOnce(parent)
      .mockResolvedValueOnce(jobRow({ ...parent, status: 'RUNNING' }));
    const retry = jest.spyOn(service, 'retry');

    await service.resumeIngestionParent('parent-1', 'file-1', 'p1', true);

    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'parent-1', status: 'FAILED' },
        data: expect.objectContaining({ status: 'RUNNING' }),
      }),
    );
    expect(knowledgeIngestion.resumePagedFile).toHaveBeenCalledWith(
      'file-1',
      'parent-1',
    );
    expect(retry).not.toHaveBeenCalled();
    expect(knowledgeIngestion.processFile).not.toHaveBeenCalled();
  });

  it('reconciles a completed file when its parent is already SUCCEEDED', async () => {
    const { service, prisma, knowledgeIngestion } = makeService();
    const parent = jobRow({
      id: 'parent-1',
      type: 'KG_INGEST_FILE',
      status: 'SUCCEEDED',
      payload: { fileId: 'file-1' },
    });
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(parent);
    knowledgeIngestion.resumePagedFile.mockResolvedValueOnce(true);

    const result = await service.resumeIngestionParent(
      'parent-1', 'file-1', 'p1', true,
    );

    expect(knowledgeIngestion.resumePagedFile).toHaveBeenCalledWith('file-1', 'parent-1');
    expect(result).toEqual(expect.objectContaining({
      status: 'SUCCEEDED',
      recoveryTriggered: true,
    }));
    expect(knowledgeIngestion.processFile).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'atomically lets only one concurrent retry start (QStash=%s)',
    async (publishEnabled) => {
      const { service, prisma, qstash } = makeService();
      qstash.publishEnabled = publishEnabled;
      let state = jobRow({ id: 'failed-1', status: 'FAILED', attempts: 4 });
      prisma.backgroundJob.findUnique.mockImplementation(async () => ({ ...state }));
      prisma.backgroundJob.updateMany.mockImplementation((async ({ where, data }: {
        where: { status?: string };
        data: Partial<BackgroundJob>;
      }) => {
        if (where.status !== state.status) return { count: 0 };
        state = { ...state, ...data, status: 'QUEUED' } as BackgroundJob;
        return { count: 1 };
      }) as never);
      const runInline = jest
        .spyOn(service as unknown as { runInline(id: string): Promise<BackgroundJob> }, 'runInline')
        .mockResolvedValue(jobRow({ id: 'failed-1', status: 'SUCCEEDED' }));

      await Promise.all([service.retry('failed-1'), service.retry('failed-1')]);

      if (publishEnabled) {
        expect(qstash.publishJob).toHaveBeenCalledTimes(1);
        expect(runInline).not.toHaveBeenCalled();
      } else {
        expect(runInline).toHaveBeenCalledTimes(1);
        expect(qstash.publishJob).not.toHaveBeenCalled();
      }
    },
  );

  it('recovers only the exact stale RUNNING merge lease', async () => {
    const { service, prisma } = makeService();
    const startedAt = new Date('2026-07-16T00:00:00.000Z');
    prisma.backgroundJob.findUnique.mockResolvedValueOnce(
      jobRow({
        id: 'merge-1',
        type: 'KG_MERGE_INGEST_FILE',
        status: 'RUNNING',
        startedAt,
        payload: { fileId: 'file-1' },
      }),
    );
    const startReserved = jest
      .spyOn(service, 'startReserved')
      .mockResolvedValue(jobRow({ id: 'merge-1', status: 'QUEUED' }));

    await service.recoverStaleRunning('merge-1', 1);

    expect(prisma.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'merge-1', status: 'RUNNING', startedAt },
        data: expect.objectContaining({ status: 'QUEUED', startedAt: null }),
      }),
    );
    expect(prisma.backgroundJobAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'merge-1', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
    expect(startReserved).toHaveBeenCalledWith('merge-1');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      'knowledge-merge:file-1',
    );
  });

  it('keeps attempt numbers and retry budget advancing across repeated stale recoveries', async () => {
    const { service, prisma } = makeService();
    const first = new Date('2026-07-16T00:00:00.000Z');
    const second = new Date('2026-07-16T00:05:00.000Z');
    prisma.backgroundJob.findUnique
      .mockResolvedValueOnce(
        jobRow({ id: 'merge-1', status: 'RUNNING', startedAt: first, attempts: 0, maxAttempts: 4 }),
      )
      .mockResolvedValueOnce(
        jobRow({ id: 'merge-1', status: 'RUNNING', startedAt: second, attempts: 1, maxAttempts: 5 }),
      );
    jest.spyOn(service, 'startReserved').mockResolvedValue(
      jobRow({ id: 'merge-1', status: 'QUEUED' }),
    );

    await service.recoverStaleRunning('merge-1', 1);
    await service.recoverStaleRunning('merge-1', 1);

    expect(prisma.backgroundJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: { increment: 1 },
          maxAttempts: 5,
        }),
      }),
    );
    expect(prisma.backgroundJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          attempts: { increment: 1 },
          maxAttempts: 6,
        }),
      }),
    );
    expect(prisma.backgroundJobAttempt.updateMany).toHaveBeenCalledTimes(2);
  });

  it('fences completion with the exact RUNNING claim timestamp', async () => {
    const { service, prisma, knowledgeIngestion } = makeService();
    const queued = jobRow({
      id: 'merge-1',
      type: 'KG_MERGE_INGEST_FILE',
      payload: { fileId: 'file-1' },
    });
    prisma.backgroundJob.findUnique
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce(jobRow({ ...queued, status: 'SUCCEEDED' }));
    knowledgeIngestion.mergePagedFile.mockResolvedValueOnce({ knowledgeDocumentId: 'doc-1' });

    await service.runJob('merge-1');

    const claim = (prisma.backgroundJob.updateMany.mock.calls as unknown as Array<[
      { data: { startedAt: Date } },
    ]>)[0][0];
    expect(knowledgeIngestion.mergePagedFile).toHaveBeenCalledWith(
      'file-1',
      'merge-1',
      claim.data.startedAt,
    );
    expect(prisma.backgroundJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: 'merge-1',
          status: 'RUNNING',
          startedAt: claim.data.startedAt,
        },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
  });
});
