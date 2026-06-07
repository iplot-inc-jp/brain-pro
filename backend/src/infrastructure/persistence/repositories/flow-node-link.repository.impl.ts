import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  FlowNodeLink,
  FlowLinkDirectionValue,
} from '../../../domain/entities/flow-node-link.entity';
import { IFlowNodeLinkRepository } from '../../../domain/repositories/flow-node-link.repository';
import { PrismaService } from '../prisma/prisma.service';
import { FlowLinkDirection as PrismaFlowLinkDirection } from '@prisma/client';

@Injectable()
export class FlowNodeLinkRepositoryImpl implements IFlowNodeLinkRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    nodeId: string;
    direction: PrismaFlowLinkDirection;
    targetFlowId: string;
    targetNodeId: string | null;
    label: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): FlowNodeLink {
    return FlowNodeLink.reconstruct({
      id: record.id,
      nodeId: record.nodeId,
      direction: record.direction as FlowLinkDirectionValue,
      targetFlowId: record.targetFlowId,
      targetNodeId: record.targetNodeId,
      label: record.label,
      order: record.order,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<FlowNodeLink | null> {
    const record = await this.prisma.flowNodeLink.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByNodeId(nodeId: string): Promise<FlowNodeLink[]> {
    const records = await this.prisma.flowNodeLink.findMany({
      where: { nodeId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async findByTargetNodeId(nodeId: string): Promise<FlowNodeLink[]> {
    const records = await this.prisma.flowNodeLink.findMany({
      where: { targetNodeId: nodeId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async save(link: FlowNodeLink): Promise<void> {
    const data = {
      nodeId: link.nodeId,
      direction: link.direction as PrismaFlowLinkDirection,
      targetFlowId: link.targetFlowId,
      targetNodeId: link.targetNodeId,
      label: link.label,
      order: link.order,
    };

    await this.prisma.flowNodeLink.upsert({
      where: { id: link.id },
      create: {
        id: link.id,
        ...data,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
      },
      update: {
        ...data,
        updatedAt: link.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.flowNodeLink.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
