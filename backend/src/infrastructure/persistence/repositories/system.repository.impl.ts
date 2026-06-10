import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  System,
  SystemKindValue,
} from '../../../domain/entities/system.entity';
import { ISystemRepository } from '../../../domain/repositories/system.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemRepositoryImpl implements ISystemRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    projectId: string;
    name: string;
    kind: string;
    description: string | null;
    order: number;
    subProjectId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): System {
    return System.reconstruct({
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      kind: record.kind as SystemKindValue,
      description: record.description,
      order: record.order,
      subProjectId: record.subProjectId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<System | null> {
    const record = await this.prisma.system.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(projectId: string): Promise<System[]> {
    const records = await this.prisma.system.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async create(system: System): Promise<void> {
    await this.prisma.system.create({
      data: {
        id: system.id,
        projectId: system.projectId,
        subProjectId: system.subProjectId,
        name: system.name,
        kind: system.kind,
        description: system.description,
        order: system.order,
        createdAt: system.createdAt,
        updatedAt: system.updatedAt,
      },
    });
  }

  async update(system: System): Promise<void> {
    await this.prisma.system.update({
      where: { id: system.id },
      data: {
        subProjectId: system.subProjectId,
        name: system.name,
        kind: system.kind,
        description: system.description,
        order: system.order,
        updatedAt: system.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.system.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
