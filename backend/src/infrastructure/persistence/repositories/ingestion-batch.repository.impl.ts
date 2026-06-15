import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  IngestionBatch,
  IIngestionBatchRepository,
  IngestionBatchStatusValue,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * IngestionBatch リポジトリ実装
 */
@Injectable()
export class IngestionBatchRepositoryImpl implements IIngestionBatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    projectId: string;
    name: string;
    status: string;
    totalFiles: number;
    succeededFiles: number;
    failedFiles: number;
    pendingFiles: number;
    options: Prisma.JsonValue;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): IngestionBatch {
    return IngestionBatch.reconstruct({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      status: data.status as IngestionBatchStatusValue,
      totalFiles: data.totalFiles,
      succeededFiles: data.succeededFiles,
      failedFiles: data.failedFiles,
      pendingFiles: data.pendingFiles,
      options:
        data.options === null
          ? null
          : (data.options as Record<string, unknown>),
      createdById: data.createdById,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      startedAt: data.startedAt,
      finishedAt: data.finishedAt,
    });
  }

  async findById(id: string): Promise<IngestionBatch | null> {
    const data = await this.prisma.ingestionBatch.findUnique({ where: { id } });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<IngestionBatch[]> {
    const data = await this.prisma.ingestionBatch.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(batch: IngestionBatch): Promise<void> {
    const options =
      batch.options === null
        ? Prisma.JsonNull
        : (batch.options as Prisma.InputJsonValue);
    const data = {
      projectId: batch.projectId,
      name: batch.name,
      status: batch.status,
      totalFiles: batch.totalFiles,
      succeededFiles: batch.succeededFiles,
      failedFiles: batch.failedFiles,
      pendingFiles: batch.pendingFiles,
      options,
      createdById: batch.createdById,
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
    };

    await this.prisma.ingestionBatch.upsert({
      where: { id: batch.id },
      create: {
        id: batch.id,
        ...data,
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
      },
      update: {
        ...data,
        updatedAt: batch.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.ingestionBatch.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
