import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TobeRoadmap, ITobeRoadmapRepository } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TobeRoadmap リポジトリ実装
 */
@Injectable()
export class TobeRoadmapRepositoryImpl implements ITobeRoadmapRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    projectId: string;
    subProjectId: string | null;
    tobeVisionId: string | null;
    phase: string | null;
    measure: string | null;
    roi: string | null;
    cost: string | null;
    payback: string | null;
    scope: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): TobeRoadmap {
    return TobeRoadmap.reconstruct({
      id: data.id,
      projectId: data.projectId,
      subProjectId: data.subProjectId,
      tobeVisionId: data.tobeVisionId,
      phase: data.phase,
      measure: data.measure,
      roi: data.roi,
      cost: data.cost,
      payback: data.payback,
      scope: data.scope,
      order: data.order,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findById(id: string): Promise<TobeRoadmap | null> {
    const data = await this.prisma.tobeRoadmap.findUnique({ where: { id } });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<TobeRoadmap[]> {
    const data = await this.prisma.tobeRoadmap.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(tobeRoadmap: TobeRoadmap): Promise<void> {
    const data = {
      projectId: tobeRoadmap.projectId,
      subProjectId: tobeRoadmap.subProjectId,
      tobeVisionId: tobeRoadmap.tobeVisionId,
      phase: tobeRoadmap.phase,
      measure: tobeRoadmap.measure,
      roi: tobeRoadmap.roi,
      cost: tobeRoadmap.cost,
      payback: tobeRoadmap.payback,
      scope: tobeRoadmap.scope,
      order: tobeRoadmap.order,
    };

    await this.prisma.tobeRoadmap.upsert({
      where: { id: tobeRoadmap.id },
      create: {
        id: tobeRoadmap.id,
        ...data,
        createdAt: tobeRoadmap.createdAt,
        updatedAt: tobeRoadmap.updatedAt,
      },
      update: {
        ...data,
        updatedAt: tobeRoadmap.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tobeRoadmap.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
