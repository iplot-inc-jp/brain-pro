import { ConflictException } from '@nestjs/common';
import {
  DEFAULT_RAG_MODEL,
  DEFAULT_RAG_SYSTEM_PROMPT,
} from './rag-prompt.defaults';
import { RagPromptService } from './rag-prompt.service';

type Row = {
  id: string;
  projectId: string;
  version: number;
  model: string;
  systemPrompt: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: Date;
};

function makePrisma(initial: Row[] = []) {
  const rows = initial.map((row) => ({ ...row }));
  const ragPromptVersion = {
    findFirst: jest.fn(async ({ where, orderBy }: any) => {
      const found = rows
        .filter((row) => row.projectId === where.projectId)
        .filter((row) => where.isActive === undefined || row.isActive === where.isActive)
        .sort((a, b) => orderBy?.version === 'desc' ? b.version - a.version : 0);
      return found[0] ?? null;
    }),
    findMany: jest.fn(async ({ where }: any) => rows
      .filter((row) => row.projectId === where.projectId)
      .sort((a, b) => b.version - a.version)),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows) {
        if (row.projectId === where.projectId && row.isActive === where.isActive) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: any) => {
      const row = {
        id: `pv${data.version}`,
        createdAt: new Date(`2026-07-${String(data.version).padStart(2, '0')}T00:00:00Z`),
        ...data,
      } as Row;
      rows.push(row);
      return row;
    }),
  };
  const prisma: any = {
    ragPromptVersion,
    $transaction: jest.fn(async (callback: any) => callback({ ragPromptVersion })),
  };
  return { prisma, rows, ragPromptVersion };
}

describe('RagPromptService', () => {
  it('未設定なら安全な既定値をv1として一度だけ作成する', async () => {
    const db = makePrisma();
    const service = new RagPromptService(db.prisma);

    const first = await service.getActive('p1', 'u1');
    const second = await service.getActive('p1', 'u1');

    expect(first).toMatchObject({
      projectId: 'p1', version: 1, model: DEFAULT_RAG_MODEL,
      systemPrompt: DEFAULT_RAG_SYSTEM_PROMPT, isActive: true, createdById: 'u1',
    });
    expect(second.id).toBe(first.id);
    expect(db.ragPromptVersion.create).toHaveBeenCalledTimes(1);
  });

  it('更新時は旧版を残し、新しい版だけを有効にする', async () => {
    const db = makePrisma();
    const service = new RagPromptService(db.prisma);
    await service.getActive('p1', 'u1');

    const updated = await service.update('p1', {
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
    const service = new RagPromptService(db.prisma);
    await service.getActive('p1', 'u1');
    await service.update('p1', {
      model: 'claude-haiku-4-5', systemPrompt: '変更版プロンプト',
    }, 'u1');
    const reset = await service.reset('p1', 'u2');
    const settings = await service.getSettings('p1', 'u2');

    expect(reset).toMatchObject({
      version: 3, model: DEFAULT_RAG_MODEL, systemPrompt: DEFAULT_RAG_SYSTEM_PROMPT,
    });
    expect(settings.history.map((row: Row) => row.version)).toEqual([3, 2, 1]);
    expect(settings.active.version).toBe(3);
  });

  it.each([
    ['未許可モデル', { model: 'unknown', systemPrompt: '有効な本文' }, 'モデル'],
    ['空プロンプト', { model: DEFAULT_RAG_MODEL, systemPrompt: '   ' }, '空'],
    ['長すぎるプロンプト', { model: DEFAULT_RAG_MODEL, systemPrompt: 'x'.repeat(20_001) }, '20000'],
  ])('%sをDBへ保存しない', async (_caseName, input, message) => {
    const db = makePrisma();
    const service = new RagPromptService(db.prisma);
    await expect(service.update('p1', input, 'u1')).rejects.toThrow(message);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('同時更新の版番号競合を409へ変換する', async () => {
    const db = makePrisma();
    db.ragPromptVersion.findFirst.mockResolvedValueOnce({
      id: 'pv1', projectId: 'p1', version: 1, model: DEFAULT_RAG_MODEL,
      systemPrompt: DEFAULT_RAG_SYSTEM_PROMPT, isActive: true,
      createdById: 'u1', createdAt: new Date('2026-07-01T00:00:00Z'),
    });
    db.ragPromptVersion.create.mockRejectedValueOnce({ code: 'P2002' });
    const service = new RagPromptService(db.prisma);

    await expect(service.update('p1', {
      model: DEFAULT_RAG_MODEL, systemPrompt: '競合する更新',
    }, 'u1')).rejects.toBeInstanceOf(ConflictException);
  });
});
