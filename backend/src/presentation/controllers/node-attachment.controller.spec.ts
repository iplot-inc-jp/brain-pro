// node-attachment.controller.spec.ts
import { NodeAttachmentController } from './node-attachment.controller';

const ATT = { id: 'a1', filename: 'spec.pdf', displayName: null, mimeType: 'application/pdf', kind: 'PDF', size: 9, url: '/api/attachments/a1/file', pageRange: null, blobUrl: 'https://x/a.pdf' };

function makePrisma() {
  return {
    flowNode: { findUnique: jest.fn(async () => ({ id: 'fn1', label: '受注登録', flow: { projectId: 'p1' } })) },
    attachment: { findUnique: jest.fn(async () => ATT) },
    nodeAttachment: {
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: any) => ({ id: 'na1', order: 0, caption: null, ...data, attachment: ATT })),
    },
  } as any;
}
const bridge = () => ({
  ensureEntityForNode: jest.fn(async () => ({ knowledgeNodeId: 'kn1' })),
  registerAttachmentDocument: jest.fn(async () => ({ documentId: 'doc1' })),
}) as any;

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
  });
});
