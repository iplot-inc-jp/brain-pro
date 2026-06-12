import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Constraint } from '../../../domain/entities/constraint.entity';
import { IConstraintRepository } from '../../../domain/repositories/constraint.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConstraintRepositoryImpl implements IConstraintRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    category: string | null;
    kind: string | null;
    order: number;
    subProjectId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Constraint {
    return Constraint.reconstruct({
      id: record.id,
      projectId: record.projectId,
      title: record.title,
      description: record.description,
      category: record.category,
      kind: record.kind,
      order: record.order,
      subProjectId: record.subProjectId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<Constraint | null> {
    const record = await this.prisma.constraint.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(projectId: string): Promise<Constraint[]> {
    const records = await this.prisma.constraint.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async create(constraint: Constraint): Promise<void> {
    await this.prisma.constraint.create({
      data: {
        id: constraint.id,
        projectId: constraint.projectId,
        subProjectId: constraint.subProjectId,
        title: constraint.title,
        description: constraint.description,
        category: constraint.category,
        kind: constraint.kind,
        order: constraint.order,
        createdAt: constraint.createdAt,
        updatedAt: constraint.updatedAt,
      },
    });
  }

  async update(constraint: Constraint): Promise<void> {
    await this.prisma.constraint.update({
      where: { id: constraint.id },
      data: {
        subProjectId: constraint.subProjectId,
        title: constraint.title,
        description: constraint.description,
        category: constraint.category,
        kind: constraint.kind,
        order: constraint.order,
        updatedAt: constraint.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.constraint.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
