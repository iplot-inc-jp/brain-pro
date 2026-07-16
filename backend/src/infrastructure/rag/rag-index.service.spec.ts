import { RagIndexService } from './rag-index.service';

const bundle = {
  featureType: 'TASK' as const,
  targetKey: 'project',
  sourceHash: 'source-hash-v1',
  overview: {
    sourceKey: 'project:TASK',
    sourceUrl: '/dashboard/projects/p1/tasks',
    title: 'タスク全体',
    facts: { count: 2 },
    metadata: { targetKey: 'project' },
  },
  components: [
    { sourceKey: 't1', sourceUrl: '/tasks/t1', title: '要件確認', facts: { status: 'OPEN' } },
    { sourceKey: 't2', sourceUrl: '/tasks/t2', title: '設計', facts: { status: 'DONE' } },
  ],
};

const compressed = (sourceKey: string, title = sourceKey) => ({
  sourceKey,
  title,
  summary: `${title}の概要`,
  content: `${title}の事実`,
  keywords: [title],
  aliases: [],
  questions: [`${title}とは？`],
});

function makeDeps() {
  const prisma: any = {
    ragDocument: {
      upsert: jest.fn(async ({ create }: any) => ({ id: create.sourceKey, ...create })),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
    $queryRaw: jest.fn(async () => []),
  };
  const source = { build: jest.fn(async () => structuredClone(bundle)) };
  const claude = {
    compressForRag: jest.fn(async (items: any[]) => ({
      model: 'claude-sonnet-4-6',
      documents: items.map((row) => compressed(row.sourceKey, row.title)),
    })),
  };
  return { prisma, source, claude };
}

describe('RagIndexService.generate', () => {
  it('Claude全バッチ成功後にoverviewとcomponentsを1トランザクションで保存する', async () => {
    const deps = makeDeps();
    const service = new RagIndexService(deps.prisma, deps.source as any, deps.claude as any);
    const result = await service.generate({
      projectId: 'p1', featureType: 'TASK', userId: 'u1', apiKey: 'sk-test',
    });

    expect(deps.claude.compressForRag).toHaveBeenCalledTimes(2);
    expect(deps.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(deps.prisma.ragDocument.upsert).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ featureType: 'TASK', targetKey: 'project', documentCount: 3 });
    const creates = deps.prisma.ragDocument.upsert.mock.calls.map((call: any[]) => call[0].create);
    expect(creates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scopeLevel: 'OVERVIEW', sourceKey: 'project:TASK', sourceHash: 'source-hash-v1' }),
        expect.objectContaining({ scopeLevel: 'COMPONENT', sourceKey: 't1', generatedById: 'u1' }),
      ]),
    );
  });

  it('再生成時に応答から消えた同一targetのcomponentだけを削除する', async () => {
    const deps = makeDeps();
    await new RagIndexService(deps.prisma, deps.source as any, deps.claude as any).generate({
      projectId: 'p1', featureType: 'TASK', apiKey: 'sk-test',
    });
    expect(deps.prisma.ragDocument.deleteMany).toHaveBeenCalledWith({
      where: {
        projectId: 'p1', featureType: 'TASK', targetKey: 'project', scopeLevel: 'COMPONENT',
        sourceKey: { notIn: ['t1', 't2'] },
      },
    });
  });

  it('Claudeが途中失敗した場合は永続トランザクションを開始しない', async () => {
    const deps = makeDeps();
    deps.claude.compressForRag.mockRejectedValueOnce(new Error('Claude unavailable'));
    await expect(
      new RagIndexService(deps.prisma, deps.source as any, deps.claude as any).generate({
        projectId: 'p1', featureType: 'TASK', apiKey: 'sk-test',
      }),
    ).rejects.toThrow('Claude unavailable');
    expect(deps.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('RagIndexService.status', () => {
  it('索引が無ければ UNGENERATED', async () => {
    const deps = makeDeps();
    const result = await new RagIndexService(deps.prisma, deps.source as any, deps.claude as any)
      .status('p1', 'TASK');
    expect(result.state).toBe('UNGENERATED');
  });

  it('sourceHashが一致すれば FRESH、不一致なら STALE', async () => {
    const deps = makeDeps();
    deps.prisma.ragDocument.findMany.mockResolvedValueOnce([
      { sourceHash: 'source-hash-v1', generatedAt: new Date('2026-07-16'), model: 'm', summary: 'ok', scopeLevel: 'OVERVIEW' },
      { sourceHash: 'source-hash-v1', generatedAt: new Date('2026-07-16'), model: 'm', summary: 'part', scopeLevel: 'COMPONENT' },
    ]);
    const service = new RagIndexService(deps.prisma, deps.source as any, deps.claude as any);
    expect((await service.status('p1', 'TASK')).state).toBe('FRESH');

    deps.prisma.ragDocument.findMany.mockResolvedValueOnce([
      { sourceHash: 'old', generatedAt: new Date('2026-07-16'), model: 'm', summary: 'old', scopeLevel: 'OVERVIEW' },
    ]);
    expect((await service.status('p1', 'TASK')).state).toBe('STALE');
  });
});

describe('RagIndexService.search', () => {
  it('project・機能・階層をパラメータ化しlimitを50へ丸める', async () => {
    const deps = makeDeps();
    deps.prisma.$queryRaw.mockResolvedValueOnce([
      { id: 'd1', projectId: 'p1', featureType: 'TASK', scopeLevel: 'COMPONENT', sourceKey: 't1', sourceUrl: '/tasks/t1', title: '受注確認', summary: '概要', content: '本文', keywords: ['受注'], aliases: [], questions: [], metadata: {}, generatedAt: new Date(), score: 4.5 },
    ]);
    const result = await new RagIndexService(deps.prisma, deps.source as any, deps.claude as any)
      .search('p1', { q: '受注', featureType: 'TASK', scopeLevel: 'COMPONENT', limit: 999 });

    expect(result[0]).toMatchObject({ title: '受注確認', score: 4.5 });
    const sql = deps.prisma.$queryRaw.mock.calls[0][0];
    expect(sql.strings.join(' ')).toContain('project_id');
    expect(sql.values).toEqual(expect.arrayContaining(['p1', 'TASK', 'COMPONENT', '受注', 50]));
  });

  it('空クエリでは新しい索引を一覧する', async () => {
    const deps = makeDeps();
    deps.prisma.ragDocument.findMany.mockResolvedValueOnce([{ id: 'd1', title: '最新' }]);
    const result = await new RagIndexService(deps.prisma, deps.source as any, deps.claude as any)
      .search('p1', { q: '', limit: 10 });
    expect(deps.prisma.ragDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'p1' }, take: 10 }),
    );
    expect(result[0]).toMatchObject({ title: '最新', score: 0 });
  });
});
