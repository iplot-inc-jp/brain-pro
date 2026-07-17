import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  getPromptDefinition,
  PROMPT_DEFINITIONS,
  renderPromptTemplate,
} from './prompt-registry';
import { PromptService } from './prompt.service';

const ragDefaults = getPromptDefinition('rag')!;

type Row = {
  id: string;
  projectId: string;
  key: string;
  version: number;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
};

function makePrisma(initial: Row[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  const promptVersion = {
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      const found = rows
        .filter((row) => row.projectId === where.projectId)
        .filter((row) => where.key === undefined || row.key === where.key)
        .filter((row) => where.isActive === undefined || row.isActive === where.isActive)
        .sort((a, b) => orderBy?.version === 'desc' ? b.version - a.version : 0);
      return found[0] ?? null;
    }),
    findMany: jest.fn(async ({ where }: any) => rows
      .filter((row) => row.projectId === where.projectId)
      .filter((row) => where.key === undefined || row.key === where.key)
      .filter((row) => where.isActive === undefined || row.isActive === where.isActive)
      .sort((a, b) => b.version - a.version)),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) {
        if (
          row.projectId === where.projectId &&
          row.key === where.key &&
          row.isActive === where.isActive
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `pv-${data.key}-${data.version}`,
        createdAt: new Date(`2026-07-${String(data.version).padStart(2, '0')}T00:00:00Z`),
        ...data,
      } as Row;
      rows.push(row);
      return row;
    }),
  };
  const prisma: any = {
    promptVersion,
    $transaction: jest.fn(async (callback: any) => callback({ promptVersion })),
  };
  return { prisma, rows, promptVersion };
}

describe('PromptService', () => {
  it('未設定ならレジストリの既定値をv1として一度だけ作成する', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);

    const first = await service.getActive('p1', 'rag', 'u1');
    const second = await service.getActive('p1', 'rag', 'u1');

    expect(first).toMatchObject({
      projectId: 'p1', key: 'rag', version: 1, model: ragDefaults.fallbackModel,
      systemPrompt: ragDefaults.defaultSystemPrompt, isActive: true, createdById: 'u1',
    });
    expect(second.id).toBe(first.id);
    expect(db.promptVersion.create).toHaveBeenCalledTimes(1);
  });

  it('版はキーごとに独立して管理する', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);

    await service.getActive('p1', 'rag', 'u1');
    await service.getActive('p1', 'kpi-generate', 'u1');
    await service.update('p1', 'kpi-generate', {
      model: 'claude-haiku-4-5', systemPrompt: 'KPI用の変更版',
    }, 'u1');

    const rag = await service.getActive('p1', 'rag', 'u1');
    const kpi = await service.getActive('p1', 'kpi-generate', 'u1');
    expect(rag).toMatchObject({ key: 'rag', version: 1, isActive: true });
    expect(kpi).toMatchObject({ key: 'kpi-generate', version: 2, model: 'claude-haiku-4-5' });
  });

  it('更新時は旧版を残し、新しい版だけを有効にする', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);
    await service.getActive('p1', 'rag', 'u1');

    const updated = await service.update('p1', 'rag', {
      model: 'claude-haiku-4-5',
      systemPrompt: '検索用に事実だけを短くまとめてください。',
    }, 'u2');

    expect(updated).toMatchObject({ version: 2, model: 'claude-haiku-4-5', isActive: true });
    expect(db.rows).toHaveLength(2);
    expect(db.rows.find((row) => row.version === 1)?.isActive).toBe(false);
    expect(db.prisma.$transaction).toHaveBeenCalled();
  });

  it('履歴を新しい版から返し、リセットも新しい版にする', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);
    await service.getActive('p1', 'rag', 'u1');
    await service.update('p1', 'rag', {
      model: 'claude-haiku-4-5', systemPrompt: '変更版プロンプト',
    }, 'u1');
    const reset = await service.reset('p1', 'rag', 'u2');
    const settings = await service.getSettings('p1', 'rag', 'u2');

    expect(reset).toMatchObject({
      version: 3, model: ragDefaults.fallbackModel,
      systemPrompt: ragDefaults.defaultSystemPrompt,
    });
    expect(settings.history.map((row: Row) => row.version)).toEqual([3, 2, 1]);
    expect(settings.active.version).toBe(3);
    expect(settings.definition.key).toBe('rag');
    expect(db.promptVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      }),
    );
  });

  it('一覧は全定義を返し、有効版があればそのモデルを反映する', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);
    await service.update('p1', 'rag', {
      model: 'claude-haiku-4-5', systemPrompt: '変更版プロンプト',
    }, 'u1');

    const result = await service.list('p1');
    expect(result.prompts).toHaveLength(PROMPT_DEFINITIONS.length);
    const rag = result.prompts.find((p: any) => p.key === 'rag');
    expect(rag).toMatchObject({ model: 'claude-haiku-4-5', customized: true });
    const kpi = result.prompts.find((p: any) => p.key === 'kpi-generate');
    expect(kpi).toMatchObject({ version: null, customized: false });
  });

  it('resolveはprojectId無しならDBに触れず既定値を返す', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);

    const resolved = await service.resolve('rag');

    expect(resolved).toEqual({
      model: ragDefaults.fallbackModel,
      systemPrompt: ragDefaults.defaultSystemPrompt,
      promptVersionId: null,
    });
    expect(db.promptVersion.findFirst).not.toHaveBeenCalled();
  });

  it('resolveはprojectIdがあればアクティブ版と版IDを返す', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);
    await service.update('p1', 'rag', {
      model: 'claude-haiku-4-5', systemPrompt: '変更版プロンプト',
    }, 'u1');

    const resolved = await service.resolve('rag', 'p1', 'u1');
    expect(resolved).toMatchObject({
      model: 'claude-haiku-4-5',
      systemPrompt: '変更版プロンプト',
      promptVersionId: 'pv-rag-1',
    });
  });

  it('未知のキーは404にする', async () => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);
    await expect(service.resolve('no-such-key', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    ['未許可モデル', { model: 'unknown', systemPrompt: '有効な本文' }, 'モデル'],
    ['空プロンプト', { model: 'claude-sonnet-4-6', systemPrompt: '   ' }, '空'],
    ['長すぎるプロンプト', { model: 'claude-sonnet-4-6', systemPrompt: 'x'.repeat(20_001) }, '20000'],
  ])('%sをDBへ保存しない', async (_caseName, input, message) => {
    const db = makePrisma();
    const service = new PromptService(db.prisma);
    await expect(service.update('p1', 'rag', input, 'u1')).rejects.toThrow(message);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('同時更新の版番号競合を409へ変換する', async () => {
    const db = makePrisma();
    db.promptVersion.findFirst.mockResolvedValueOnce({
      id: 'pv1', projectId: 'p1', key: 'rag', version: 1,
      model: ragDefaults.fallbackModel,
      systemPrompt: ragDefaults.defaultSystemPrompt, isActive: true,
      createdById: 'u1', createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    db.promptVersion.create.mockRejectedValueOnce({ code: 'P2002' });
    const service = new PromptService(db.prisma);

    await expect(service.update('p1', 'rag', {
      model: ragDefaults.fallbackModel, systemPrompt: '競合する更新',
    }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('renderPromptTemplate', () => {
  it('{{変数}}を置換し、未定義の変数はそのまま残す', () => {
    const rendered = renderPromptTemplate(
      'kind は "{{expectedKind}}"（{{ expectedKindLabel }}）。{{unknown}} も維持。',
      { expectedKind: 'ACTION', expectedKindLabel: '打ち手' },
    );
    expect(rendered).toBe('kind は "ACTION"（打ち手）。{{unknown}} も維持。');
  });

  it('定義済みプロンプトの変数はすべて既定テンプレートに現れる', () => {
    for (const def of PROMPT_DEFINITIONS) {
      for (const variable of def.variables ?? []) {
        expect(def.defaultSystemPrompt).toContain(`{{${variable.name}}}`);
      }
    }
  });
});
