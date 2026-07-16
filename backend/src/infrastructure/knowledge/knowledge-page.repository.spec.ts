import { KnowledgePageRepository } from './knowledge-page.repository';

function makePrisma() {
  return {
    knowledgeDocumentPage: {
      upsert: jest.fn().mockResolvedValue({ id: 'page-1' }),
      update: jest.fn().mockResolvedValue({ id: 'page-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as any;
}

describe('KnowledgePageRepository', () => {
  it('upserts one stable row per ingestion file and page number', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await repo.upsertPending({
      projectId: 'p1',
      ingestionFileId: 'f1',
      knowledgeDocumentId: 'd1',
      pageNumber: 2,
      pageKind: 'PDF_PAGE',
      sourceText: null,
      sourceBlobUrl: 'blob://page-2',
    });

    expect(prisma.knowledgeDocumentPage.upsert).toHaveBeenCalledWith({
      where: {
        ingestionFileId_pageNumber: {
          ingestionFileId: 'f1',
          pageNumber: 2,
        },
      },
      create: {
        projectId: 'p1',
        ingestionFileId: 'f1',
        knowledgeDocumentId: 'd1',
        pageNumber: 2,
        pageKind: 'PDF_PAGE',
        sourceText: null,
        sourceBlobUrl: 'blob://page-2',
        status: 'PENDING',
      },
      update: {
        projectId: 'p1',
        knowledgeDocumentId: 'd1',
        pageKind: 'PDF_PAGE',
        sourceText: null,
        sourceBlobUrl: 'blob://page-2',
        status: 'PENDING',
        error: null,
        jobId: null,
      },
    });
  });

  it('marks a page as processing and records its direct child job', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await repo.markProcessing('page-1', 'child-job-1');

    expect(prisma.knowledgeDocumentPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: {
        status: 'PROCESSING',
        jobId: 'child-job-1',
        error: null,
      },
    });
  });

  it('persists page content, summary, and raw extraction result on success', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);
    const extractionResult = {
      tags: ['契約'],
      entities: [{ label: '顧客' }],
    };

    await repo.markSucceeded('page-1', {
      contentText: '抽出したページ本文',
      summary: 'ページ要約',
      extractionResult,
    });

    expect(prisma.knowledgeDocumentPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: {
        status: 'SUCCEEDED',
        contentText: '抽出したページ本文',
        summary: 'ページ要約',
        extractionResult,
        error: null,
      },
    });
  });

  it('increments attempts and retains the latest error on failure', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await repo.markFailed('page-1', 'Claude timed out');

    expect(prisma.knowledgeDocumentPage.update).toHaveBeenCalledWith({
      where: { id: 'page-1' },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        error: 'Claude timed out',
      },
    });
  });

  it('lists pages for an ingestion file in page order', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await repo.listForFile('f1');

    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { ingestionFileId: 'f1' },
      orderBy: { pageNumber: 'asc' },
    });
  });

  it('lists pages for a knowledge document in page order', async () => {
    const prisma = makePrisma();
    const repo = new KnowledgePageRepository(prisma);

    await repo.listForDocument('d1');

    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { knowledgeDocumentId: 'd1' },
      orderBy: { pageNumber: 'asc' },
    });
  });

  it.each([
    [0, true],
    [1, false],
  ])(
    'reports allSucceeded from the number of non-succeeded pages (%i)',
    async (remaining, expected) => {
      const prisma = makePrisma();
      prisma.knowledgeDocumentPage.count.mockResolvedValue(remaining);
      const repo = new KnowledgePageRepository(prisma);

      await expect(repo.allSucceeded('f1')).resolves.toBe(expected);
      expect(prisma.knowledgeDocumentPage.count).toHaveBeenCalledWith({
        where: {
          ingestionFileId: 'f1',
          status: { not: 'SUCCEEDED' },
        },
      });
    },
  );
});
