import { Injectable } from '@nestjs/common';
import { KnowledgePageKind, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';

export interface UpsertPendingKnowledgePageInput {
  projectId: string;
  ingestionFileId: string;
  knowledgeDocumentId: string;
  pageNumber: number;
  pageKind: KnowledgePageKind;
  sourceText: string | null;
  sourceBlobUrl: string | null;
}

export interface SucceededKnowledgePageInput {
  contentText: string;
  summary: string;
  extractionResult: Prisma.InputJsonValue;
}

@Injectable()
export class KnowledgePageRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsertPending(input: UpsertPendingKnowledgePageInput) {
    const {
      projectId,
      ingestionFileId,
      knowledgeDocumentId,
      pageNumber,
      pageKind,
      sourceText,
      sourceBlobUrl,
    } = input;

    return this.prisma.knowledgeDocumentPage.upsert({
      where: {
        ingestionFileId_pageNumber: { ingestionFileId, pageNumber },
      },
      create: {
        projectId,
        ingestionFileId,
        knowledgeDocumentId,
        pageNumber,
        pageKind,
        sourceText,
        sourceBlobUrl,
        status: 'PENDING',
      },
      update: {
        projectId,
        knowledgeDocumentId,
        pageKind,
        sourceText,
        sourceBlobUrl,
        status: 'PENDING',
        error: null,
        jobId: null,
      },
    });
  }

  markProcessing(id: string, jobId: string) {
    return this.prisma.knowledgeDocumentPage.update({
      where: { id },
      data: {
        status: 'PROCESSING',
        jobId,
        error: null,
      },
    });
  }

  markSucceeded(id: string, input: SucceededKnowledgePageInput) {
    return this.prisma.knowledgeDocumentPage.update({
      where: { id },
      data: {
        status: 'SUCCEEDED',
        contentText: input.contentText,
        summary: input.summary,
        extractionResult: input.extractionResult,
        error: null,
      },
    });
  }

  markFailed(id: string, error: string) {
    return this.prisma.knowledgeDocumentPage.update({
      where: { id },
      data: {
        status: 'FAILED',
        attempts: { increment: 1 },
        error,
      },
    });
  }

  listForFile(ingestionFileId: string) {
    return this.prisma.knowledgeDocumentPage.findMany({
      where: { ingestionFileId },
      orderBy: { pageNumber: 'asc' },
    });
  }

  listForDocument(knowledgeDocumentId: string) {
    return this.prisma.knowledgeDocumentPage.findMany({
      where: { knowledgeDocumentId },
      orderBy: { pageNumber: 'asc' },
    });
  }

  async allSucceeded(ingestionFileId: string): Promise<boolean> {
    const remaining = await this.prisma.knowledgeDocumentPage.count({
      where: {
        ingestionFileId,
        status: { not: 'SUCCEEDED' },
      },
    });
    return remaining === 0;
  }
}
