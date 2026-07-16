import { JobService } from '../../infrastructure/services/job.service';
import { validate } from 'class-validator';
import { RagController, UpdateRagSettingsDto } from './rag.controller';

function controllerWithPrompts() {
  const jobs = { enqueue: jest.fn() };
  const index = { status: jest.fn(), list: jest.fn(), search: jest.fn() };
  const prompts = {
    getSettings: jest.fn(async () => ({ active: { version: 1 }, history: [] })),
    update: jest.fn(async () => ({ version: 2 })),
    reset: jest.fn(async () => ({ version: 3 })),
  };
  const controller = new (RagController as any)(jobs, index, prompts) as RagController;
  return { controller, prompts };
}

describe('RagController', () => {
  it('生成ジョブには機能種別と対象IDだけを渡し、鍵をpayloadへ入れない', async () => {
    const jobs = {
      enqueue: jest.fn(async () => ({ id: 'job1', status: 'QUEUED' })),
    };
    const index = { status: jest.fn(), list: jest.fn(), search: jest.fn() };
    const controller = new RagController(jobs as any, index as any, {} as any);

    const result = await controller.generate(
      { id: 'u1' } as any,
      'p1',
      { featureType: 'BUSINESS_FLOW', targetId: 'f1' },
    );

    expect(jobs.enqueue).toHaveBeenCalledWith(
      'AI_RAG_SUMMARIZE',
      { featureType: 'BUSINESS_FLOW', targetId: 'f1' },
      { projectId: 'p1', createdById: 'u1' },
    );
    expect(result).toEqual({ jobId: 'job1', status: 'QUEUED' });
    expect(JSON.stringify(jobs.enqueue.mock.calls[0])).not.toContain('apiKey');
  });

  it('状態・一覧・検索へprojectIdと検証済みフィルターを渡す', async () => {
    const jobs = { enqueue: jest.fn() };
    const index = {
      status: jest.fn(async () => ({ state: 'FRESH' })),
      list: jest.fn(async () => []),
      search: jest.fn(async () => []),
    };
    const controller = new RagController(jobs as any, index as any, {} as any);

    await controller.status('p1', 'TASK', 'task1');
    await controller.documents('p1', 'TASK', 'COMPONENT', '8');
    await controller.search('p1', '受注', 'TASK', 'OVERVIEW', '6');

    expect(index.status).toHaveBeenCalledWith('p1', 'TASK', 'task1');
    expect(index.list).toHaveBeenCalledWith('p1', {
      featureType: 'TASK', scopeLevel: 'COMPONENT', limit: 8,
    });
    expect(index.search).toHaveBeenCalledWith('p1', {
      q: '受注', featureType: 'TASK', scopeLevel: 'OVERVIEW', limit: 6,
    });
  });
});

describe('RagController settings', () => {
  it('設定取得・新バージョン保存・既定値復元へprojectとuserを渡す', async () => {
    const { controller, prompts } = controllerWithPrompts();
    const user = { id: 'u1' } as any;

    await controller.settings(user, 'p1');
    await controller.updateSettings(user, 'p1', {
      model: 'claude-haiku-4-5', systemPrompt: 'DB管理のプロンプト',
    });
    await controller.resetSettings(user, 'p1');

    expect(prompts.getSettings).toHaveBeenCalledWith('p1', 'u1');
    expect(prompts.update).toHaveBeenCalledWith('p1', {
      model: 'claude-haiku-4-5', systemPrompt: 'DB管理のプロンプト',
    }, 'u1');
    expect(prompts.reset).toHaveBeenCalledWith('p1', 'u1');
  });

  it.each([
    ['unknown', '有効な本文'],
    ['claude-sonnet-4-6', '   '],
    ['claude-sonnet-4-6', 'x'.repeat(20_001)],
  ])('不正なモデル／プロンプトをDTOで拒否する', async (model, systemPrompt) => {
    const dto = Object.assign(new UpdateRagSettingsDto(), { model, systemPrompt });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});

describe('JobService AI_RAG_SUMMARIZE dispatch', () => {
  it('許可ジョブとしてAPIキーを実行時解決し、RagIndexServiceへ進捗関数付きで渡す', async () => {
    const ragIndex = { generate: jest.fn(async () => ({ documentCount: 2 })) };
    const companyKey = { resolveForProject: jest.fn(async () => 'sk-runtime') };
    const prisma = { backgroundJob: { update: jest.fn(async () => ({})) } };
    const service = new JobService(
      prisma as any,
      {} as any,
      companyKey as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      ragIndex as any,
    );

    expect(JobService.isAllowedType('AI_RAG_SUMMARIZE')).toBe(true);
    const result = await (service as any).dispatch({
      id: 'job1', type: 'AI_RAG_SUMMARIZE', projectId: 'p1', createdById: 'u1',
      payload: { featureType: 'TASK', targetId: 'task1' },
    });

    expect(companyKey.resolveForProject).toHaveBeenCalledWith('p1', 'u1');
    expect(ragIndex.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1', featureType: 'TASK', targetId: 'task1', userId: 'u1', apiKey: 'sk-runtime',
        onProgress: expect.any(Function),
      }),
    );
    expect(result).toEqual({ kind: 'RAG_INDEX', documentCount: 2 });
  });
});
