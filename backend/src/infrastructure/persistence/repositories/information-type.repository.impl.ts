import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InformationType,
  InformationCategoryValue,
} from '../../../domain/entities/information-type.entity';
import { IInformationTypeRepository } from '../../../domain/repositories/information-type.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InformationTypeRepositoryImpl implements IInformationTypeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    projectId: string;
    name: string;
    category: string;
    description: string | null;
    order: number;
    subProjectId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): InformationType {
    return InformationType.reconstruct({
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      category: record.category as InformationCategoryValue,
      description: record.description,
      order: record.order,
      subProjectId: record.subProjectId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<InformationType | null> {
    const record = await this.prisma.informationType.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(projectId: string): Promise<InformationType[]> {
    const records = await this.prisma.informationType.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async countAttachmentsByProjectId(
    projectId: string,
  ): Promise<Map<string, number>> {
    const grouped = await this.prisma.attachment.groupBy({
      by: ['informationTypeId'],
      where: { informationType: { projectId } },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) {
      if (g.informationTypeId) map.set(g.informationTypeId, g._count._all);
    }
    return map;
  }

  async save(informationType: InformationType): Promise<void> {
    const data = {
      projectId: informationType.projectId,
      name: informationType.name,
      category: informationType.category,
      description: informationType.description,
      order: informationType.order,
      subProjectId: informationType.subProjectId,
    };

    await this.prisma.informationType.upsert({
      where: { id: informationType.id },
      create: {
        id: informationType.id,
        ...data,
        createdAt: informationType.createdAt,
        updatedAt: informationType.updatedAt,
      },
      update: {
        ...data,
        updatedAt: informationType.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    // DfdFlow.informationTypeId は onDelete: SetNull、Attachment.informationTypeId は onDelete: Cascade
    await this.prisma.informationType.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
