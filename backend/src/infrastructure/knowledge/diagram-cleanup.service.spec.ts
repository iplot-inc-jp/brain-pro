// diagram-cleanup.service.spec.ts
import { DiagramCleanupService } from './diagram-cleanup.service';

function makePrisma() {
  return {
    nodeAttachment: { deleteMany: jest.fn(async () => ({ count: 2 })) },
    knowledgeNodeLink: { deleteMany: jest.fn(async () => ({ count: 1 })) },
  } as any;
}

describe('DiagramCleanupService.cleanupNode', () => {
  it('deletes node attachments and the matching knowledge-node links (DATA_OBJECT→OBJECT_MAP)', async () => {
    const prisma = makePrisma();
    const svc = new DiagramCleanupService(prisma);
    await svc.cleanupNode('DATA_OBJECT', 'do1');
    expect(prisma.nodeAttachment.deleteMany).toHaveBeenCalledWith({ where: { nodeKind: 'DATA_OBJECT', nodeId: 'do1' } });
    expect(prisma.knowledgeNodeLink.deleteMany).toHaveBeenCalledWith({ where: { diagramKind: 'OBJECT_MAP', diagramNodeId: 'do1' } });
  });
});
