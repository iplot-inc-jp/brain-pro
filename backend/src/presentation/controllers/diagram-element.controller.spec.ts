// diagram-element.controller.spec.ts
import { DiagramElementController, DiagramElementByIdController } from './diagram-element.controller';

function makePrisma(overrides: any = {}) {
  const p: any = {
    diagramElement: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: 'de1', rotation: 0, z: 0, text: '', ...data })),
      findUnique: jest.fn(async () => ({ id: 'de1', projectId: 'p1' })),
      update: jest.fn(async ({ data }: any) => ({ id: 'de1', projectId: 'p1', ...data })),
      delete: jest.fn(async () => undefined),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      upsert: jest.fn(async ({ create }: any) => ({ ...create })),
    },
    // diagramId / attachmentId のクロステナント検証用（既定は projectId 一致）。
    businessFlow: { findUnique: jest.fn(async () => ({ projectId: 'p1' })) },
    dfdDiagram: { findUnique: jest.fn(async () => ({ projectId: 'p1' })) },
    attachment: {
      findFirst: jest.fn(async () => ({ id: 'a1' })),
      findMany: jest.fn(async () => []),
    },
    ...overrides,
  };
  // $transaction はコールバックに自身(tx)を渡す簡易モック。
  p.$transaction = jest.fn(async (cb: any) => cb(p));
  return p as any;
}
const access = () => ({ assertProjectAccess: jest.fn(async () => undefined) }) as any;
const user = { id: 'u1' } as any;

describe('DiagramElementController', () => {
  it('create persists diagramKind/diagramId/type with defaults', async () => {
    const prisma = makePrisma();
    const c = new DiagramElementController(prisma);
    const out = await c.create('p1', {
      diagramKind: 'FLOW', diagramId: 'f1', attachmentId: 'a1',
    } as any);
    const arg = prisma.diagramElement.create.mock.calls[0][0].data;
    expect(arg.projectId).toBe('p1');
    expect(arg.diagramKind).toBe('FLOW');
    expect(arg.type).toBe('IMAGE'); // default
    expect(out.id).toBe('de1');
  });

  it('list filters by diagramKind + diagramId', async () => {
    const prisma = makePrisma();
    const c = new DiagramElementController(prisma);
    await c.list('p1', 'FLOW' as any, 'f1');
    expect(prisma.diagramElement.findMany.mock.calls[0][0].where).toEqual({
      projectId: 'p1', diagramKind: 'FLOW', diagramId: 'f1',
    });
  });

  it('returns [] for an invalid diagramKind query without hitting Prisma (no 500)', async () => {
    const prisma = makePrisma();
    const c = new DiagramElementController(prisma);
    const out = await c.list('p1', 'GARBAGE' as any, 'f1');
    expect(out).toEqual([]);
    expect(prisma.diagramElement.findMany).not.toHaveBeenCalled();
  });

  it('rejects a diagramId belonging to another project (cross-tenant)', async () => {
    const prisma = makePrisma({
      businessFlow: { findUnique: jest.fn(async () => ({ projectId: 'OTHER' })) },
    });
    const c = new DiagramElementController(prisma);
    await expect(
      c.create('p1', { diagramKind: 'FLOW', diagramId: 'f-other' } as any),
    ).rejects.toThrow();
    expect(prisma.diagramElement.create).not.toHaveBeenCalled();
  });

  it('rejects an attachmentId belonging to another project (cross-tenant)', async () => {
    const prisma = makePrisma({
      attachment: { findFirst: jest.fn(async () => null) }, // 別プロジェクトの添付は projectId 絞りで見つからない
    });
    const c = new DiagramElementController(prisma);
    await expect(
      c.create('p1', { diagramKind: 'FLOW', diagramId: 'f1', attachmentId: 'a-other' } as any),
    ).rejects.toThrow();
    expect(prisma.diagramElement.create).not.toHaveBeenCalled();
  });

  it('restore: scope内既存idはupdate・未存在idはcreate(id保持)、不在の要素は削除、未知添付はnull', async () => {
    const prisma = makePrisma({
      attachment: {
        findFirst: jest.fn(async () => ({ id: 'a1' })),
        findMany: jest.fn(async () => [{ id: 'a1' }]), // a1 のみ実在、a-deleted は無い
      },
    });
    // このスコープの現存要素は de1 のみ（de2 は削除済み＝undo で復活させる）。
    prisma.diagramElement.findMany = jest.fn(async () => [{ id: 'de1' }]);
    const c = new DiagramElementController(prisma);
    await c.restore('p1', {
      diagramKind: 'FLOW',
      diagramId: 'f1',
      elements: [
        { id: 'de1', type: 'IMAGE', positionX: 5, positionY: 6, attachmentId: 'a1' },
        { id: 'de2', type: 'IMAGE', positionX: 7, positionY: 8, attachmentId: 'a-deleted' },
      ],
    } as any);
    // スナップショットに無い要素を削除（id 保持の差分置換）。
    expect(prisma.diagramElement.deleteMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', diagramKind: 'FLOW', diagramId: 'f1', type: 'IMAGE', id: { notIn: ['de1', 'de2'] } },
    });
    // 既存 de1 は update（クロステナント書込防止＝スコープ内 id のみ update）。
    const upd = prisma.diagramElement.update.mock.calls.map((x: any) => x[0]);
    expect(upd.some((u: any) => u.where.id === 'de1')).toBe(true);
    const de1Upd = upd.find((u: any) => u.where.id === 'de1');
    expect(de1Upd.data.attachmentId).toBe('a1'); // 実在する添付は維持
    // 未存在 de2 は id 指定で create（= 削除の undo で同一 id 復活）。未知添付は null。
    const cre = prisma.diagramElement.create.mock.calls.map((x: any) => x[0].data);
    const de2 = cre.find((d: any) => d.id === 'de2');
    expect(de2).toBeTruthy();
    expect(de2.projectId).toBe('p1');
    expect(de2.attachmentId).toBeNull();
  });
});

describe('DiagramElementByIdController', () => {
  it('patch asserts edit access then updates only provided fields', async () => {
    const prisma = makePrisma();
    const acc = access();
    const c = new DiagramElementByIdController(prisma, acc);
    await c.patch(user, 'de1', { positionX: 10, positionY: 20 } as any);
    expect(acc.assertProjectAccess).toHaveBeenCalledWith('p1', 'u1', 'edit');
    const data = prisma.diagramElement.update.mock.calls[0][0].data;
    expect(data).toEqual({ positionX: 10, positionY: 20 });
  });

  it('remove asserts edit access then deletes by id', async () => {
    const prisma = makePrisma();
    const acc = access();
    const c = new DiagramElementByIdController(prisma, acc);
    await c.remove(user, 'de1');
    expect(acc.assertProjectAccess).toHaveBeenCalledWith('p1', 'u1', 'edit');
    expect(prisma.diagramElement.delete).toHaveBeenCalledWith({ where: { id: 'de1' } });
  });
});
