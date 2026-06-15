import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  IngestionFile,
  IIngestionFileRepository,
  IngestionFileStatusValue,
  IngestionSourceTypeValue,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * IngestionFile リポジトリ実装
 */
@Injectable()
export class IngestionFileRepositoryImpl implements IIngestionFileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    batchId: string;
    projectId: string;
    sourceType: string;
    sourceRef: string | null;
    filename: string;
    displayName: string | null;
    mimeType: string | null;
    size: number | null;
    blobUrl: string | null;
    isArchive: boolean;
    parentFileId: string | null;
    status: string;
    step: string | null;
    progress: number;
    attempts: number;
    maxAttempts: number;
    error: string | null;
    extractedText: string | null;
    pageImageUrls: Prisma.JsonValue;
    extractionResult: Prisma.JsonValue;
    jobId: string | null;
    knowledgeDocumentId: string | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): IngestionFile {
    return IngestionFile.reconstruct({
      id: data.id,
      batchId: data.batchId,
      projectId: data.projectId,
      sourceType: data.sourceType as IngestionSourceTypeValue,
      sourceRef: data.sourceRef,
      filename: data.filename,
      displayName: data.displayName,
      mimeType: data.mimeType,
      size: data.size,
      blobUrl: data.blobUrl,
      isArchive: data.isArchive,
      parentFileId: data.parentFileId,
      status: data.status as IngestionFileStatusValue,
      step: data.step,
      progress: data.progress,
      attempts: data.attempts,
      maxAttempts: data.maxAttempts,
      error: data.error,
      extractedText: data.extractedText,
      pageImageUrls: data.pageImageUrls === null ? null : data.pageImageUrls,
      extractionResult:
        data.extractionResult === null ? null : data.extractionResult,
      jobId: data.jobId,
      knowledgeDocumentId: data.knowledgeDocumentId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      startedAt: data.startedAt,
      finishedAt: data.finishedAt,
    });
  }

  private toData(file: IngestionFile) {
    const pageImageUrls =
      file.pageImageUrls === null || file.pageImageUrls === undefined
        ? Prisma.JsonNull
        : (file.pageImageUrls as Prisma.InputJsonValue);
    const extractionResult =
      file.extractionResult === null || file.extractionResult === undefined
        ? Prisma.JsonNull
        : (file.extractionResult as Prisma.InputJsonValue);
    return {
      batchId: file.batchId,
      projectId: file.projectId,
      sourceType: file.sourceType,
      sourceRef: file.sourceRef,
      filename: file.filename,
      displayName: file.displayName,
      mimeType: file.mimeType,
      size: file.size,
      blobUrl: file.blobUrl,
      isArchive: file.isArchive,
      parentFileId: file.parentFileId,
      status: file.status,
      step: file.step,
      progress: file.progress,
      attempts: file.attempts,
      maxAttempts: file.maxAttempts,
      error: file.error,
      extractedText: file.extractedText,
      pageImageUrls,
      extractionResult,
      jobId: file.jobId,
      knowledgeDocumentId: file.knowledgeDocumentId,
      startedAt: file.startedAt,
      finishedAt: file.finishedAt,
    };
  }

  async findById(id: string): Promise<IngestionFile | null> {
    const data = await this.prisma.ingestionFile.findUnique({ where: { id } });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByBatchId(batchId: string): Promise<IngestionFile[]> {
    const data = await this.prisma.ingestionFile.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(file: IngestionFile): Promise<void> {
    const data = this.toData(file);
    await this.prisma.ingestionFile.upsert({
      where: { id: file.id },
      create: {
        id: file.id,
        ...data,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      },
      update: {
        ...data,
        updatedAt: file.updatedAt,
      },
    });
  }

  async saveMany(files: IngestionFile[]): Promise<void> {
    if (files.length === 0) return;
    await this.prisma.$transaction(
      files.map((file) => {
        const data = this.toData(file);
        return this.prisma.ingestionFile.upsert({
          where: { id: file.id },
          create: {
            id: file.id,
            ...data,
            createdAt: file.createdAt,
            updatedAt: file.updatedAt,
          },
          update: {
            ...data,
            updatedAt: file.updatedAt,
          },
        });
      }),
    );
  }

  async setJobId(id: string, jobId: string): Promise<void> {
    // jobId 列のみ更新（status 等は触らない）。inline 実行が確定させた状態を巻き戻さない。
    await this.prisma.ingestionFile.update({ where: { id }, data: { jobId } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.ingestionFile.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
