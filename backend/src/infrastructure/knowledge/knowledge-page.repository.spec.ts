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

type PageParent = Pick<
  KnowledgeDocumentPage,
  'projectId' | 'knowledgeDocumentId'
>;

interface MockOptions {
  existingPage?: PageParent | null;
  createResult?: KnowledgeDocumentPage;
  createError?: unknown;
  scopedPage?: KnowledgeDocumentPage | null;
  updateCount?: number;
  totalCount?: number;
  remainingCount?: number;
  rows?: KnowledgeDocumentPage[];
}

function makePrisma({
  existingPage = null,
  createResult = pageRow,
  createError,
  scopedPage = pageRow,
  updateCount = 1,
  totalCount = 1,
  remainingCount = 0,
  rows = [],
}: MockOptions = {}) {
  return {
    knowledgeDocumentPage: {
      findUnique: jest.fn<
        Promise<PageParent | null>,
        [Prisma.KnowledgeDocumentPageFindUniqueArgs]
      >(async () => existingPage),
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
      findFirst: jest.fn<
        Promise<KnowledgeDocumentPage | null>,
        [Prisma.KnowledgeDocumentPageFindFirstArgs]
      >(async () => scopedPage),
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

const scopedPageWhere = {
  ingestionFileId: 'f1',
  pageNumber: 2,
  projectId: 'p1',
  knowledgeDocumentId: 'd1',
};

describe('KnowledgePageRepository', () => {
  it('creates a missing page after lookup by the stable composite selector', async () => {
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
      select: { projectId: true, knowledgeDocumentId: true },
    });
    expect(prisma.knowledgeDocumentPage.create).toHaveBeenCalledWith({
      data: {
        ...pendingInput,
        status: 'PENDING',
      },
    });
    expect(prisma.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
    expect(prisma.knowledgeDocumentPage.findFirst).not.toHaveBeenCalled();
  });

  it('refreshes an existing same-owner page with a fully scoped immutable-parent update', async () => {
    const prisma = makePrisma({
      existingPage: { projectId: 'p1', knowledgeDocumentId: 'd1' },
    });
    const repo = new KnowledgePageRepository(prisma);

    await expect(
      repo.upsertPending({
        ...pendingInput,
        sourceText: 'refreshed source',
        sourceBlobUrl: 'blob://refreshed-page-2',
      }),
    ).resolves.toEqual(pageRow);

    expect(prisma.knowledgeDocumentPage.create).not.toHaveBeenCalled();
    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: scopedPageWhere,
      data: {
        pageKind: 'PDF_PAGE',
        sourceText: 'refreshed source',
        sourceBlobUrl: 'blob://refreshed-page-2',
        status: 'PENDING',
        error: null,
        jobId: null,
      },
    });
    const data = prisma.knowledgeDocumentPage.updateMany.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('projectId');
    expect(data).not.toHaveProperty('knowledgeDocumentId');
    expect(data).not.toHaveProperty('attempts');
    expect(data).not.toHaveProperty('contentText');
    expect(data).not.toHaveProperty('summary');
    expect(data).not.toHaveProperty('extractionResult');
    expect(prisma.knowledgeDocumentPage.findFirst).toHaveBeenCalledWith({
      where: scopedPageWhere,
    });
  });

  it.each([
    [
      'another project',
      { projectId: 'p2', knowledgeDocumentId: 'd2' },
    ],
    [
      'another document parent',
      { projectId: 'p1', knowledgeDocumentId: 'other-document' },
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

  it('rejects a foreign-owner unique race without an unscoped mutation', async () => {
    const prisma = makePrisma({
      existingPage: null,
      createError: { code: 'P2002' },
      updateCount: 0,
    });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).rejects.toThrow(
      'Knowledge page f1:2 was not found in project p1',
    );
    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: scopedPageWhere,
      data: {
        pageKind: 'PDF_PAGE',
        sourceText: null,
        sourceBlobUrl: 'blob://page-2',
        status: 'PENDING',
        error: null,
        jobId: null,
      },
    });
    expect(prisma.knowledgeDocumentPage.findFirst).not.toHaveBeenCalled();
  });

  it('recovers a same-owner unique race through the fully scoped update', async () => {
    const prisma = makePrisma({
      existingPage: null,
      createError: { code: 'P2002' },
      updateCount: 1,
      scopedPage: pageRow,
    });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.upsertPending(pendingInput)).resolves.toEqual(pageRow);
    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: scopedPageWhere }),
    );
    expect(prisma.knowledgeDocumentPage.findFirst).toHaveBeenCalledWith({
      where: scopedPageWhere,
    });
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
    ).resolves.toBeUndefined();

    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: { id: 'page-1', projectId: 'p1' },
      data: {
        status: 'PROCESSING',
        jobId: 'child-job-1',
        error: null,
      },
    });
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
        contentText: '抽出したページ本文',
        summary: 'ページ要約',
        extractionResult,
      }),
    ).resolves.toBeUndefined();

    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: { id: 'page-1', projectId: 'p1' },
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
        error: 'Claude timed out',
      }),
    ).resolves.toBeUndefined();

    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith({
      where: { id: 'page-1', projectId: 'p1' },
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
          error: 'failed',
        }),
    ],
  ])('%s rejects a missing or cross-project page', async (_name, mutate) => {
    const prisma = makePrisma({ updateCount: 0 });
    const repo = new KnowledgePageRepository(prisma);

    await expect(mutate(repo)).rejects.toThrow(
      'Knowledge page page-1 was not found in project other-project',
    );
    expect(prisma.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'page-1', projectId: 'other-project' },
      }),
    );
  });

  it('lists pages for a stable ingestion file in page order', async () => {
    const rows = [{ ...pageRow, pageNumber: 1 }, pageRow];
    const prisma = makePrisma({ rows });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.listForFile('f1')).resolves.toEqual(rows);
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { ingestionFileId: 'f1' },
      orderBy: { pageNumber: 'asc' },
    });
  });

  it('lists pages for a stable knowledge document in page order', async () => {
    const rows = [{ ...pageRow, pageNumber: 1 }, pageRow];
    const prisma = makePrisma({ rows });
    const repo = new KnowledgePageRepository(prisma);

    await expect(repo.listForDocument('d1')).resolves.toEqual(rows);
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { knowledgeDocumentId: 'd1' },
      orderBy: { pageNumber: 'asc' },
    });
  });

  it.each([
    [2, 0, true],
    [2, 1, false],
  ])(
    'allSucceeded with %i total and %i incomplete returns %s',
    async (totalCount, remainingCount, expected) => {
      const prisma = makePrisma({ totalCount, remainingCount });
      const repo = new KnowledgePageRepository(prisma);

      await expect(repo.allSucceeded('f1')).resolves.toBe(expected);
      expect(prisma.knowledgeDocumentPage.count.mock.calls).toEqual([
        [{ where: { ingestionFileId: 'f1' } }],
        [
          {
            where: {
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

    await expect(repo.allSucceeded('f1')).resolves.toBe(false);
    expect(prisma.knowledgeDocumentPage.count).toHaveBeenCalledTimes(1);
    expect(prisma.knowledgeDocumentPage.count).toHaveBeenCalledWith({
      where: { ingestionFileId: 'f1' },
    });
  });
});
