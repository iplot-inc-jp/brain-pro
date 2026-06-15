import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';

/** どの機能でトークンを使ったか（Prisma enum LlmUsageArea と一致）。 */
export type LlmUsageArea =
  | 'KNOWLEDGE_EXTRACTION'
  | 'MERMAID_FLOW'
  | 'MERMAID_OBJECT'
  | 'KPI'
  | 'REQUIREMENT'
  | 'ISSUE_SUGGEST'
  | 'CODE_EXTRACTION'
  | 'OTHER';

/** 記録に必要なコンテキスト（呼び出し元が渡す）。 */
export interface LlmUsageContext {
  projectId: string;
  area: LlmUsageArea;
  userId?: string | null;
  organizationId?: string | null;
}

/** Anthropic response.usage の最小形（フィールドは snake_case）。 */
export interface AnthropicUsageLike {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/**
 * Claude 呼び出しのトークン使用量を llm_usage_logs に記録する中央集約サービス。
 * 記録失敗は AI 本処理を壊さないよう握る（ログのみ）。projectId 不明なら記録しない。
 */
@Injectable()
export class LlmUsageRecorder {
  private readonly logger = new Logger(LlmUsageRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(
    ctx: LlmUsageContext,
    model: string,
    usage: AnthropicUsageLike | null | undefined,
  ): Promise<void> {
    if (!ctx?.projectId) return;
    try {
      await this.prisma.llmUsageLog.create({
        data: {
          projectId: ctx.projectId,
          organizationId: ctx.organizationId ?? null,
          userId: ctx.userId ?? null,
          area: ctx.area,
          model,
          inputTokens: usage?.input_tokens ?? 0,
          outputTokens: usage?.output_tokens ?? 0,
          cacheReadInputTokens: usage?.cache_read_input_tokens ?? null,
          cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? null,
        },
      });
    } catch (err) {
      this.logger.error(
        `LLM使用量の記録に失敗（握り）: project=${ctx.projectId} area=${ctx.area} model=${model}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
