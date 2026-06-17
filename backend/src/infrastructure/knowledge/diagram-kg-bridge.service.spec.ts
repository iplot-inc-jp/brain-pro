// diagram-kg-bridge.service.spec.ts
import { DiagramKgBridgeService } from './diagram-kg-bridge.service';

function makePrisma() {
  return {
    knowledgeNode: { upsert: jest.fn(async () => ({ id: 'kn1' })) },
    knowledgeNodeLink: { upsert: jest.fn(async () => ({ id: 'lnk1' })) },
    knowledgeDocument: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'doc1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'doc1', ...data })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    knowledgeMention: { createMany: jest.fn(async () => ({ count: 1 })) },
    nodeAttachment: { count: jest.fn(async () => 0) },
  } as any;
}

describe('DiagramKgBridgeService', () => {
  it('ensureEntityForNode upserts an ENTITY node by normalizedLabel and links it', async () => {
    const prisma = makePrisma();
    const svc = new DiagramKgBridgeService(prisma);
    const { knowledgeNodeId } = await svc.ensureEntityForNode('p1', 'FLOW_NODE', 'fn1', '受注 登録');
    expect(knowledgeNodeId).toBe('kn1');
    const up = prisma.knowledgeNode.upsert.mock.calls[0][0];
    expect(up.where.projectId_type_normalizedLabel).toEqual({
      projectId: 'p1', type: 'ENTITY', normalizedLabel: '受注 登録',
    });
    const link = prisma.knowledgeNodeLink.upsert.mock.calls[0][0];
    expect(link.where.knowledgeNodeId_diagramKind_diagramNodeId).toEqual({
      knowledgeNodeId: 'kn1', diagramKind: 'FLOW', diagramNodeId: 'fn1',
    });
  });

  it('registerAttachmentDocument dedups by (projectId, ATTACHMENT, attachmentId) and links a mention', async () => {
    const prisma = makePrisma();
    const svc = new DiagramKgBridgeService(prisma);
    const { documentId } = await svc.registerAttachmentDocument({
      projectId: 'p1', attachmentId: 'a1', title: 'spec.pdf',
      mimeType: 'application/pdf', blobUrl: 'https://x/a.pdf', linkNodeId: 'kn1',
    });
    expect(documentId).toBe('doc1');
    expect(prisma.knowledgeDocument.findFirst.mock.calls[0][0].where).toEqual({
      projectId: 'p1', sourceType: 'ATTACHMENT', sourceRef: 'a1',
    });
    expect(prisma.knowledgeMention.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 'p1', documentId: 'doc1', nodeId: 'kn1' }],
      skipDuplicates: true,
    });
  });

  describe('unregisterAttachmentDocumentIfOrphaned', () => {
    it('deletes the KnowledgeDocument when no NodeAttachments remain (count===0)', async () => {
      const prisma = makePrisma();
      prisma.nodeAttachment.count.mockResolvedValue(0);
      const svc = new DiagramKgBridgeService(prisma);
      await svc.unregisterAttachmentDocumentIfOrphaned('p1', 'a1');
      expect(prisma.nodeAttachment.count).toHaveBeenCalledWith({ where: { projectId: 'p1', attachmentId: 'a1' } });
      expect(prisma.knowledgeDocument.deleteMany).toHaveBeenCalledWith({
        where: { projectId: 'p1', sourceType: 'ATTACHMENT', sourceRef: 'a1' },
      });
    });

    it('does NOT delete the KnowledgeDocument when other NodeAttachments still reference it (count>0)', async () => {
      const prisma = makePrisma();
      prisma.nodeAttachment.count.mockResolvedValue(1);
      const svc = new DiagramKgBridgeService(prisma);
      await svc.unregisterAttachmentDocumentIfOrphaned('p1', 'a1');
      expect(prisma.nodeAttachment.count).toHaveBeenCalledWith({ where: { projectId: 'p1', attachmentId: 'a1' } });
      expect(prisma.knowledgeDocument.deleteMany).not.toHaveBeenCalled();
    });
  });
});
