import { Injectable } from '@nestjs/common';
import { IBusinessFlowRepository } from '../../../domain/repositories/business-flow.repository';
import { BusinessFlow } from '../../../domain/entities/business-flow.entity';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaBusinessFlowRepository implements IBusinessFlowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<BusinessFlow | null> {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id },
    });

    if (!flow) return null;

    return this.toDomain(flow);
  }

  async findByProjectId(projectId: string): Promise<BusinessFlow[]> {
    const flows = await this.prisma.businessFlow.findMany({
      where: { projectId },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
    });

    return flows.map((f) => this.toDomain(f));
  }

  async findRootFlowsByProjectId(projectId: string): Promise<BusinessFlow[]> {
    const flows = await this.prisma.businessFlow.findMany({
      where: { projectId, parentId: null },
      orderBy: { name: 'asc' },
    });

    return flows.map((f) => this.toDomain(f));
  }

  async findChildrenByParentId(parentId: string): Promise<BusinessFlow[]> {
    const flows = await this.prisma.businessFlow.findMany({
      where: { parentId },
      orderBy: { name: 'asc' },
    });

    return flows.map((f) => this.toDomain(f));
  }

  async findWithHierarchy(id: string): Promise<BusinessFlow | null> {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id },
      include: {
        children: true,
        parent: true,
      },
    });

    if (!flow) return null;

    return this.toDomain(flow);
  }

  async save(flow: BusinessFlow): Promise<BusinessFlow> {
    const data = {
      projectId: flow.projectId,
      name: flow.name,
      description: flow.description,
      version: flow.version,
      kind: flow.kind,
      confidence: flow.confidence,
      subProjectId: flow.subProjectId,
      folderId: flow.folderId,
      parentId: flow.parentId,
      depth: flow.depth,
    };

    const saved = await this.prisma.businessFlow.upsert({
      where: { id: flow.id },
      update: data,
      create: { id: flow.id, ...data },
    });

    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.businessFlow.delete({ where: { id } });
  }

  private toDomain(record: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    version: number;
    kind?: string;
    confidence?: string;
    subProjectId?: string | null;
    folderId?: string | null;
    parentId: string | null;
    depth: number;
    createdAt: Date;
    updatedAt: Date;
  }): BusinessFlow {
    return new BusinessFlow({
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      description: record.description,
      version: record.version,
      kind: (record.kind as 'ASIS' | 'TOBE') ?? 'ASIS',
      confidence: (record.confidence as 'HYPOTHESIS' | 'CONFIRMED') ?? 'HYPOTHESIS',
      subProjectId: record.subProjectId ?? null,
      folderId: record.folderId ?? null,
      parentId: record.parentId,
      depth: record.depth,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}

