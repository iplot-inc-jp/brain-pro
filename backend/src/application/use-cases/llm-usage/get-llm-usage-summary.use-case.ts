import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { estimateCostUsd } from '../../../infrastructure/services/llm-pricing';
import type { LlmUsageArea } from '../../../infrastructure/services/llm-usage-recorder.service';
import type {
  LlmUsageSummary,
  LlmUsageByModel,
  LlmUsageByArea,
} from './llm-usage.output';

export interface GetLlmUsageSummaryInput {
  projectId: string;
  userId: string;
  period: 'month' | 'all';
}

interface Row {
  id: string;
  area: LlmUsageArea;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  createdAt: Date;
}

@Injectable()
export class GetLlmUsageSummaryUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async execute(input: GetLlmUsageSummaryInput): Promise<LlmUsageSummary> {
    await this.access.assertProjectAccess(input.projectId, input.userId, 'view');

    const from = input.period === 'month' ? startOfCurrentMonth() : null;

    const rows = (await this.prisma.llmUsageLog.findMany({
      where: {
        projectId: input.projectId,
        ...(from ? { createdAt: { gte: from } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })) as unknown as Row[];

    const cost = (r: Row) =>
      estimateCostUsd(
        r.model,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadInputTokens ?? 0,
        r.cacheCreationInputTokens ?? 0,
      );

    const byModelMap = new Map<string, LlmUsageByModel>();
    const byAreaMap = new Map<LlmUsageArea, LlmUsageByArea>();
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;

    for (const r of rows) {
      const c = cost(r);
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCost += c;

      const m = byModelMap.get(r.model) ?? {
        model: r.model,
        inputTokens: 0,
        outputTokens: 0,
        tokens: 0,
        costUsd: 0,
        count: 0,
      };
      m.inputTokens += r.inputTokens;
      m.outputTokens += r.outputTokens;
      m.tokens += r.inputTokens + r.outputTokens;
      m.costUsd += c;
      m.count += 1;
      byModelMap.set(r.model, m);

      const a = byAreaMap.get(r.area) ?? {
        area: r.area,
        inputTokens: 0,
        outputTokens: 0,
        tokens: 0,
        costUsd: 0,
        count: 0,
      };
      a.inputTokens += r.inputTokens;
      a.outputTokens += r.outputTokens;
      a.tokens += r.inputTokens + r.outputTokens;
      a.costUsd += c;
      a.count += 1;
      byAreaMap.set(r.area, a);
    }

    const round = (n: number) => Math.round(n * 10000) / 10000;

    return {
      period: input.period,
      from: from ? from.toISOString() : null,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCostUsd: round(totalCost),
      byModel: Array.from(byModelMap.values())
        .map((b) => ({ ...b, costUsd: round(b.costUsd) }))
        .sort((x, y) => y.tokens - x.tokens),
      byArea: Array.from(byAreaMap.values())
        .map((b) => ({ ...b, costUsd: round(b.costUsd) }))
        .sort((x, y) => y.tokens - x.tokens),
      recent: rows.slice(0, 20).map((r) => ({
        id: r.id,
        area: r.area,
        model: r.model,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: round(cost(r)),
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}

/** 当月初日（UTC）。 */
function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
