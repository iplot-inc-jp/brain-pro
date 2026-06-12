// PMBOK 補完（プロジェクト憲章 = 背景・目的）の型・API クライアント。
// fetch 作法・headers()・エラーメッセージは masters.ts を踏襲する。

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ========== プロジェクト憲章（ProjectCharter） ==========

export interface ProjectCharter {
  id: string;
  projectId: string;
  background: string | null;
  purpose: string | null;
  successCriteria: string | null;
  scopeIn: string | null;
  scopeOut: string | null;
  budgetNote: string | null;
  approverStakeholderId: string | null;
  sponsorStakeholderId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** PUT charter で送る入力（全フィールド任意・null でクリア） */
export type ProjectCharterInput = Partial<
  Omit<ProjectCharter, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;

export const charterApi = {
  /** GET /api/projects/:projectId/charter（未作成なら null） */
  async get(projectId: string): Promise<ProjectCharter | null> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/charter`, { headers: headers() });
    if (!res.ok) throw new Error('プロジェクト憲章の取得に失敗しました');
    const text = await res.text();
    return text ? (JSON.parse(text) as ProjectCharter | null) : null;
  },
  /** PUT /api/projects/:projectId/charter（upsert） */
  async upsert(projectId: string, patch: ProjectCharterInput): Promise<ProjectCharter> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/charter`, { method: 'PUT', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('プロジェクト憲章の保存に失敗しました');
    return res.json();
  },
};
