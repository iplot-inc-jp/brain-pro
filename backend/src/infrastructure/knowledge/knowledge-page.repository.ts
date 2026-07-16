import { Inject, Injectable } from '@nestjs/common';
import {
  KnowledgeDocumentPage,
  KnowledgePageKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';

export interface KnowledgePagePrismaClient {
  knowledgeDocumentPage: {
    findFirst(
      args: Prisma.KnowledgeDocumentPageFindFirstArgs,
    ): Promise<KnowledgeDocumentPage | null>;
    findUnique(
      args: Prisma.KnowledgeDocumentPageFindUniqueArgs,
    ): Promise<KnowledgeDocumentPage | null>;
    create(
      args: Prisma.KnowledgeDocumentPageCreateArgs,
    ): Promise<KnowledgeDocumentPage>;
    updateMany(
      args: Prisma.KnowledgeDocumentPageUpdateManyArgs,
    ): Promise<Prisma.BatchPayload>;
    findMany(
      args: Prisma.KnowledgeDocumentPageFindManyArgs,
    ): Promise<KnowledgeDocumentPage[]>;
    count(args: Prisma.KnowledgeDocumentPageCountArgs): Promise<number>;
  };
  ingestionFile: {
    findFirst(
      args: Prisma.IngestionFileFindFirstArgs,
    ): Promise<{ id: string } | null>;
  };
  knowledgeDocument: {
    findFirst(
      args: Prisma.KnowledgeDocumentFindFirstArgs,
    ): Promise<{ id: string } | null>;
  };
  backgroundJob: {
    findFirst(
      args: Prisma.BackgroundJobFindFirstArgs,
    ): Promise<{ id: string } | null>;
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

export interface KnowledgePagesForFileInput {
  projectId: string;
  ingestionFileId: string;
}

export interface KnowledgePagesForDocumentInput {
  projectId: string;
  knowledgeDocumentId: string;
}

export class KnowledgePageNotFoundError extends Error {
  constructor(id: string, projectId: string) {
    super(`Knowledge page ${id} was not found in project ${projectId}`);
    this.name = 'KnowledgePageNotFoundError';
  }
}

export class KnowledgePageJobNotFoundError extends Error {
  constructor(id: string, projectId: string) {
    super(`Background job ${id} was not found in project ${projectId}`);
    this.name = 'KnowledgePageJobNotFoundError';
  }
}

@Injectable()
export class KnowledgePageRepository {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: KnowledgePagePrismaClient,
  ) {}

  findById(input: ScopedKnowledgePageInput) {
    return this.prisma.knowledgeDocumentPage.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
  }

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
    });
    if (existing) {
      this.assertPageParent(existing, input);
      return existing;
    }

    await this.assertScopedParents(input);

    try {
      return await this.prisma.knowledgeDocumentPage.create({
        data: {
          projectId,
          ingestionFileId,
          knowledgeDocumentId,
          pageNumber,
          pageKind,
          sourceText,
          sourceBlobUrl,
          status: 'PENDING',
        },
      });
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const raced = await this.prisma.knowledgeDocumentPage.findUnique({ where });
      if (!raced) throw this.pageNotFound(input);
      this.assertPageParent(raced, input);
      return raced;
    }
  }

  private async assertScopedParents(
    input: UpsertPendingKnowledgePageInput,
  ): Promise<void> {
    const [file, document] = await Promise.all([
      this.prisma.ingestionFile.findFirst({
        where: { id: input.ingestionFileId, projectId: input.projectId },
        select: { id: true },
      }),
      this.prisma.knowledgeDocument.findFirst({
        where: {
          id: input.knowledgeDocumentId,
          projectId: input.projectId,
          ingestionFileId: input.ingestionFileId,
        },
        select: { id: true },
      }),
    ]);
    if (!file || !document) throw this.pageNotFound(input);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2002';
    }
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  private pageNotFound(
    input: UpsertPendingKnowledgePageInput,
  ): KnowledgePageNotFoundError {
    return new KnowledgePageNotFoundError(
      `${input.ingestionFileId}:${input.pageNumber}`,
      input.projectId,
    );
  }

  async markProcessing(input: ProcessingKnowledgePageInput): Promise<void> {
    const job = await this.prisma.backgroundJob.findFirst({
      where: { id: input.jobId, projectId: input.projectId },
      select: { id: true },
    });
    if (!job) {
      throw new KnowledgePageJobNotFoundError(input.jobId, input.projectId);
    }
    await this.updateScoped(input.id, input.projectId, {
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

  listForFile(input: KnowledgePagesForFileInput) {
    return this.prisma.knowledgeDocumentPage.findMany({
      where: {
        projectId: input.projectId,
        ingestionFileId: input.ingestionFileId,
      },
      orderBy: { pageNumber: 'asc' },
    });
  }

  listForDocument(input: KnowledgePagesForDocumentInput) {
    return this.prisma.knowledgeDocumentPage.findMany({
      where: {
        projectId: input.projectId,
        knowledgeDocumentId: input.knowledgeDocumentId,
      },
      orderBy: { pageNumber: 'asc' },
    });
  }

  async allSucceeded(input: KnowledgePagesForFileInput): Promise<boolean> {
    const total = await this.prisma.knowledgeDocumentPage.count({
      where: {
        projectId: input.projectId,
        ingestionFileId: input.ingestionFileId,
      },
    });
    if (total === 0) return false;

    const remaining = await this.prisma.knowledgeDocumentPage.count({
      where: {
        projectId: input.projectId,
        ingestionFileId: input.ingestionFileId,
        status: { not: 'SUCCEEDED' },
      },
    });
    return remaining === 0;
  }

  private async updateScoped(
    id: string,
    projectId: string,
    data: Prisma.KnowledgeDocumentPageUncheckedUpdateManyInput,
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
      throw this.pageNotFound(input);
    }
  }
}
