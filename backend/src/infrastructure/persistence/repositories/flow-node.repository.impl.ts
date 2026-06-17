import { Injectable } from '@nestjs/common';
import { IFlowNodeRepository } from '../../../domain/repositories/flow-node.repository';
import { FlowNode, FlowNodeType } from '../../../domain/entities/flow-node.entity';
import { PrismaService } from '../prisma/prisma.service';
import { FlowNodeType as PrismaFlowNodeType, Prisma } from '@prisma/client';

@Injectable()
export class PrismaFlowNodeRepository implements IFlowNodeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<FlowNode | null> {
    const node = await this.prisma.flowNode.findUnique({
      where: { id },
    });

    if (!node) return null;

    return this.toDomain(node);
  }

  async findByFlowId(flowId: string): Promise<FlowNode[]> {
    const nodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      orderBy: { createdAt: 'asc' },
    });

    return nodes.map((n) => this.toDomain(n));
  }

  async findByFlowIdWithChildFlow(flowId: string): Promise<FlowNode[]> {
    const nodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      include: { childFlow: true },
      orderBy: { createdAt: 'asc' },
    });

    return nodes.map((n) => this.toDomain(n));
  }

  async save(node: FlowNode): Promise<FlowNode> {
    const data = {
      flowId: node.flowId,
      type: node.type as PrismaFlowNodeType,
      label: node.label,
      description: node.description,
      positionX: node.positionX,
      positionY: node.positionY,
      width: node.width,
      height: node.height,
      roleId: node.roleId,
      childFlowId: node.childFlowId,
      processingTime: node.processingTime,
      handledCount: node.handledCount,
      supplement: node.supplement,
      metadata: node.metadata as Prisma.InputJsonValue,
    };

    const saved = await this.prisma.flowNode.upsert({
      where: { id: node.id },
      update: data,
      create: { id: node.id, ...data },
    });

    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.flowNode.delete({ where: { id } });
    await this.prisma.nodeAttachment.deleteMany({ where: { nodeKind: 'FLOW_NODE', nodeId: id } });
    await this.prisma.knowledgeNodeLink.deleteMany({ where: { diagramKind: 'FLOW', diagramNodeId: id } });
  }

  private toDomain(record: {
    id: string;
    flowId: string;
    type: PrismaFlowNodeType;
    label: string;
    description: string | null;
    positionX: number;
    positionY: number;
    width: number | null;
    height: number | null;
    roleId: string | null;
    childFlowId: string | null;
    processingTime: string | null;
    handledCount: string | null;
    supplement: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): FlowNode {
    return new FlowNode({
      id: record.id,
      flowId: record.flowId,
      type: record.type as FlowNodeType,
      label: record.label,
      description: record.description,
      positionX: record.positionX,
      positionY: record.positionY,
      width: record.width,
      height: record.height,
      roleId: record.roleId,
      childFlowId: record.childFlowId,
      processingTime: record.processingTime,
      handledCount: record.handledCount,
      supplement: record.supplement,
      metadata: (record.metadata as Record<string, unknown>) || {},
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}

