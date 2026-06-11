import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TobeVision, ITobeVisionRepository } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * TobeVision リポジトリ実装
 */
@Injectable()
export class TobeVisionRepositoryImpl implements ITobeVisionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    projectId: string;
    subProjectId: string | null;
    area: string | null;
    vision: string | null;
    countermeasure: string | null;
    effect: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): TobeVision {
    return TobeVision.reconstruct({
      id: data.id,
      projectId: data.projectId,
      subProjectId: data.subProjectId,
      area: data.area,
      vision: data.vision,
      countermeasure: data.countermeasure,
      effect: data.effect,
      order: data.order,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findById(id: string): Promise<TobeVision | null> {
    const data = await this.prisma.tobeVision.findUnique({ where: { id } });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<TobeVision[]> {
    const data = await this.prisma.tobeVision.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(tobeVision: TobeVision): Promise<void> {
    const data = {
      projectId: tobeVision.projectId,
      subProjectId: tobeVision.subProjectId,
      area: tobeVision.area,
      vision: tobeVision.vision,
      countermeasure: tobeVision.countermeasure,
      effect: tobeVision.effect,
      order: tobeVision.order,
    };

    await this.prisma.tobeVision.upsert({
      where: { id: tobeVision.id },
      create: {
        id: tobeVision.id,
        ...data,
        createdAt: tobeVision.createdAt,
        updatedAt: tobeVision.updatedAt,
      },
      update: {
        ...data,
        updatedAt: tobeVision.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.tobeVision.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
