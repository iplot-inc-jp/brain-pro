import { Inject, Injectable } from '@nestjs/common';
import {
  KnowledgeDocumentPage,
  KnowledgePageKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';

export interface KnowledgePagePrismaClient {
  knowledgeDocumentPage: {
    findUnique(
      args: Prisma.KnowledgeDocumentPageFindUniqueArgs,
    ): Promise<Pick<
      KnowledgeDocumentPage,
      'projectId' | 'knowledgeDocumentId'
    > | null>;
    upsert(
      args: Prisma.KnowledgeDocumentPageUpsertArgs,
    ): Promise<KnowledgeDocumentPage>;
    updateMany(
      args: Prisma.KnowledgeDocumentPageUpdateManyArgs,
    ): Promise<Prisma.BatchPayload>;
    findMany(
      args: Prisma.KnowledgeDocumentPageFindManyArgs,
    ): Promise<KnowledgeDocumentPage[]>;
    count(args: Prisma.KnowledgeDocumentPageCountArgs): Promise<number>;
  };
}

export interface UpsertPendingKnowledgePageInput {
  projectId: string;
  ingestionFileId: string;
  knowledgeDocumentId: string;
  pageNumber: number;
  pageKind: KnowledgePageKind;
  sourceText: string | null;
  sourceBlobUrl: string | null;
}

interface ScopedKnowledgePageInput {
  id: string;
  projectId: string;
}

export interface ProcessingKnowledgePageInput
  extends ScopedKnowledgePageInput {
  jobId: string;
}

export interface SucceededKnowledgePageInput
  extends ScopedKnowledgePageInput {
  contentText: string;
  summary: string;
  extractionResult: Prisma.InputJsonValue;
}

export interface FailedKnowledgePageInput extends ScopedKnowledgePageInput {
  error: string;
}

export class KnowledgePageNotFoundError extends Error {
  constructor(id: string, projectId: string) {
    super(`Knowledge page ${id} was not found in project ${projectId}`);
    this.name = 'KnowledgePageNotFoundError';
  }
}

@Injectable()
export class KnowledgePageRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: KnowledgePagePrismaClient,
  ) {}

  async upsertPending(
    input: UpsertPendingKnowledgePageInput,
  ): Promise<KnowledgeDocumentPage> {
    const {
      projectId,
      ingestionFileId,
      knowledgeDocumentId,
      pageNumber,
      pageKind,
      sourceText,
      sourceBlobUrl,
    } = input;
    const where = {
      ingestionFileId_pageNumber: { ingestionFileId, pageNumber },
    };
    const existing = await this.prisma.knowledgeDocumentPage.findUnique({
      where,
      select: { projectId: true, knowledgeDocumentId: true },
    });
    if (existing) {
      this.assertPageParent(existing, input);
    }

    const saved = await this.prisma.knowledgeDocumentPage.upsert({
      where,
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
        pageKind,
        sourceText,
        sourceBlobUrl,
        status: 'PENDING',
        error: null,
        jobId: null,
      },
    });
    this.assertPageParent(saved, input);
    return saved;
  }

  markProcessing(input: ProcessingKnowledgePageInput): Promise<void> {
    return this.updateScoped(input.id, input.projectId, {
      status: 'PROCESSING',
      jobId: input.jobId,
      error: null,
    });
  }

  markSucceeded(input: SucceededKnowledgePageInput): Promise<void> {
    return this.updateScoped(input.id, input.projectId, {
      status: 'SUCCEEDED',
      contentText: input.contentText,
      summary: input.summary,
      extractionResult: input.extractionResult,
      error: null,
    });
  }

  markFailed(input: FailedKnowledgePageInput): Promise<void> {
    return this.updateScoped(input.id, input.projectId, {
      status: 'FAILED',
      attempts: { increment: 1 },
      error: input.error,
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
    const total = await this.prisma.knowledgeDocumentPage.count({
      where: { ingestionFileId },
    });
    if (total === 0) return false;

    const remaining = await this.prisma.knowledgeDocumentPage.count({
      where: {
        ingestionFileId,
        status: { not: 'SUCCEEDED' },
      },
    });
    return remaining === 0;
  }

  private async updateScoped(
    id: string,
    projectId: string,
    data: Prisma.KnowledgeDocumentPageUpdateManyMutationInput,
  ): Promise<void> {
    const { count } = await this.prisma.knowledgeDocumentPage.updateMany({
      where: { id, projectId },
      data,
    });
    if (count !== 1) {
      throw new KnowledgePageNotFoundError(id, projectId);
    }
  }

  private assertPageParent(
    page: Pick<
      KnowledgeDocumentPage,
      'projectId' | 'knowledgeDocumentId'
    >,
    input: UpsertPendingKnowledgePageInput,
  ): void {
    if (
      page.projectId !== input.projectId ||
      page.knowledgeDocumentId !== input.knowledgeDocumentId
    ) {
      throw new KnowledgePageNotFoundError(
        `${input.ingestionFileId}:${input.pageNumber}`,
        input.projectId,
      );
    }
  }
}
