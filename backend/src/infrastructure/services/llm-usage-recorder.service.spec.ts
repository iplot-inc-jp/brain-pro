import { LlmUsageRecorder } from './llm-usage-recorder.service';

function makePrisma(createImpl?: () => Promise<unknown>) {
  return {
    llmUsageLog: { create: jest.fn(createImpl ?? (async () => ({}))) },
  } as any;
}

describe('LlmUsageRecorder', () => {
  it('usage を llm_usage_logs に1行 insert する（area/model/トークン）', async () => {
    const prisma = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    await rec.record(
      { projectId: 'p1', area: 'KPI', userId: 'u1' },
      'claude-sonnet-4-6',
      { input_tokens: 100, output_tokens: 50 },
    );
    expect(prisma.llmUsageLog.create).toHaveBeenCalledTimes(1);
    const arg = prisma.llmUsageLog.create.mock.calls[0][0].data;
    expect(arg).toMatchObject({
      projectId: 'p1',
      area: 'KPI',
      userId: 'u1',
      model: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it('insert が失敗しても例外を投げない（AI本処理を壊さない）', async () => {
    const prisma = makePrisma(async () => {
      throw new Error('db down');
    });
    const rec = new LlmUsageRecorder(prisma);
    await expect(
      rec.record({ projectId: 'p1', area: 'OTHER' }, 'm', {
        input_tokens: 1,
        output_tokens: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('projectId が空なら記録しない', async () => {
    const prisma = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    await rec.record({ projectId: '', area: 'OTHER' }, 'm', {
      input_tokens: 1,
      output_tokens: 1,
    });
    expect(prisma.llmUsageLog.create).not.toHaveBeenCalled();
  });

  it('usage 欠落時は 0 で記録、cache tokens は null', async () => {
    const prisma = makePrisma();
    const rec = new LlmUsageRecorder(prisma);
    await rec.record({ projectId: 'p1', area: 'OTHER' }, 'm', null);
    const arg = prisma.llmUsageLog.create.mock.calls[0][0].data;
    expect(arg.inputTokens).toBe(0);
    expect(arg.outputTokens).toBe(0);
    expect(arg.cacheReadInputTokens).toBeNull();
  });
});
