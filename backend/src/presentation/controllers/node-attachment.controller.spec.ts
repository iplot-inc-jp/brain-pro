// node-attachment.controller.spec.ts
import { NodeAttachmentController, NodeAttachmentByIdController } from './node-attachment.controller';

const ATT = { id: 'a1', filename: 'spec.pdf', displayName: null, mimeType: 'application/pdf', kind: 'PDF', size: 9, url: '/api/attachments/a1/file', pageRange: null, blobUrl: 'https://x/a.pdf' };

function makePrisma(overrides: any = {}) {
  return {
    flowNode: { findUnique: jest.fn(async () => ({ id: 'fn1', label: '受注登録', flow: { projectId: 'p1' } })) },
    // 添付は projectId 絞りで取得（クロステナント混入防止）。
    attachment: { findFirst: jest.fn(async () => ATT) },
    nodeAttachment: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null), // 冪等チェック（既定は既存なし）
      findUnique: jest.fn(async () => ({ projectId: 'p1', attachmentId: 'a1' })), // remove() が projectId/attachmentId をロード
      create: jest.fn(async ({ data }: any) => ({ id: 'na1', order: 0, caption: null, ...data, attachment: ATT })),
      delete: jest.fn(async () => ({})),
    },
    ...overrides,
  } as any;
}
const bridge = () => ({
  ensureEntityForNode: jest.fn(async () => ({ knowledgeNodeId: 'kn1' })),
  registerAttachmentDocument: jest.fn(async () => ({ documentId: 'doc1' })),
  unregisterAttachmentDocumentIfOrphaned: jest.fn(async () => undefined),
}) as any;

function makeProjectAccess() {
  return { assertProjectAccess: jest.fn(async () => undefined) } as any;
}

describe('NodeAttachmentByIdController.remove', () => {
  it('calls bridge.unregisterAttachmentDocumentIfOrphaned after deleting the row', async () => {
    const prisma = makePrisma();
    const b = bridge();
    const pa = makeProjectAccess();
    const c = new NodeAttachmentByIdController(prisma, pa, b);
    await c.remove({ id: 'user1' } as any, 'na1');
    expect(prisma.nodeAttachment.delete).toHaveBeenCalledWith({ where: { id: 'na1' } });
    expect(b.unregisterAttachmentDocumentIfOrphaned).toHaveBeenCalledWith('p1', 'a1');
  });

  it('does not throw if bridge.unregisterAttachmentDocumentIfOrphaned rejects (best-effort)', async () => {
    const prisma = makePrisma();
    const b = bridge();
    b.unregisterAttachmentDocumentIfOrphaned.mockRejectedValue(new Error('KG down'));
    const pa = makeProjectAccess();
    const c = new NodeAttachmentByIdController(prisma, pa, b);
    // should not throw even if KG cleanup fails
    await expect(c.remove({ id: 'user1' } as any, 'na1')).resolves.toBeUndefined();
  });
});

describe('NodeAttachmentController.create', () => {
  it('creates the join row and auto-registers the attachment into the KG', async () => {
    const prisma = makePrisma();
    const b = bridge();
    const c = new NodeAttachmentController(prisma, b);
    const out = await c.create('p1', { nodeKind: 'FLOW_NODE', nodeId: 'fn1', attachmentId: 'a1' } as any);
    expect(out.id).toBe('na1');
    expect(b.ensureEntityForNode).toHaveBeenCalledWith('p1', 'FLOW_NODE', 'fn1', '受注登録');
    expect(b.registerAttachmentDocument).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p1', attachmentId: 'a1', linkNodeId: 'kn1', title: 'spec.pdf',
    }));
    // 添付は projectId で絞って取得している（別テナント混入防止）。
    expect(prisma.attachment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', projectId: 'p1' } }),
    );
  });

  it('rejects an attachmentId belonging to another project (cross-tenant) and never touches the KG', async () => {
    const prisma = makePrisma({
      attachment: { findFirst: jest.fn(async () => null) }, // 別プロジェクトの添付は projectId 絞りで見つからない
    });
    const b = bridge();
    const c = new NodeAttachmentController(prisma, b);
    await expect(
      c.create('p1', { nodeKind: 'FLOW_NODE', nodeId: 'fn1', attachmentId: 'a-other' } as any),
    ).rejects.toThrow();
    expect(prisma.nodeAttachment.create).not.toHaveBeenCalled();
    expect(b.registerAttachmentDocument).not.toHaveBeenCalled();
  });

  it('is idempotent: re-attaching the same attachment returns the existing row without a second create', async () => {
    const prisma = makePrisma({
      nodeAttachment: {
        findFirst: jest.fn(async () => ({ id: 'na-existing', projectId: 'p1', nodeKind: 'FLOW_NODE', nodeId: 'fn1', attachmentId: 'a1', order: 0, caption: null, attachment: ATT })),
        create: jest.fn(),
      },
    });
    const b = bridge();
    const c = new NodeAttachmentController(prisma, b);
    const out = await c.create('p1', { nodeKind: 'FLOW_NODE', nodeId: 'fn1', attachmentId: 'a1' } as any);
    expect(out.id).toBe('na-existing');
    expect(prisma.nodeAttachment.create).not.toHaveBeenCalled();
  });
});

describe('NodeAttachmentController.list', () => {
  it('returns [] for an invalid nodeKind query without hitting Prisma (no 500)', async () => {
    const prisma = makePrisma();
    const c = new NodeAttachmentController(prisma, bridge());
    const out = await c.list('p1', 'GARBAGE' as any, 'fn1');
    expect(out).toEqual([]);
    expect(prisma.nodeAttachment.findMany).not.toHaveBeenCalled();
  });
});
