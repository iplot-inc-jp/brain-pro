// diagram-kg-bridge.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { normalizeLabel } from '../../domain/value-objects/normalize-label.vo';

export type DiagramNodeKind = 'FLOW_NODE' | 'DFD_NODE' | 'DATA_OBJECT';
export type DiagramKind = 'FLOW' | 'DFD' | 'OBJECT_MAP';

export const NODE_KIND_TO_DIAGRAM_KIND: Record<DiagramNodeKind, DiagramKind> = {
  FLOW_NODE: 'FLOW', DFD_NODE: 'DFD', DATA_OBJECT: 'OBJECT_MAP',
};

@Injectable()
export class DiagramKgBridgeService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureEntityForNode(
    projectId: string, nodeKind: DiagramNodeKind, nodeId: string, label: string,
  ): Promise<{ knowledgeNodeId: string }> {
    const normalizedLabel = normalizeLabel(label || '');
    const node = await this.prisma.knowledgeNode.upsert({
      where: { projectId_type_normalizedLabel: { projectId, type: 'ENTITY', normalizedLabel } },
      create: { projectId, type: 'ENTITY', label: label || normalizedLabel, normalizedLabel },
      update: {},
      select: { id: true },
    });
    await this.prisma.knowledgeNodeLink.upsert({
      where: {
        knowledgeNodeId_diagramKind_diagramNodeId: {
          knowledgeNodeId: node.id, diagramKind: NODE_KIND_TO_DIAGRAM_KIND[nodeKind], diagramNodeId: nodeId,
        },
      },
      create: {
        projectId, knowledgeNodeId: node.id,
        diagramKind: NODE_KIND_TO_DIAGRAM_KIND[nodeKind], diagramNodeId: nodeId,
      },
      update: {},
    });
    return { knowledgeNodeId: node.id };
  }

  async registerAttachmentDocument(input: {
    projectId: string; attachmentId: string; title: string;
    mimeType: string | null; blobUrl: string | null; linkNodeId?: string;
  }): Promise<{ documentId: string }> {
    const { projectId, attachmentId, title, mimeType, blobUrl, linkNodeId } = input;
    const existing = await this.prisma.knowledgeDocument.findFirst({
      where: { projectId, sourceType: 'ATTACHMENT', sourceRef: attachmentId },
      select: { id: true },
    });
    const data = { projectId, title, sourceType: 'ATTACHMENT' as const, sourceRef: attachmentId, blobUrl, mimeType };
    const doc = existing
      ? await this.prisma.knowledgeDocument.update({ where: { id: existing.id }, data, select: { id: true } })
      : await this.prisma.knowledgeDocument.create({ data, select: { id: true } });
    if (linkNodeId) {
      await this.prisma.knowledgeMention.createMany({
        data: [{ projectId, documentId: doc.id, nodeId: linkNodeId }],
        skipDuplicates: true,
      });
    }
    return { documentId: doc.id };
  }

  async unregisterAttachmentDocumentIfOrphaned(projectId: string, attachmentId: string): Promise<void> {
    const remaining = await this.prisma.nodeAttachment.count({
      where: { projectId, attachmentId },
    });
    if (remaining > 0) return;
    await this.prisma.knowledgeDocument.deleteMany({
      where: { projectId, sourceType: 'ATTACHMENT', sourceRef: attachmentId },
    });
  }
}
