// AI使用量サマリ API。raw fetch + localStorage 'accessToken'（既存 lib 慣習）。
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export type LlmUsageArea =
  | 'KNOWLEDGE_EXTRACTION'
  | 'MERMAID_FLOW'
  | 'MERMAID_OBJECT'
  | 'KPI'
  | 'REQUIREMENT'
  | 'ISSUE_SUGGEST'
  | 'CODE_EXTRACTION'
  | 'RAG'
  | 'OTHER';

export const AREA_LABEL: Record<LlmUsageArea, string> = {
  KNOWLEDGE_EXTRACTION: 'ナレッジ抽出',
  MERMAID_FLOW: 'Mermaid→業務フロー',
  MERMAID_OBJECT: 'Mermaid→オブジェクト図',
  KPI: 'KPI生成',
  REQUIREMENT: '要求定義',
  ISSUE_SUGGEST: 'イシューツリー候補',
  CODE_EXTRACTION: 'コード/スキーマ解析',
  RAG: 'RAG索引生成',
  OTHER: 'その他',
};

export interface LlmPromptVersionRef {
  id: string;
  version: number;
  model: string;
}

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
  promptVersion: LlmPromptVersionRef | null;
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

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

export const llmUsageApi = {
  async getSummary(
    projectId: string,
    period: 'month' | 'all',
  ): Promise<LlmUsageSummary> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/llm-usage?period=${period}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error('AI使用量の取得に失敗しました');
    return res.json() as Promise<LlmUsageSummary>;
  },
};

/** トークン数を人間可読に（1,234 / 12.3K / 1.2M）。 */
export function formatTokens(n: number): string {
  if (n < 1000) return n.toLocaleString('en-US');
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/** 概算コスト（USD）表示。 */
export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function formatPromptVersionLabel(
  promptVersion: LlmPromptVersionRef | null,
): string | null {
  if (!promptVersion) return null;
  return `プロンプト v${promptVersion.version} · ${promptVersion.model}`;
}
