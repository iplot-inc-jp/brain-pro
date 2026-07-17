import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClaudeService } from '../services/claude.service';
import { PrismaService } from '../persistence/prisma/prisma.service';
import {
  batchRagSourceItems,
  buildRagSearchText,
  RagCompressedDocument,
  RagFeatureType,
  RagSourceItem,
} from './rag.types';
import { RagSourceService } from './rag-source.service';
import { RagPromptService } from './rag-prompt.service';

export type RagIndexState = 'UNGENERATED' | 'FRESH' | 'STALE';

export interface RagGenerateInput {
  projectId: string;
  featureType: RagFeatureType;
  targetId?: string | null;
  userId?: string | null;
  apiKey: string;
  onProgress?: (progress: number) => Promise<void> | void;
}

export interface RagSearchInput {
  q?: string;
  featureType?: RagFeatureType;
  scopeLevel?: 'OVERVIEW' | 'COMPONENT';
  limit?: number;
}

export interface RagSearchResult {
  id: string;
  projectId: string;
  featureType: RagFeatureType;
  scopeLevel: 'OVERVIEW' | 'COMPONENT';
  sourceKey: string;
  sourceUrl: string;
  title: string;
  summary: string;
  content: string;
  keywords: string[];
  aliases: string[];
  questions: string[];
  metadata: Record<string, unknown>;
  generatedAt: Date;
  score: number;
}

interface CompressedWithModel {
  document: RagCompressedDocument;
  model: string;
}

@Injectable()
export class RagIndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: RagSourceService,
    private readonly claude: ClaudeService,
    private readonly prompts: RagPromptService,
  ) {}

  async generate(input: RagGenerateInput): Promise<{
    featureType: RagFeatureType;
    targetKey: string;
    sourceHash: string;
    documentCount: number;
  }> {
    const bundle = await this.sources.build(
      input.projectId,
      input.featureType,
      input.targetId,
    );
    const prompt = await this.prompts.getActive(input.projectId, input.userId);
    await input.onProgress?.(20);

    const batches = [
      [bundle.overview],
      ...batchRagSourceItems(bundle.components, { maxItems: 12, maxChars: 24_000 }),
    ];
    const compressed: CompressedWithModel[] = [];
    for (let index = 0; index < batches.length; index += 1) {
      const result = await this.claude.compressForRag(
        batches[index],
        input.apiKey,
        {
          model: prompt.model,
          systemPrompt: prompt.systemPrompt,
          promptVersionId: prompt.id,
        },
        { projectId: input.projectId, area: 'RAG', userId: input.userId },
      );
      compressed.push(
        ...result.documents.map((document) => ({ document, model: result.model })),
      );
      await input.onProgress?.(20 + Math.round(((index + 1) / batches.length) * 60));
    }

    const sourceByKey = new Map<string, RagSourceItem>([
      [bundle.overview.sourceKey, bundle.overview],
      ...bundle.components.map((source) => [source.sourceKey, source] as const),
    ]);
    const overviewKey = bundle.overview.sourceKey;
    const generatedAt = new Date();

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const { document, model } of compressed) {
        const source = sourceByKey.get(document.sourceKey);
        if (!source) {
          throw new Error(`RAG保存対象のsourceKeyが見つかりません: ${document.sourceKey}`);
        }
        const scopeLevel = document.sourceKey === overviewKey ? 'OVERVIEW' : 'COMPONENT';
        const data = {
          projectId: input.projectId,
          featureType: input.featureType,
          scopeLevel,
          targetKey: bundle.targetKey,
          sourceKey: document.sourceKey,
          sourceUrl: source.sourceUrl,
          title: document.title,
          summary: document.summary,
          content: document.content,
          keywords: document.keywords as Prisma.InputJsonValue,
          aliases: document.aliases as Prisma.InputJsonValue,
          questions: document.questions as Prisma.InputJsonValue,
          searchText: buildRagSearchText(document),
          metadata: (source.metadata ?? {}) as Prisma.InputJsonValue,
          sourceHash: bundle.sourceHash,
          model,
          promptVersion: prompt.id,
          generatedById: input.userId ?? null,
          generatedAt,
        };
        const saved = await tx.ragDocument.upsert({
          where: {
            projectId_featureType_scopeLevel_sourceKey: {
              projectId: input.projectId,
              featureType: input.featureType,
              scopeLevel,
              sourceKey: document.sourceKey,
            },
          },
          create: data,
          update: data,
        } as any);
        await tx.ragSourceReference.deleteMany({
          where: { ragDocumentId: saved.id },
        });
        const sourceFiles = source.sourceFiles ?? [];
        if (sourceFiles.length > 0) {
          await tx.ragSourceReference.createMany({
            data: sourceFiles.map((file, order) => ({
              ragDocumentId: saved.id,
              kind: file.kind,
              label: file.label,
              url: file.url,
              filename: file.filename ?? null,
              mimeType: file.mimeType ?? null,
              order,
            })),
            skipDuplicates: true,
          });
        }
      }

      await tx.ragDocument.deleteMany({
        where: {
          projectId: input.projectId,
          featureType: input.featureType,
          targetKey: bundle.targetKey,
          scopeLevel: 'COMPONENT',
          sourceKey: { notIn: bundle.components.map((source) => source.sourceKey) },
        },
      });
    });
    await input.onProgress?.(95);

    return {
      featureType: input.featureType,
      targetKey: bundle.targetKey,
      sourceHash: bundle.sourceHash,
      documentCount: compressed.length,
    };
  }

  async status(
    projectId: string,
    featureType: RagFeatureType,
    targetId?: string | null,
  ): Promise<{
    state: RagIndexState;
    documentCount: number;
    generatedAt: Date | null;
    model: string | null;
    overviewSummary: string | null;
    sourceHash: string | null;
  }> {
    const targetKey = targetId || 'project';
    const rows = await this.prisma.ragDocument.findMany({
      where: { projectId, featureType, targetKey },
      orderBy: [{ scopeLevel: 'asc' }, { generatedAt: 'desc' }],
      select: {
        sourceHash: true,
        generatedAt: true,
        model: true,
        summary: true,
        scopeLevel: true,
      },
    });
    if (rows.length === 0) {
      return {
        state: 'UNGENERATED', documentCount: 0, generatedAt: null, model: null,
        overviewSummary: null, sourceHash: null,
      };
    }
    const bundle = await this.sources.build(projectId, featureType, targetId);
    const overview = rows.find((row: any) => row.scopeLevel === 'OVERVIEW') ?? rows[0];
    return {
      state: rows.every((row: any) => row.sourceHash === bundle.sourceHash) ? 'FRESH' : 'STALE',
      documentCount: rows.length,
      generatedAt: overview.generatedAt,
      model: overview.model,
      overviewSummary: overview.summary,
      sourceHash: overview.sourceHash,
    };
  }

  async list(projectId: string, input: Omit<RagSearchInput, 'q'> = {}) {
    const limit = this.limit(input.limit);
    return this.prisma.ragDocument.findMany({
      where: {
        projectId,
        ...(input.featureType ? { featureType: input.featureType } : {}),
        ...(input.scopeLevel ? { scopeLevel: input.scopeLevel } : {}),
      },
      orderBy: [{ generatedAt: 'desc' }, { title: 'asc' }],
      take: limit,
    });
  }

  async search(projectId: string, input: RagSearchInput): Promise<RagSearchResult[]> {
    const q = input.q?.trim() ?? '';
    const limit = this.limit(input.limit);
    if (!q) {
      const rows = await this.list(projectId, input);
      return rows.map((row: any) => ({ ...row, score: 0 }));
    }

    const contains = `%${this.escapeLike(q)}%`;
    const featureFilter = input.featureType
      ? Prisma.sql`AND rd."feature_type" = ${input.featureType}::"RagFeatureType"`
      : Prisma.empty;
    const scopeFilter = input.scopeLevel
      ? Prisma.sql`AND rd."scope_level" = ${input.scopeLevel}::"RagScopeLevel"`
      : Prisma.empty;

    return this.prisma.$queryRaw<RagSearchResult[]>(Prisma.sql`
      SELECT
        rd."id",
        rd."project_id" AS "projectId",
        rd."feature_type"::text AS "featureType",
        rd."scope_level"::text AS "scopeLevel",
        rd."source_key" AS "sourceKey",
        rd."source_url" AS "sourceUrl",
        rd."title",
        rd."summary",
        rd."content",
        rd."keywords",
        rd."aliases",
        rd."questions",
        rd."metadata",
        rd."generated_at" AS "generatedAt",
        (
          CASE WHEN lower(rd."title") = lower(${q}) THEN 4 ELSE 0 END +
          CASE WHEN rd."title" ILIKE ${contains} ESCAPE '\\' THEN 2 ELSE 0 END +
          CASE WHEN rd."search_text" ILIKE ${contains} ESCAPE '\\' THEN 1 ELSE 0 END +
          similarity(rd."search_text", ${q})
        )::double precision AS "score"
      FROM "rag_documents" rd
      WHERE rd."project_id" = ${projectId}
        ${featureFilter}
        ${scopeFilter}
        AND (
          rd."title" ILIKE ${contains} ESCAPE '\\' OR
          rd."search_text" ILIKE ${contains} ESCAPE '\\' OR
          similarity(rd."search_text", ${q}) > 0.08
        )
      ORDER BY "score" DESC, rd."generated_at" DESC
      LIMIT ${limit}
    `);
  }

  private limit(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return 20;
    return Math.min(50, Math.floor(value));
  }

  private escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }
}
