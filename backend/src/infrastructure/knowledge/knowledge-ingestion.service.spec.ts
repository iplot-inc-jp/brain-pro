import type { BackgroundJob, KnowledgeDocumentPage } from '@prisma/client';
import { PDFDocument } from 'pdf-lib';
import { IngestionFile } from '../../domain';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

const now = new Date('2026-07-16T00:00:00.000Z');

const pageRow = (pageNumber: number, overrides: Partial<KnowledgeDocumentPage> = {}): KnowledgeDocumentPage => ({
  id: `page-${pageNumber}`,
  projectId: 'p1',
  ingestionFileId: 'file-1',
  knowledgeDocumentId: 'doc-1',
  pageNumber,
  pageKind: 'PDF_PAGE',
  sourceText: null,
  sourceBlobUrl: `blob://page-${pageNumber}`,
  contentText: null,
  summary: null,
  extractionResult: null,
  status: 'PENDING',
  attempts: 0,
  error: null,
  jobId: null,
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const backgroundJob = (overrides: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'child-1',
  projectId: 'p1',
  parentJobId: 'parent-1',
  type: 'KG_INGEST_PAGE',
  status: 'RUNNING',
  payload: { pageId: 'page-1' },
  result: null,
  error: null,
  progress: 10,
  attempts: 0,
  maxAttempts: 4,
  createdById: 'u1',
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  finishedAt: null,
  ...overrides,
});

async function pdfWithPages(count: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) pdf.addPage();
  return Buffer.from(await pdf.save());
}

function makeFile(filename = 'deck.pdf') {
  return IngestionFile.create(
    {
      batchId: 'batch-1',
      projectId: 'p1',
      sourceType: 'UPLOAD',
      filename,
      mimeType: filename.endsWith('.pdf')
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      blobUrl: 'blob://original',
    },
    'file-1',
  );
}

function makeService(
  options: {
    file?: IngestionFile;
    bytes?: Buffer;
    pages?: KnowledgeDocumentPage[];
  } = {},
) {
  const file = options.file ?? makeFile();
  const pages = options.pages ?? [];
  const tx = {
    $executeRawUnsafe: jest.fn(async () => 1),
    knowledgeDocumentPage: {
      findMany: jest.fn(async () => pages),
      findFirst: jest.fn(async () =>
        pages[0] ? { id: pages[0].id } : null,
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    backgroundJob: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) =>
        backgroundJob(data as Partial<BackgroundJob>),
      ),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findFirst: jest.fn(async () => ({ id: 'merge-1' })),
    },
    backgroundJobAttempt: {
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const prisma = {
    knowledgeDocument: {
      upsert: jest.fn(async () => ({ id: 'doc-1' })),
    },
    backgroundJob: {
      findUnique: jest.fn(async () => backgroundJob()),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => ({ id: 'merge-1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      update: jest.fn(async () => backgroundJob()),
    },
    projectKnowledgeSettings: {
      findUnique: jest.fn(async () => ({
        aiExtractionEnabled: true,
        ocrEnabled: true,
        defaultModel: null,
      })),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  let savedBlobCount = 0;
  const blob = {
    read: jest.fn(async () => options.bytes ?? Buffer.from('{}')),
    save: jest.fn(
      async (_key: string): Promise<{ url: string }> => ({
        url: `blob://saved-${++savedBlobCount}`,
      }),
    ),
  };
  const extraction = {
    classify: jest.fn(() => (file.filename.endsWith('.pdf') ? 'pdf' : 'presentation')),
    extractText: jest.fn(),
  };
  const extractPageKnowledge = jest.fn(async () => ({
      summary: '要約',
      fullText: '本文',
      tags: [],
      entities: [],
      relations: [],
    }));
  const claude = {
    extractKnowledge: extractPageKnowledge,
    extractPageKnowledge,
  };
  const companyKey = { resolveForProject: jest.fn(async () => 'api-key') };
  const jobService = {
    startReserved: jest.fn(async (id: string) => backgroundJob({ id })),
    retry: jest.fn(async (id: string) => backgroundJob({ id })),
    recoverStaleRunning: jest.fn(async (id: string) => backgroundJob({ id })),
    enqueue: jest.fn(async () => backgroundJob({ id: 'merge-1', type: 'KG_MERGE_INGEST_FILE' })),
  };
  const fileRepository = {
    findById: jest.fn(async () => file),
    save: jest.fn(async () => undefined),
    findByBatchId: jest.fn(async () => [file]),
  };
  const batch = {
    id: 'batch-1',
    projectId: 'p1',
    createdById: 'u1',
    options: {},
    status: 'RUNNING',
    update: jest.fn(),
  };
  const batchRepository = {
    findById: jest.fn(async () => batch),
    save: jest.fn(async () => undefined),
  };
  const pageRepository = {
    upsertPending: jest.fn(async (input: { pageNumber: number }) => pageRow(input.pageNumber)),
    findById: jest.fn(async () => pages[0] ?? null),
    markProcessing: jest.fn(async () => true),
    markSucceeded: jest.fn(async () => true),
    markFailed: jest.fn(async () => true),
    allSucceeded: jest.fn(async () => true),
    listForFile: jest.fn(async () => pages),
  };
  const service = new KnowledgeIngestionService(
    prisma as never,
    blob as never,
    extraction as never,
    claude as never,
    companyKey as never,
    {} as never,
    jobService as never,
    fileRepository as never,
    batchRepository as never,
    pageRepository as never,
  );
  return {
    service,
    file,
    prisma,
    tx,
    blob,
    claude,
    companyKey,
    jobService,
    fileRepository,
    batchRepository,
    pageRepository,
  };
}

describe('KnowledgeIngestionService paged documents', () => {
  it('completes a zero-slide PPTX through processFile and keeps its document shell', async () => {
    const fixture = makeService({ file: makeFile('empty.pptx'), pages: [] });
    jest
      .spyOn(
        fixture.service as unknown as {
          preparePageInputs(bytes: Buffer, kind: string): Promise<unknown[]>;
        },
        'preparePageInputs',
      )
      .mockResolvedValue([]);
    const merge = jest
      .spyOn(
        fixture.service as unknown as {
          merge: (...args: unknown[]) => Promise<string>;
        },
        'merge',
      )
      .mockResolvedValue('doc-1');

    await expect(
      fixture.service.processFile('file-1', 'parent-1'),
    ).resolves.toEqual({
      knowledgeDocumentId: 'doc-1',
      deferred: false,
      pages: 0,
    });

    expect(fixture.prisma.knowledgeDocument.upsert).toHaveBeenCalled();
    expect(merge).toHaveBeenCalledWith(
      fixture.file,
      expect.objectContaining({ summary: '内容なし', fullText: '' }),
      expect.objectContaining({ contentText: '' }),
    );
    expect(fixture.file.status).toBe('SUCCEEDED');
    expect(fixture.tx.backgroundJob.create).not.toHaveBeenCalled();
    expect(fixture.jobService.startReserved).not.toHaveBeenCalled();
  });

  it('creates every PDF page input but reserves only two child jobs initially', async () => {
    const pages = [pageRow(1), pageRow(2), pageRow(3)];
    const fixture = makeService({ bytes: await pdfWithPages(3), pages });

    await expect(fixture.service.processFile('file-1', 'parent-1')).resolves.toEqual(
      expect.objectContaining({ deferred: true }),
    );

    expect(fixture.pageRepository.upsertPending).toHaveBeenCalledTimes(3);
    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(2);
    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'KG_INGEST_PAGE',
        projectId: 'p1',
        parentJobId: 'parent-1',
      }),
      select: { id: true, status: true },
    });
    expect(fixture.jobService.startReserved).toHaveBeenCalledTimes(2);
  });

  it('does not reserve or reprocess a succeeded page when the parent resumes', async () => {
    const pages = [
      pageRow(1, { status: 'SUCCEEDED', jobId: 'old-success' }),
      pageRow(2, { status: 'FAILED', jobId: 'old-failed' }),
    ];
    const fixture = makeService({ bytes: await pdfWithPages(2), pages });

    await fixture.service.processFile('file-1', 'parent-1');

    expect(fixture.tx.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'page-2' }),
      }),
    );
    expect(fixture.tx.knowledgeDocumentPage.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'page-1' }),
      }),
    );
    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(1);
  });

  it('succeeds an empty PPTX slide without calling Claude and scopes it by child project', async () => {
    const emptySlide = pageRow(1, {
      pageKind: 'PPTX_SLIDE',
      sourceText: '',
      sourceBlobUrl: 'blob://empty-slide',
      jobId: 'child-1',
    });
    const fixture = makeService({
      file: makeFile('deck.pptx'),
      bytes: Buffer.from(JSON.stringify({ images: [] })),
      pages: [emptySlide],
    });

    await fixture.service.processPage('page-1', 'child-1');

    expect(fixture.pageRepository.findById).toHaveBeenCalledWith({
      id: 'page-1',
      projectId: 'p1',
    });
    expect(fixture.claude.extractPageKnowledge).not.toHaveBeenCalled();
    expect(fixture.companyKey.resolveForProject).not.toHaveBeenCalled();
    expect(fixture.pageRepository.markSucceeded).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'page-1',
        projectId: 'p1',
        contentText: '',
        summary: '内容なし',
      }),
    );
    expect(fixture.jobService.enqueue).toHaveBeenCalledWith(
      'KG_MERGE_INGEST_FILE',
      { fileId: 'file-1' },
      expect.objectContaining({
        projectId: 'p1',
        parentJobId: 'parent-1',
        dedupeId: expect.any(String),
      }),
    );
  });

  it('marks only the failing page and leaves successful siblings untouched', async () => {
    const failed = pageRow(2, {
      sourceBlobUrl: 'blob://page-2',
      jobId: 'child-1',
    });
    const fixture = makeService({
      bytes: Buffer.from('one-page-pdf'),
      pages: [failed],
    });
    fixture.claude.extractPageKnowledge.mockRejectedValueOnce(new Error('LLM down'));

    await expect(fixture.service.processPage('page-2', 'child-1')).rejects.toThrow('LLM down');

    expect(fixture.pageRepository.markFailed).toHaveBeenCalledWith({
      id: 'page-2',
      projectId: 'p1',
      jobId: 'child-1',
      error: 'LLM down',
    });
    expect(fixture.fileRepository.save).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
    expect(fixture.prisma.backgroundJob.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('does not recharge Claude when orchestration fails after the page result is persisted', async () => {
    const page = pageRow(1, { jobId: 'child-1' });
    const fixture = makeService({ pages: [page] });
    fixture.jobService.enqueue.mockRejectedValueOnce(new Error('publish failed'));

    await expect(
      fixture.service.processPage('page-1', 'child-1'),
    ).rejects.toThrow('publish failed');
    expect(fixture.pageRepository.markFailed).not.toHaveBeenCalled();

    page.status = 'SUCCEEDED';
    page.contentText = '本文';
    await expect(
      fixture.service.processPage('page-1', 'child-1'),
    ).resolves.toEqual({ mergeQueued: true });

    expect(fixture.claude.extractPageKnowledge).toHaveBeenCalledTimes(1);
    expect(fixture.pageRepository.markSucceeded).toHaveBeenCalledTimes(1);
    expect(fixture.pageRepository.markFailed).not.toHaveBeenCalled();
  });

  it('treats a reassigned page worker as obsolete without mutating the page', async () => {
    const fixture = makeService({
      pages: [pageRow(1, { jobId: 'new-child' })],
    });

    await expect(
      fixture.service.processPage('page-1', 'child-1'),
    ).resolves.toEqual({ mergeQueued: false, obsolete: true });
    expect(fixture.pageRepository.markProcessing).not.toHaveBeenCalled();
    expect(fixture.claude.extractPageKnowledge).not.toHaveBeenCalled();
  });

  it('serializes simultaneous replenishment so no more than two pages are active', async () => {
    const pages = [
      pageRow(1, { status: 'SUCCEEDED', jobId: 'done-1' }),
      pageRow(2, { status: 'SUCCEEDED', jobId: 'done-2' }),
      pageRow(3),
      pageRow(4),
      pageRow(5),
    ].map((page) =>
      Object.assign(page, {
        job: null as null | { id: string; status: string },
      }),
    );
    const fixture = makeService({ pages });
    fixture.tx.knowledgeDocumentPage.findMany.mockImplementation(async () => pages);
    fixture.tx.knowledgeDocumentPage.updateMany.mockImplementation((async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { jobId: string };
    }) => {
      const page = pages.find((row) => row.id === where.id);
      if (!page) return { count: 0 };
      page.jobId = data.jobId;
      page.status = 'PENDING';
      page.job = { id: data.jobId, status: 'QUEUED' };
      return { count: 1 };
    }) as never);
    let transactionTail = Promise.resolve();
    fixture.prisma.$transaction.mockImplementation(
      async (callback: (client: typeof fixture.tx) => Promise<unknown>) => {
        const previous = transactionTail;
        let release!: () => void;
        transactionTail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        try {
          return await callback(fixture.tx);
        } finally {
          release();
        }
      },
    );
    const scheduler = fixture.service as unknown as {
      fillPageWorkerWindow(file: IngestionFile, parentJobId: string): Promise<void>;
    };

    await Promise.all([
      scheduler.fillPageWorkerWindow(fixture.file, 'parent-1'),
      scheduler.fillPageWorkerWindow(fixture.file, 'parent-1'),
    ]);

    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(2);
    expect(fixture.jobService.startReserved).toHaveBeenCalledTimes(2);
    expect(
      pages.filter((page) => page.job && (page.job.status === 'QUEUED' || page.job.status === 'RUNNING')),
    ).toHaveLength(2);
  });

  it('counts a FAILED page with a requeued child job as an active slot', async () => {
    const pages = [
      Object.assign(pageRow(1, { status: 'PROCESSING', jobId: 'running-1' }), {
        job: { id: 'running-1', status: 'RUNNING', updatedAt: now },
      }),
      Object.assign(pageRow(2, { status: 'FAILED', jobId: 'queued-2' }), {
        job: { id: 'queued-2', status: 'QUEUED', updatedAt: now },
      }),
      Object.assign(pageRow(3), { job: null }),
    ];
    const fixture = makeService({ pages });
    const scheduler = fixture.service as unknown as {
      fillPageWorkerWindow(file: IngestionFile, parentJobId: string): Promise<void>;
    };

    await scheduler.fillPageWorkerWindow(fixture.file, 'parent-1');

    expect(fixture.tx.backgroundJob.create).not.toHaveBeenCalled();
    expect(fixture.tx.knowledgeDocumentPage.updateMany).not.toHaveBeenCalled();
  });

  it('frees both just-succeeded RUNNING child slots and steadily reserves the next two pages', async () => {
    const pages = [
      Object.assign(pageRow(1, { status: 'SUCCEEDED', jobId: 'child-1' }), {
        job: { id: 'child-1', status: 'RUNNING', updatedAt: now },
      }),
      Object.assign(pageRow(2, { status: 'SUCCEEDED', jobId: 'child-2' }), {
        job: { id: 'child-2', status: 'RUNNING', updatedAt: now },
      }),
      Object.assign(pageRow(3), { job: null }),
      Object.assign(pageRow(4), { job: null }),
      Object.assign(pageRow(5), { job: null }),
    ];
    const fixture = makeService({ pages });
    const scheduler = fixture.service as unknown as {
      fillPageWorkerWindow(file: IngestionFile, parentJobId: string): Promise<void>;
    };

    await scheduler.fillPageWorkerWindow(fixture.file, 'parent-1');

    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(2);
    expect(fixture.tx.knowledgeDocumentPage.updateMany).toHaveBeenCalledTimes(2);
    expect(fixture.jobService.startReserved).toHaveBeenCalledTimes(2);
  });

  it('terminalizes an expired old page child before assigning its replacement', async () => {
    const expired = new Date(Date.now() - 11 * 60 * 1000);
    const pages = [
      Object.assign(pageRow(1, { status: 'PROCESSING', jobId: 'old-child' }), {
        job: { id: 'old-child', status: 'RUNNING', updatedAt: expired },
      }),
    ];
    const fixture = makeService({ pages });
    const scheduler = fixture.service as unknown as {
      fillPageWorkerWindow(
        file: IngestionFile,
        parentJobId: string,
        recoverQueued: boolean,
      ): Promise<void>;
    };

    await scheduler.fillPageWorkerWindow(fixture.file, 'parent-1', true);

    expect(fixture.tx.backgroundJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'old-child', status: 'RUNNING', updatedAt: expired },
      data: expect.objectContaining({
        status: 'FAILED',
        error: expect.stringContaining('superseded'),
        finishedAt: expect.any(Date),
      }),
    });
    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.backgroundJobAttempt.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'old-child', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('keeps a freshly heartbeating page child and never assigns a duplicate worker', async () => {
    const pages = [
      Object.assign(pageRow(1, { status: 'PROCESSING', jobId: 'live-child' }), {
        job: { id: 'live-child', status: 'RUNNING', updatedAt: new Date() },
      }),
      Object.assign(pageRow(2), { job: null }),
    ];
    const fixture = makeService({ pages });
    const scheduler = fixture.service as unknown as {
      fillPageWorkerWindow(
        file: IngestionFile,
        parentJobId: string,
        recoverQueued: boolean,
      ): Promise<void>;
    };

    await scheduler.fillPageWorkerWindow(fixture.file, 'parent-1', true);

    expect(fixture.tx.backgroundJob.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.knowledgeDocumentPage.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'page-1' }) }),
    );
    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(1);
  });

  it('drains untouched pages without auto-recharging a permanent failure, then explicit resume retries it once', async () => {
    const pages = [
      Object.assign(pageRow(1, { status: 'FAILED', jobId: 'failed-child' }), {
        job: { id: 'failed-child', status: 'FAILED', updatedAt: now },
      }),
      Object.assign(pageRow(2), { job: null }),
      Object.assign(pageRow(3), { job: null }),
    ];
    const fixture = makeService({ pages });
    fixture.tx.knowledgeDocumentPage.findMany.mockImplementation(async () => pages);
    fixture.tx.knowledgeDocumentPage.updateMany.mockImplementation((async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { jobId: string };
    }) => {
      const page = pages.find((row) => row.id === where.id);
      if (!page) return { count: 0 };
      page.jobId = data.jobId;
      page.status = 'PENDING';
      page.job = { id: data.jobId, status: 'QUEUED', updatedAt: now };
      return { count: 1 };
    }) as never);
    const scheduler = fixture.service as unknown as {
      fillPageWorkerWindow(file: IngestionFile, parentJobId: string, recoverQueued?: boolean): Promise<void>;
    };

    await scheduler.fillPageWorkerWindow(fixture.file, 'parent-1');

    const ordinaryClaims = (
      fixture.tx.knowledgeDocumentPage.updateMany.mock.calls as unknown as Array<[{ where: { id: string } }]>
    ).map(([args]) => args.where.id);
    expect(ordinaryClaims).toEqual(['page-2', 'page-3']);
    expect(ordinaryClaims).not.toContain('page-1');

    pages[1].status = 'SUCCEEDED';
    pages[1].job!.status = 'SUCCEEDED';
    pages[2].status = 'SUCCEEDED';
    pages[2].job!.status = 'SUCCEEDED';
    fixture.tx.knowledgeDocumentPage.updateMany.mockClear();
    fixture.tx.backgroundJob.create.mockClear();

    await scheduler.fillPageWorkerWindow(fixture.file, 'parent-1', true);

    expect(fixture.tx.knowledgeDocumentPage.updateMany).toHaveBeenCalledTimes(1);
    expect(fixture.tx.knowledgeDocumentPage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'page-1' }),
      }),
    );
    expect(fixture.tx.backgroundJob.create).toHaveBeenCalledTimes(1);
  });

  it('merges page results in page order and normalizes them through the existing merge path', async () => {
    const pages = [
      pageRow(1, {
        status: 'SUCCEEDED',
        contentText: '1ページ目',
        summary: '要約1',
        extractionResult: {
          summary: '要約1',
          tags: ['A'],
          entities: [],
          relations: [],
        },
      }),
      pageRow(2, {
        status: 'SUCCEEDED',
        contentText: '2ページ目',
        summary: '要約2',
        extractionResult: {
          summary: '要約2',
          tags: ['B'],
          entities: [{ label: '会社', kind: 'ORG' }],
          relations: [],
        },
      }),
    ];
    const fixture = makeService({ pages });
    fixture.prisma.backgroundJob.findUnique.mockResolvedValueOnce(
      backgroundJob({
        id: 'merge-1',
        type: 'KG_MERGE_INGEST_FILE',
        parentJobId: 'parent-1',
      }),
    );
    const merge = jest
      .spyOn(
        fixture.service as unknown as {
          merge: (...args: unknown[]) => Promise<string>;
        },
        'merge',
      )
      .mockResolvedValue('doc-1');

    await fixture.service.mergePagedFile('file-1', 'merge-1');

    expect(merge).toHaveBeenCalledWith(
      fixture.file,
      expect.objectContaining({
        summary: 'ページ1: 要約1\nページ2: 要約2',
        fullText: '1ページ目\n\n2ページ目',
        tags: ['A', 'B'],
        entities: [{ label: '会社', kind: 'ORG' }],
      }),
      expect.objectContaining({ contentText: '1ページ目\n\n2ページ目' }),
    );
    expect(fixture.prisma.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'parent-1', projectId: 'p1' }),
        data: expect.objectContaining({ status: 'SUCCEEDED', progress: 100 }),
      }),
    );
  });

  it('rejects a merge job from another project before reading page content', async () => {
    const fixture = makeService({
      pages: [pageRow(1, { status: 'SUCCEEDED' })],
    });
    fixture.prisma.backgroundJob.findUnique.mockResolvedValueOnce(
      backgroundJob({ projectId: 'p2', type: 'KG_MERGE_INGEST_FILE' }),
    );

    await expect(fixture.service.mergePagedFile('file-1', 'merge-1')).rejects.toThrow('not found in project p2');
    expect(fixture.pageRepository.listForFile).not.toHaveBeenCalled();
  });

  it('restores the file state and republishes a stranded queued merge on parent resume', async () => {
    const pages = [pageRow(1, { status: 'SUCCEEDED' })];
    const fixture = makeService({ pages });
    const queuedMerge = backgroundJob({
      id: 'stable-merge',
      type: 'KG_MERGE_INGEST_FILE',
      status: 'QUEUED',
      parentJobId: 'parent-1',
    });
    fixture.prisma.backgroundJob.findUnique
      .mockResolvedValueOnce(backgroundJob({ id: 'parent-1' }))
      .mockResolvedValueOnce(queuedMerge);

    await fixture.service.resumePagedFile('file-1', 'parent-1');

    expect(fixture.file.status).toBe('EXTRACTING');
    expect(fixture.file.finishedAt).toBeNull();
    expect(fixture.fileRepository.save).toHaveBeenCalledWith(fixture.file);
    expect(fixture.jobService.startReserved).toHaveBeenCalledWith(
      'stable-merge',
    );
    expect(fixture.jobService.enqueue).not.toHaveBeenCalled();
  });

  it('recovers a stale RUNNING merge on parent resume', async () => {
    const fixture = makeService({
      pages: [pageRow(1, { status: 'SUCCEEDED' })],
    });
    fixture.prisma.backgroundJob.findUnique
      .mockResolvedValueOnce(backgroundJob({ id: 'parent-1' }))
      .mockResolvedValueOnce(
        backgroundJob({
          id: 'stable-merge',
          type: 'KG_MERGE_INGEST_FILE',
          status: 'RUNNING',
        }),
      );

    await fixture.service.resumePagedFile('file-1', 'parent-1');

    expect(fixture.jobService.recoverStaleRunning).toHaveBeenCalledWith(
      'stable-merge',
    );
    expect(fixture.jobService.enqueue).not.toHaveBeenCalled();
  });

  it('cannot demote a succeeded parent from a stale terminal callback', async () => {
    const fixture = makeService();
    const parentState = fixture.service as unknown as {
      setParentState(
        parentJobId: string,
        projectId: string,
        status: 'FAILED',
      ): Promise<void>;
    };

    await parentState.setParentState('parent-1', 'p1', 'FAILED');

    expect(fixture.prisma.backgroundJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'parent-1', projectId: 'p1', status: 'RUNNING' },
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });

  it('allows a current direct child retry to revive FAILED parent and merge it to SUCCEEDED', async () => {
    const fixture = makeService();
    const parentState = fixture.service as unknown as {
      setParentState(
        parentJobId: string,
        projectId: string,
        status: 'RUNNING' | 'SUCCEEDED',
      ): Promise<void>;
    };

    await parentState.setParentState('parent-1', 'p1', 'RUNNING');
    await parentState.setParentState('parent-1', 'p1', 'SUCCEEDED');

    expect(fixture.prisma.backgroundJob.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: 'parent-1',
          projectId: 'p1',
          status: { in: ['RUNNING', 'FAILED'] },
        },
        data: expect.objectContaining({ status: 'RUNNING' }),
      }),
    );
    expect(fixture.prisma.backgroundJob.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['RUNNING', 'FAILED'] },
        }),
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
  });

  it('heartbeats only the current PROCESSING page child during long extraction', async () => {
    const page = pageRow(1, { status: 'PENDING', jobId: 'child-1' });
    const fixture = makeService({ pages: [page] });
    fixture.claude.extractPageKnowledge.mockImplementationOnce(
      (async (
        _input: unknown,
        _key: string,
        _model: unknown,
        _usage: unknown,
        heartbeat?: () => Promise<void>,
      ) => {
        await heartbeat?.();
        await heartbeat?.();
        return {
          summary: '要約',
          fullText: '本文',
          tags: [],
          entities: [],
          relations: [],
        };
      }) as never,
    );

    await fixture.service.processPage('page-1', 'child-1');

    expect(fixture.tx.knowledgeDocumentPage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'page-1',
          jobId: 'child-1',
          status: 'PROCESSING',
        }),
      }),
    );
    expect(fixture.tx.backgroundJob.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects an obsolete merge lease before graph side effects', async () => {
    const fixture = makeService({
      pages: [pageRow(1, { status: 'SUCCEEDED' })],
    });
    fixture.prisma.backgroundJob.findUnique.mockResolvedValueOnce(
      backgroundJob({ id: 'merge-1', type: 'KG_MERGE_INGEST_FILE' }),
    );
    fixture.prisma.backgroundJob.findFirst.mockResolvedValueOnce(null as never);
    const merge = jest.spyOn(
      fixture.service as unknown as { merge: (...args: unknown[]) => Promise<string> },
      'merge',
    );

    await expect(
      fixture.service.mergePagedFile('file-1', 'merge-1', now),
    ).rejects.toThrow('lease');
    expect(merge).not.toHaveBeenCalled();
    expect(fixture.fileRepository.save).not.toHaveBeenCalled();
  });

  it('does not settle a transient FAILED page while its child is QUEUED', async () => {
    const page = pageRow(1, { status: 'FAILED', jobId: 'child-1' });
    const fixture = makeService({ pages: [page] });
    fixture.prisma.backgroundJob.findMany.mockResolvedValueOnce([
      { id: 'child-1', status: 'QUEUED' },
    ] as never);
    const settle = fixture.service as unknown as {
      settleFailedPagedFileIfIdle(
        file: IngestionFile,
        parentJobId: string,
      ): Promise<void>;
    };

    await settle.settleFailedPagedFileIfIdle(fixture.file, 'parent-1');

    expect(fixture.fileRepository.save).not.toHaveBeenCalled();
    expect(fixture.prisma.backgroundJob.updateMany).not.toHaveBeenCalled();
  });
});
