import type { LlmUsageArea } from '../../../infrastructure/services/llm-usage-recorder.service';

export interface LlmUsageBucket {
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
  count: number;
}
export interface LlmUsageByModel extends LlmUsageBucket {
  model: string;
}
export interface LlmUsageByArea extends LlmUsageBucket {
  area: LlmUsageArea;
}
export interface LlmUsageRecent {
  id: string;
  area: LlmUsageArea;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}
export interface LlmUsageSummary {
  period: 'month' | 'all';
  from: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCostUsd: number;
  byModel: LlmUsageByModel[];
  byArea: LlmUsageByArea[];
  recent: LlmUsageRecent[];
}
