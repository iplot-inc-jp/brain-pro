import { GetLlmUsageSummaryUseCase } from './get-llm-usage-summary.use-case';

function makeDeps(rows: any[]) {
  const prisma = {
    llmUsageLog: {
      findMany: jest.fn(async () => rows),
    },
  } as any;
  const access = { assertProjectAccess: jest.fn(async () => undefined) } as any;
  return { prisma, access };
}

const ROWS = [
  { id: 'a', area: 'KPI', model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500, cacheReadInputTokens: null, cacheCreationInputTokens: null, createdAt: new Date('2026-06-15T00:00:00Z') },
  { id: 'b', area: 'KPI', model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 0, cacheReadInputTokens: null, cacheCreationInputTokens: null, createdAt: new Date('2026-06-15T01:00:00Z') },
  { id: 'c', area: 'KNOWLEDGE_EXTRACTION', model: 'claude-opus-4-8', inputTokens: 100, outputTokens: 100, cacheReadInputTokens: null, cacheCreationInputTokens: null, createdAt: new Date('2026-06-15T02:00:00Z') },
];

describe('GetLlmUsageSummaryUseCase', () => {
  it('byModel/byArea で集計し、合計と概算コストを返す', async () => {
    const { prisma, access } = makeDeps(ROWS);
    const uc = new GetLlmUsageSummaryUseCase(prisma, access);
    const r = await uc.execute({ projectId: 'p1', userId: 'u1', period: 'all' });

    expect(access.assertProjectAccess).toHaveBeenCalledWith('p1', 'u1', 'view');
    expect(r.totalInputTokens).toBe(3100);
    expect(r.totalOutputTokens).toBe(600);
    expect(r.totalTokens).toBe(3700);
    expect(r.byModel.map((m) => m.model).sort()).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
    expect(r.byArea.map((a) => a.area).sort()).toEqual([
      'KNOWLEDGE_EXTRACTION',
      'KPI',
    ]);
    const sonnet = r.byModel.find((m) => m.model === 'claude-sonnet-4-6')!;
    expect(sonnet.count).toBe(2);
    expect(sonnet.inputTokens).toBe(3000);
    expect(sonnet.costUsd).toBeGreaterThan(0);
    expect(r.totalCostUsd).toBeGreaterThan(0);
    expect(r.recent.length).toBe(3);
    expect(r.from).toBeNull(); // all は from なし
  });

  it('データ0件でも0集計を返す（month は当月初日）', async () => {
    const { prisma, access } = makeDeps([]);
    const uc = new GetLlmUsageSummaryUseCase(prisma, access);
    const r = await uc.execute({ projectId: 'p1', userId: 'u1', period: 'month' });
    expect(r.totalTokens).toBe(0);
    expect(r.byModel).toEqual([]);
    expect(r.byArea).toEqual([]);
    expect(r.from).not.toBeNull();
  });
});
