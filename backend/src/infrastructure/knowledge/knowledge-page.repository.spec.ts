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
  updateCount?: number;
  totalCount?: number;
  remainingCount?: number;
  rows?: KnowledgeDocumentPage[];
}

function makePrisma({
  updateCount = 1,
  totalCount = 1,
  remainingCount = 0,
  rows = [],
}: MockOptions = {}) {
  return {
    knowledgeDocumentPage: {
      upsert: jest.fn<
        Promise<KnowledgeDocumentPage>,
        [Prisma.KnowledgeDocumentPageUpsertArgs]
      >(async () => pageRow),
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
  };
}

describe('KnowledgePageRepository', () => {
  it('uses the stable file/page selector and resets only retry state on upsert', async () => {
    const prisma = makePrisma();
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
    ).resolves.toEqual(pageRow);

    expect(prisma.knowledgeDocumentPage.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.knowledgeDocumentPage.upsert.mock.calls[0][0];
    expect(args.where).toEqual({
      ingestionFileId_pageNumber: {
        ingestionFileId: 'f1',
        pageNumber: 2,
      },
    });
    expect(args.create).toEqual({
      projectId: 'p1',
      ingestionFileId: 'f1',
      knowledgeDocumentId: 'd1',
      pageNumber: 2,
      pageKind: 'PDF_PAGE',
      sourceText: null,
      sourceBlobUrl: 'blob://page-2',
      status: 'PENDING',
    });
    expect(args.update).toEqual({
      projectId: 'p1',
      knowledgeDocumentId: 'd1',
      pageKind: 'PDF_PAGE',
      sourceText: null,
      sourceBlobUrl: 'blob://page-2',
      status: 'PENDING',
      error: null,
      jobId: null,
    });
    expect(args.update).not.toHaveProperty('attempts');
    expect(args.update).not.toHaveProperty('contentText');
    expect(args.update).not.toHaveProperty('summary');
    expect(args.update).not.toHaveProperty('extractionResult');
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
