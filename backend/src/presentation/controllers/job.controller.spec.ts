import { NotFoundException } from '@nestjs/common';
import { ProjectJobController } from './job.controller';

describe('ProjectJobController hierarchy', () => {
  const user = { id: 'u1' } as never;

  function fixture(rootOverrides: Record<string, unknown> = {}) {
    const root = {
      id: 'root-1',
      projectId: 'project-1',
      parentJobId: null,
      type: 'KG_INGEST_FILE',
      status: 'FAILED',
      result: { internal: true },
      error:
        '抽出に失敗しました /srv/app/private/source.ts:42\n    at worker (/srv/app/private/worker.ts:9:1)',
      progress: 50,
      attempts: 2,
      maxAttempts: 4,
      createdById: 'internal-user',
      createdAt: new Date('2026-07-16T00:00:00.000Z'),
      updatedAt: new Date('2026-07-16T00:00:00.000Z'),
      startedAt: new Date('2026-07-16T00:00:00.000Z'),
      finishedAt: new Date('2026-07-16T00:01:00.000Z'),
      payload: { fileId: 'file-1' },
      children: [
        {
          id: 'merge-1',
          type: 'KG_MERGE_INGEST_FILE',
          status: 'QUEUED',
          result: { internal: true },
          error: null,
          progress: 0,
          attempts: 0,
          maxAttempts: 4,
          createdAt: new Date('2026-07-16T00:00:03.000Z'),
          finishedAt: null,
          knowledgePage: null,
        },
        {
          id: 'child-2',
          type: 'KG_INGEST_PAGE',
          status: 'FAILED',
          result: { internal: true },
          error: '抽出失敗\n at /srv/app/worker.ts:1:1',
          progress: 20,
          attempts: 4,
          maxAttempts: 4,
          createdAt: new Date('2026-07-16T00:00:02.000Z'),
          finishedAt: new Date('2026-07-16T00:01:00.000Z'),
          knowledgePage: {
            id: 'page-2',
            pageNumber: 2,
            pageKind: 'PDF_PAGE',
            status: 'FAILED',
            error: '抽出失敗',
          },
        },
        {
          id: 'child-1',
          type: 'KG_INGEST_PAGE',
          status: 'SUCCEEDED',
          result: { internal: true },
          error: null,
          progress: 100,
          attempts: 1,
          maxAttempts: 4,
          createdAt: new Date('2026-07-16T00:00:01.000Z'),
          finishedAt: new Date('2026-07-16T00:00:30.000Z'),
          knowledgePage: {
            id: 'page-1',
            pageNumber: 1,
            pageKind: 'PDF_PAGE',
            status: 'SUCCEEDED',
            error: null,
          },
        },
      ],
      ...rootOverrides,
    };
    const prisma = {
      backgroundJob: {
        findMany: jest.fn(async () => [root]),
        findUnique: jest.fn(async () => root),
        findFirst: jest.fn(async () =>
          root.parentJobId === null && root.projectId === 'project-1' ? root : null,
        ),
      },
      ingestionFile: {
        findFirst: jest.fn(async () => ({
          id: 'file-1',
          projectId: 'project-1',
          status: 'FAILED',
        })),
      },
    };
    const jobs = {
      resumeIngestionParent: jest.fn(async () => ({
        ...root,
        status: 'RUNNING',
      })),
    };
    const controller = new ProjectJobController(
      jobs as never,
      prisma as never,
      {} as never,
    );
    return { controller, prisma, jobs };
  }

  it('returns only roots and orders page children before merge children', async () => {
    const { controller, prisma } = fixture();

    const result = await controller.list('project-1', '20');
    const children = result[0].children ?? [];

    expect(prisma.backgroundJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'project-1', parentJobId: null } }),
    );
    expect(children.map((child) => child.id)).toEqual([
      'child-1',
      'child-2',
      'merge-1',
    ]);
    expect(children[0].knowledgePage).toEqual(
      expect.objectContaining({ pageNumber: 1, pageKind: 'PDF_PAGE' }),
    );
    expect(result[0]).not.toHaveProperty('payload');
    expect(result[0]).not.toHaveProperty('result');
    expect(result[0]).not.toHaveProperty('createdById');
    expect(children[1]).not.toHaveProperty('result');
    expect(result[0].error).toBe('抽出に失敗しました [path]');
    expect(children[1].error).toBe('抽出失敗');
    expect(JSON.stringify(result)).not.toContain('/srv/app');
  });

  it('resumes a valid root through the paged-file recovery path', async () => {
    const { controller, jobs } = fixture();

    await controller.resume(user, 'project-1', 'root-1');

    expect(jobs.resumeIngestionParent).toHaveBeenCalledWith(
      'root-1',
      'file-1',
      'project-1',
      false,
    );
  });

  it('rejects cross-project and non-root resume requests', async () => {
    const { controller, jobs } = fixture({ parentJobId: 'another-root' });

    await expect(
      controller.resume(user, 'project-1', 'root-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(jobs.resumeIngestionParent).not.toHaveBeenCalled();
  });
});
