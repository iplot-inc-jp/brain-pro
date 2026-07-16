import { BadRequestException } from '@nestjs/common';
import {
  KnowledgeDocumentController,
  KnowledgeDocumentPageController,
} from './knowledge.controller';

describe('KnowledgeDocumentController page extraction endpoints', () => {
  const user = { id: 'u1' } as never;

  function fixture(options?: {
    document?: { id: string; projectId: string } | null;
    page?: Record<string, unknown> | null;
  }) {
    const document =
      options && 'document' in options
        ? options.document
        : { id: 'doc-1', projectId: 'project-1' };
    const page =
      options && 'page' in options
        ? options.page
        : {
            id: 'page-2',
            projectId: 'project-1',
            pageNumber: 2,
            pageKind: 'PDF_PAGE',
            status: 'FAILED',
            summary: null,
            contentText: null,
            error: '抽出失敗',
            jobId: 'child-2',
            job: {
              id: 'child-2',
              projectId: 'project-1',
              parentJobId: 'root-1',
              type: 'KG_INGEST_PAGE',
              status: 'FAILED',
              parent: {
                id: 'root-1',
                projectId: 'project-1',
                parentJobId: null,
                type: 'KG_INGEST_FILE',
              },
            },
          };
    const prisma = {
      knowledgeDocument: {
        findUnique: jest.fn(async () => document),
      },
      knowledgeDocumentPage: {
        findMany: jest.fn(async () => [
          {
            id: 'page-1',
            pageNumber: 1,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            summary: '1ページ目',
            contentText: '本文',
            error: null,
          },
        ]),
        findUnique: jest.fn(async () => page),
      },
    };
    const projectAccess = {
      assertPrincipalAccess: jest.fn(async () => undefined),
    };
    const jobs = { retry: jest.fn(async () => page?.job) };
    const controller = new KnowledgeDocumentController(
      {} as never,
      {} as never,
      {} as never,
      prisma as never,
      projectAccess as never,
      {} as never,
    );
    const pageController = new KnowledgeDocumentPageController(
      prisma as never,
      projectAccess as never,
      jobs as never,
    );
    return { controller, pageController, prisma, projectAccess, jobs };
  }

  it('returns project-scoped pages in page order without raw extraction JSON', async () => {
    const { controller, prisma, projectAccess } = fixture();

    const result = await controller.pages(user, 'doc-1');

    expect(projectAccess.assertPrincipalAccess).toHaveBeenCalledWith(
      user,
      'project-1',
      'view',
    );
    expect(prisma.knowledgeDocumentPage.findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', knowledgeDocumentId: 'doc-1' },
      orderBy: { pageNumber: 'asc' },
      select: {
        id: true,
        pageNumber: true,
        pageKind: true,
        status: true,
        summary: true,
        contentText: true,
        error: true,
      },
    });
    expect(result[0]).not.toHaveProperty('extractionResult');
  });

  it('does not query pages when the document is outside the caller project access', async () => {
    const { controller, prisma, projectAccess } = fixture();
    projectAccess.assertPrincipalAccess.mockRejectedValueOnce(
      new Error('forbidden'),
    );

    await expect(controller.pages(user, 'doc-1')).rejects.toThrow('forbidden');
    expect(prisma.knowledgeDocumentPage.findMany).not.toHaveBeenCalled();
  });

  it('retries only the failed page job under its existing parent', async () => {
    const { pageController, projectAccess, jobs } = fixture();

    const result = await pageController.retry(user, 'page-2');

    expect(projectAccess.assertPrincipalAccess).toHaveBeenCalledWith(
      user,
      'project-1',
      'edit',
    );
    expect(jobs.retry).toHaveBeenCalledWith('child-2');
    expect(result).toEqual(expect.objectContaining({ id: 'child-2' }));
  });

  it('never retries a succeeded page', async () => {
    const { pageController, jobs } = fixture({
      page: {
        id: 'page-2',
        projectId: 'project-1',
        status: 'SUCCEEDED',
        jobId: 'child-2',
        job: {
          id: 'child-2',
          projectId: 'project-1',
          parentJobId: 'root-1',
          type: 'KG_INGEST_PAGE',
          status: 'SUCCEEDED',
          parent: {
            id: 'root-1',
            projectId: 'project-1',
            parentJobId: null,
            type: 'KG_INGEST_FILE',
          },
        },
      },
    });

    await expect(pageController.retry(user, 'page-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(jobs.retry).not.toHaveBeenCalled();
  });

  it('rejects a page whose job no longer owns the page hierarchy', async () => {
    const { pageController, jobs } = fixture({
      page: {
        id: 'page-2',
        projectId: 'project-1',
        status: 'FAILED',
        jobId: 'child-2',
        job: {
          id: 'child-2',
          projectId: 'other-project',
          parentJobId: null,
          type: 'KG_INGEST_PAGE',
          status: 'FAILED',
          parent: null,
        },
      },
    });

    await expect(pageController.retry(user, 'page-2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(jobs.retry).not.toHaveBeenCalled();
  });
});
