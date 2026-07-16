import {
  KnowledgeDocumentPage,
  Prisma,
} from '@prisma/client';
import { KnowledgePageRepository } from './knowledge-page.repository';

const pageRow: KnowledgeDocumentPage = {
  id: 'page-1',
  projectId: 'p1',
  ingestionFileId: 'f1',
  knowledgeDocumentId: 'd1',
  pageNumber: 2,
  pageKind: 'PDF_PAGE',
  sourceText: null,
  sourceBlobUrl: 'blob://page-2',
  contentText: null,
  summary: null,
  extractionResult: null,
  status: 'PENDING',
  attempts: 3,
  error: null,
  jobId: null,
  createdAt: new Date('2026-07-16T00:00:00.000Z'),
  updatedAt: new Date('2026-07-16T00:00:00.000Z'),
};

interface MockOptions {
  existingPage?: KnowledgeDocumentPage | null;
  racedPage?: KnowledgeDocumentPage | null;
  createResult?: KnowledgeDocumentPage;
  createError?: unknown;
  updateCount?: number;
  ingestionFileExists?: boolean;
  knowledgeDocumentExists?: boolean;
  knowledgeDocumentIngestionFileId?: string;
  backgroundJobExists?: boolean;
  totalCount?: number;
  remainingCount?: number;
  rows?: KnowledgeDocumentPage[];
}

function makePrisma({
  existingPage = null,
  racedPage = pageRow,
  createResult = pageRow,
  createError,
  updateCount = 1,
  ingestionFileExists = true,
  knowledgeDocumentExists = true,
  knowledgeDocumentIngestionFileId = 'f1',
  backgroundJobExists = true,
  totalCount = 1,
  remainingCount = 0,
  rows = [],
}: MockOptions = {}) {
  let findUniqueCalls = 0;
  return {
    knowledgeDocumentPage: {
      findFirst: jest.fn<
        Promise<KnowledgeDocumentPage | null>,
        [Prisma.KnowledgeDocumentPageFindFirstArgs]
      >(async () => existingPage),
      findUnique: jest.fn<
        Promise<KnowledgeDocumentPage | null>,
        [Prisma.KnowledgeDocumentPageFindUniqueArgs]
      >(async () => (findUniqueCalls++ === 0 ? existingPage : racedPage)),
      create: jest.fn<
        Promise<KnowledgeDocumentPage>,
        [Prisma.KnowledgeDocumentPageCreateArgs]
      >(async () => {
        if (createError) throw createError;
        return createResult;
      }),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.KnowledgeDocumentPageUpdateManyArgs]
      >(async () => ({ count: updateCount })),
      findMany: jest.fn<
        Promise<KnowledgeDocumentPage[]>,
        [Prisma.KnowledgeDocumentPageFindManyArgs]
      >(async () => rows),
      count: jest.fn<
        Promise<number>,
        [Prisma.KnowledgeDocumentPageCountArgs]
      >(async (args) =>
        args.where && 'status' in args.where ? remainingCount : totalCount,
      ),
    },
    ingestionFile: {
      findFirst: jest.fn<
        Promise<{ id: string } | null>,
        [Prisma.IngestionFileFindFirstArgs]
      >(async () => (ingestionFileExists ? { id: 'f1' } : null)),
    },
    knowledgeDocument: {
      findFirst: jest.fn<
        Promise<{ id: string } | null>,
        [Prisma.KnowledgeDocumentFindFirstArgs]
      >(async (args) =>
        knowledgeDocumentExists &&
        args.where?.ingestionFileId === knowledgeDocumentIngestionFileId
          ? { id: 'd1' }
          : null,
      ),
    },
    backgroundJob: {
      findFirst: jest.fn<
        Promise<{ id: string } | null>,
        [Prisma.BackgroundJobFindFirstArgs]
      >(async () => (backgroundJobExists ? { id: 'child-job-1' } : null)),
    },
  };
}

const pendingInput = {
  projectId: 'p1',
  ingestionFileId: 'f1',
  knowledgeDocumentId: 'd1',
  pageNumber: 2,
  pageKind: 'PDF_PAGE' as const,
  sourceText: null,
  sourceBlobUrl: 'blob://page-2',
};

describe('KnowledgePageRepository', () => {
  it('finds a page only inside the requested project scope', async () => {
    const prisma = makePrisma({ existingPage: pageRow });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.findById({ id: 'page-1', projectId: 'p1' }),
    ).resolves.toBe(pageRow);
    expect(prisma.knowledgeDocumentPage.findFirst).toHaveBeenCalledWith({
      where: { id: 'page-1', projectId: 'p1' },
    });
  });

  it('creates a missing page only after both parents are found in the project', async () => {
    const prisma = makePrisma({ existingPage: null });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).resolves.toEqual(pageRow);

    expect(prisma.knowledgeDocumentPage.findUnique).toHaveBeenCalledWith({
      where: {
        ingestionFileId_pageNumber: {
          ingestionFileId: 'f1',
          pageNumber: 2,
        },
      },
    });
    expect(prisma.ingestionFile.findFirst).toHaveBeenCalledWith({
      where: { id: 'f1', projectId: 'p1' },
      select: { id: true },
    });
    expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', projectId: 'p1', ingestionFileId: 'f1' },
      select: { id: true },
    });
    expect(prisma.knowledgeDocumentPage.create).toHaveBeenCalledWith({
      data: {
        ...pendingInput,
        status: 'PENDING',
      },
    });
    expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'SUCCEEDED',
      {
        ...pageRow,
        status: 'SUCCEEDED' as const,
        contentText: 'finished content',
        summary: 'finished summary',
        jobId: 'completed-child-job',
      },
    ],
    [
      'PROCESSING',
      {
        ...pageRow,
        status: 'PROCESSING' as const,
        error: 'last transient error',
        jobId: 'active-child-job',
      },
    ],
    ['PENDING', { ...pageRow, status: 'PENDING' as const, jobId: 'queued-job' }],
    [
      'FAILED',
      {
        ...pageRow,
        status: 'FAILED' as const,
        error: 'final error',
        jobId: 'failed-child-job',
      },
    ],
  ])(
    'returns an existing %s page unchanged without detaching its job',
    async (_status, existingPage) => {
      const prisma = makePrisma({ existingPage });
      const repo = new KnowledgePageRepository(prisma);

      await expect(
        repo.upsertPending({
          ...pendingInput,
          sourceText: 'new source that must not overwrite',
          sourceBlobUrl: 'blob://new-source',
        }),
      ).resolves.toBe(existingPage);

      expect(prisma.knowledgeDocumentPage.create).not.toHaveBeenCalled();
      expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
      expect(prisma.ingestionFile.findFirst).not.toHaveBeenCalled();
      expect(prisma.knowledgeDocument.findFirst).not.toHaveBeenCalled();
      expect(existingPage.jobId).not.toBeNull();
    },
  );

  it('rejects a same-project document that belongs to another ingestion file', async () => {
    const prisma = makePrisma({
      existingPage: null,
      knowledgeDocumentIngestionFileId: 'f2',
    });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).rejects.toThrow(
      'Knowledge page f1:2 was not found in project p1',
    );
    expect(prisma.knowledgeDocument.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', projectId: 'p1', ingestionFileId: 'f1' },
      select: { id: true },
    });
    expect(prisma.knowledgeDocumentPage.create).not.toHaveBeenCalled();
  });

  it.each([
    ['ingestion file', false, true],
    ['knowledge document', true, false],
  ])(
    'rejects creation when the scoped %s parent is missing',
    async (_parent, ingestionFileExists, knowledgeDocumentExists) => {
      const prisma = makePrisma({
        existingPage: null,
        ingestionFileExists,
        knowledgeDocumentExists,
      });
      const repo = new KnowledgePageRepository(prisma);

      await expect(repo.upsertPending(pendingInput)).rejects.toThrow(
        'Knowledge page f1:2 was not found in project p1',
      );
      expect(prisma.knowledgeDocumentPage.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'another project',
      { ...pageRow, projectId: 'p2', knowledgeDocumentId: 'd2' },
    ],
    [
      'another document parent',
      { ...pageRow, knowledgeDocumentId: 'other-document' },
    ],
  ])(
    'rejects an existing composite page owned by %s without mutation',
    async (_reason, existingPage) => {
      const prisma = makePrisma({ existingPage });
      const repo = new KnowledgePageRepository(prisma);

      await expect(
        repo.upsertPending({
          projectId: 'p1',
          ingestionFileId: 'f1',
          knowledgeDocumentId: 'd1',
          pageNumber: 2,
          pageKind: 'PDF_PAGE',
          sourceText: null,
          sourceBlobUrl: 'blob://page-2',
        }),
      ).rejects.toThrow(
        'Knowledge page f1:2 was not found in project p1',
      );
      expect(prisma.knowledgeDocumentPage.create).not.toHaveBeenCalled();
      expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
    },
  );

  it('rejects a foreign-owner P2002 race without updating either row', async () => {
    const prisma = makePrisma({
      existingPage: null,
      createError: { code: 'P2002' },
      racedPage: {
        ...pageRow,
        projectId: 'p2',
        knowledgeDocumentId: 'd2',
      },
    });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).rejects.toThrow(
      'Knowledge page f1:2 was not found in project p1',
    );
    expect(prisma.knowledgeDocumentPage.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
  });

  it('returns a same-owner P2002 race winner unchanged', async () => {
    const racedPage = {
      ...pageRow,
      status: 'PROCESSING' as const,
      jobId: 'race-winner-child-job',
    };
    const prisma = makePrisma({
      existingPage: null,
      createError: { code: 'P2002' },
      racedPage,
    });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).resolves.toBe(racedPage);
    expect(prisma.knowledgeDocumentPage.findUnique).toHaveBeenCalledTimes(2);
    expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
    expect(racedPage.jobId).toBe('race-winner-child-job');
  });

  it('does not swallow a non-unique create failure', async () => {
    const createError = new Error('database unavailable');
    const prisma = makePrisma({ existingPage: null, createError });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).rejects.toBe(createError);
    expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
  });

  it('scopes processing state and direct child job updates by project', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.markProcessing({
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
      }),
    ).resolves.toBe(true);

    expect(prisma.backgroundJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'child-job-1', projectId: 'p1' },
      select: { id: true },
    });
    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
        status: { in: ['PENDING', 'FAILED'] },
      },
      data: {
        status: 'PROCESSING',
        error: null,
      },
    });
  });

  it('rejects a missing or cross-project child job before updating the page', async () => {
    const prisma = makePrisma({ backgroundJobExists: false });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.markProcessing({
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
      }),
    ).rejects.toThrow(
      'Background job child-job-1 was not found in project p1',
    );
    expect(prisma.backgroundJob.findFirst).toHaveBeenCalledWith({
      where: { id: 'child-job-1', projectId: 'p1' },
      select: { id: true },
    });
    expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
  });

  it('scopes success state and all extraction fields by project', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);
    const extractionResult = {
      tags: ['契約'],
      entities: [{ label: '顧客' }],
    };

    await expect(
      repo.markSucceeded({
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
        contentText: '抽出したページ本文',
        summary: 'ページ要約',
        extractionResult,
      }),
    ).resolves.toBe(true);

    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
        status: 'PROCESSING',
      },
      data: {
        status: 'SUCCEEDED',
        contentText: '抽出したページ本文',
        summary: 'ページ要約',
        extractionResult,
        error: null,
      },
    });
  });

  it('scopes failure state, increments attempts, and retains the error', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.markFailed({
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
        error: 'Claude timed out',
      }),
    ).resolves.toBe(true);

    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'page-1',
        projectId: 'p1',
        jobId: 'child-job-1',
        status: 'PROCESSING',
      },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        error: 'Claude timed out',
      },
    });
  });

  it.each([
    [
      'markProcessing',
      (repo: KnowledgePageRepository) =>
        repo.markProcessing({
          id: 'page-1',
          projectId: 'other-project',
          jobId: 'child-job-1',
        }),
    ],
    [
      'markSucceeded',
      (repo: KnowledgePageRepository) =>
        repo.markSucceeded({
          id: 'page-1',
          projectId: 'other-project',
          jobId: 'child-job-1',
          contentText: 'text',
          summary: 'summary',
          extractionResult: {},
        }),
    ],
    [
      'markFailed',
      (repo: KnowledgePageRepository) =>
        repo.markFailed({
          id: 'page-1',
          projectId: 'other-project',
          jobId: 'child-job-1',
          error: 'failed',
        }),
    ],
  ])('%s ignores a missing, stale, or cross-project page', async (_name, mutate) => {
    const prisma = makePrisma({ updateCount: 0 });
    const repo = new KnowledgePageRepository(prisma);

    await expect(mutate(repo)).resolves.toBe(false);
    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'page-1',
          projectId: 'other-project',
          jobId: 'child-job-1',
        }),
      }),
    );
  });

  it('fences stale worker success and failure by current job and PROCESSING status', async () => {
    const prisma = makePrisma({ updateCount: 0 });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.markSucceeded({
        id: 'page-1',
        projectId: 'p1',
        jobId: 'old-child',
        contentText: 'stale text',
        summary: 'stale summary',
        extractionResult: {},
      }),
    ).resolves.toBe(false);
    await expect(
      repo.markFailed({
        id: 'page-1',
        projectId: 'p1',
        jobId: 'old-child',
        error: 'stale failure',
      }),
    ).resolves.toBe(false);

    expect(prisma.knowledgeDocumentPage.updateMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({ jobId: 'old-child', status: 'PROCESSING' }),
    );
    expect(prisma.knowledgeDocumentPage.updateMany.mock.calls[1][0].where).toEqual(
      expect.objectContaining({ jobId: 'old-child', status: 'PROCESSING' }),
    );
  });

  it('lists pages for a stable ingestion file in project and page order', async () => {
    const rows = [{ ...pageRow, pageNumber: 1 }, pageRow];
    const prisma = makePrisma({ rows });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.listForFile({ projectId: 'p1', ingestionFileId: 'f1' }),
    ).resolves.toEqual(rows);
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', ingestionFileId: 'f1' },
      orderBy: { pageNumber: 'asc' },
    });
  });

  it('lists pages for a stable knowledge document in project and page order', async () => {
    const rows = [{ ...pageRow, pageNumber: 1 }, pageRow];
    const prisma = makePrisma({ rows });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.listForDocument({ projectId: 'p1', knowledgeDocumentId: 'd1' }),
    ).resolves.toEqual(rows);
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', knowledgeDocumentId: 'd1' },
      orderBy: { pageNumber: 'asc' },
    });
  });

  it('loads all page progress for a batch in one project-scoped query', async () => {
    const prisma = makePrisma({ rows: [pageRow] });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.listForBatch({ projectId: 'p1', batchId: 'batch-1' }),
    ).resolves.toEqual([
      { ingestionFileId: 'f1', pageNumber: 2, status: 'PENDING' },
    ]);
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1',
        ingestionFile: { batchId: 'batch-1', projectId: 'p1' },
      },
      orderBy: [{ ingestionFileId: 'asc' }, { pageNumber: 'asc' }],
      select: {
        ingestionFileId: true,
        pageNumber: true,
        status: true,
      },
    });
  });

  it.each([
    [
      'file',
      (repo: KnowledgePageRepository) =>
        repo.listForFile({ projectId: 'other-project', ingestionFileId: 'f1' }),
    ],
    [
      'document',
      (repo: KnowledgePageRepository) =>
        repo.listForDocument({
          projectId: 'other-project',
          knowledgeDocumentId: 'd1',
        }),
    ],
  ])('returns no %s pages from another project', async (_kind, list) => {
    const prisma = makePrisma({ rows: [] });
    const repo = new KnowledgePageRepository(prisma);

    await expect(list(repo)).resolves.toEqual([]);
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ projectId: 'other-project' }),
      }),
    );
  });

  it.each([
    [2, 0, true],
    [2, 1, false],
  ])(
    'allSucceeded with %i total and %i incomplete returns %s',
    async (totalCount, remainingCount, expected) => {
      const prisma = makePrisma({ totalCount, remainingCount });
      const repo = new KnowledgePageRepository(prisma);

      await expect(
        repo.allSucceeded({ projectId: 'p1', ingestionFileId: 'f1' }),
      ).resolves.toBe(expected);
      expect(prisma.knowledgeDocumentPage.count.mock.calls).toEqual([
        [{ where: { projectId: 'p1', ingestionFileId: 'f1' } }],
        [
          {
            where: {
              projectId: 'p1',
              ingestionFileId: 'f1',
              status: { not: 'SUCCEEDED' },
            },
          },
        ],
      ]);
    },
  );

  it('allSucceeded returns false for an empty file without a second query', async () => {
    const prisma = makePrisma({ totalCount: 0 });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.allSucceeded({
        projectId: 'other-project',
        ingestionFileId: 'f1',
      }),
    ).resolves.toBe(false);
    expect(prisma.knowledgeDocumentPage.count).toHaveBeenCalledTimes(1);
    expect(prisma.knowledgeDocumentPage.count).toHaveBeenCalledWith({
      where: { projectId: 'other-project', ingestionFileId: 'f1' },
    });
  });
});
