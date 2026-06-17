// diagram-element.controller.spec.ts
import { DiagramElementController, DiagramElementByIdController } from './diagram-element.controller';

function makePrisma(overrides: any = {}) {
  return {
    diagramElement: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: 'de1', rotation: 0, z: 0, text: '', ...data })),
      findUnique: jest.fn(async () => ({ id: 'de1', projectId: 'p1' })),
      update: jest.fn(async ({ data }: any) => ({ id: 'de1', projectId: 'p1', ...data })),
      delete: jest.fn(async () => undefined),
    },
    ...overrides,
  } as any;
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
});
