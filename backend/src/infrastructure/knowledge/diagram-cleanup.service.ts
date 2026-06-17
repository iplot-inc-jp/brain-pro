// diagram-cleanup.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { NODE_KIND_TO_DIAGRAM_KIND, type DiagramNodeKind } from './diagram-kg-bridge.service';

@Injectable()
export class DiagramCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async cleanupNode(nodeKind: DiagramNodeKind, nodeId: string): Promise<void> {
    await this.prisma.nodeAttachment.deleteMany({ where: { nodeKind, nodeId } });
    await this.prisma.knowledgeNodeLink.deleteMany({
      where: { diagramKind: NODE_KIND_TO_DIAGRAM_KIND[nodeKind], diagramNodeId: nodeId },
    });
  }
}
