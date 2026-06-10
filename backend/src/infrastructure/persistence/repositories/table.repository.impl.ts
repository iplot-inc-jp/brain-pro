import { Injectable } from '@nestjs/common';
import { ITableRepository } from '../../../domain/repositories/table.repository';
import { Table } from '../../../domain/entities/table.entity';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaTableRepository implements ITableRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Table | null> {
    const table = await this.prisma.table.findUnique({
      where: { id },
    });

    if (!table) return null;

    return this.toDomain(table);
  }

  async findByProjectId(projectId: string): Promise<Table[]> {
    const tables = await this.prisma.table.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
    });

    return tables.map((t) => this.toDomain(t));
  }

  async findByProjectIdAndName(projectId: string, name: string): Promise<Table | null> {
    const table = await this.prisma.table.findUnique({
      where: { projectId_name: { projectId, name } },
    });

    if (!table) return null;

    return this.toDomain(table);
  }

  async save(table: Table): Promise<Table> {
    const data = {
      projectId: table.projectId,
      name: table.name,
      displayName: table.displayName,
      description: table.description,
      tags: table.tags,
      informationTypeId: table.informationTypeId,
    };

    const saved = await this.prisma.table.upsert({
      where: { id: table.id },
      update: data,
      create: { id: table.id, ...data },
    });

    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.table.delete({ where: { id } });
  }

  private toDomain(record: {
    id: string;
    projectId: string;
    name: string;
    displayName: string | null;
    description: string | null;
    tags: string[];
    informationTypeId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Table {
    return new Table({
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      displayName: record.displayName,
      description: record.description,
      tags: record.tags,
      informationTypeId: record.informationTypeId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}

