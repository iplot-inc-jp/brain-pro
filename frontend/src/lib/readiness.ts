// プロジェクト充実度（Readiness）の型・APIヘルパー。
// backend の ProjectReadinessController のレスポンス契約と一致させる。

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export type ReadinessStatus = 'empty' | 'started' | 'rich';

export interface ReadinessSection {
  key: string;
  label: string;
  group: string;
  count: number;
  target: number;
  status: ReadinessStatus;
}

export interface ReadinessGroup {
  key: string;
  label: string;
  /** グループ内の平均充実率（0〜100） */
  percent: number;
  sections: ReadinessSection[];
}

export interface ReadinessReport {
  projectName: string | null;
  overallPercent: number;
  totalSections: number;
  completedSections: number;
  groups: ReadinessGroup[];
}

/** LLM(Haiku) 分析の結果。 */
export interface ReadinessAnalysis {
  headline: string;
  priorities: Array<{ title: string; detail: string }>;
  watchouts: string[];
}

/** 充実度（定量）を取得。 */
export async function getReadiness(
  projectId: string,
): Promise<ReadinessReport> {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/readiness`,
    { headers: getHeaders() },
  );
  if (!res.ok) throw new Error('充実度の取得に失敗しました');
  return res.json();
}

/** 充実度を LLM(Haiku) で分析。 */
export async function analyzeReadiness(
  projectId: string,
): Promise<ReadinessAnalysis> {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/readiness/analyze`,
    { method: 'POST', headers: getHeaders() },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || 'AI分析に失敗しました');
  }
  return res.json();
}
