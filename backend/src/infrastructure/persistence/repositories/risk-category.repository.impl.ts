import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RiskCategory } from '../../../domain/entities/risk-category.entity';
import { IRiskCategoryRepository } from '../../../domain/repositories/risk-category.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RiskCategoryRepositoryImpl implements IRiskCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    projectId: string;
    name: string;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): RiskCategory {
    return RiskCategory.reconstruct({
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      order: record.order,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<RiskCategory | null> {
    const record = await this.prisma.riskCategory.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(projectId: string): Promise<RiskCategory[]> {
    const records = await this.prisma.riskCategory.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async create(riskCategory: RiskCategory): Promise<void> {
    await this.prisma.riskCategory.create({
      data: {
        id: riskCategory.id,
        projectId: riskCategory.projectId,
        name: riskCategory.name,
        order: riskCategory.order,
        createdAt: riskCategory.createdAt,
        updatedAt: riskCategory.updatedAt,
      },
    });
  }

  async createManySkipDuplicates(
    riskCategories: RiskCategory[],
  ): Promise<void> {
    if (riskCategories.length === 0) return;
    // @@unique([projectId, name]) を前提に、衝突行はスキップ（競合時の冪等シード用）
    await this.prisma.riskCategory.createMany({
      data: riskCategories.map((c) => ({
        id: c.id,
        projectId: c.projectId,
        name: c.name,
        order: c.order,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      skipDuplicates: true,
    });
  }

  async update(riskCategory: RiskCategory): Promise<void> {
    await this.prisma.riskCategory.update({
      where: { id: riskCategory.id },
      data: {
        name: riskCategory.name,
        order: riskCategory.order,
        updatedAt: riskCategory.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.riskCategory.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
