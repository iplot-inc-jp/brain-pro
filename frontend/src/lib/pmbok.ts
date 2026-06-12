// PMBOK 補完（プロジェクト憲章 / 変更要求 / 教訓）の型・ラベル・API クライアント。
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

// ========== 変更要求（ChangeRequest） ==========

export type ChangeRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'APPLIED';

export const CHANGE_REQUEST_STATUSES: ChangeRequestStatus[] = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'APPLIED',
];

/** 状態バッジ表示（申請=gray / 承認=emerald / 却下=rose / 適用=blue）。 */
export const changeRequestStatusMeta: Record<
  ChangeRequestStatus,
  { label: string; badge: string }
> = {
  REQUESTED: { label: '申請', badge: 'border-gray-200 bg-gray-50 text-gray-600' },
  APPROVED: { label: '承認', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  REJECTED: { label: '却下', badge: 'border-rose-200 bg-rose-50 text-rose-700' },
  APPLIED: { label: '適用', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
};

/** 生値を ChangeRequestStatus に正規化する（未設定・不明は REQUESTED 扱い）。 */
export function normalizeChangeRequestStatus(
  raw: string | null | undefined,
): ChangeRequestStatus {
  return raw === 'APPROVED' || raw === 'REJECTED' || raw === 'APPLIED'
    ? raw
    : 'REQUESTED';
}

export interface ChangeRequest {
  id: string;
  projectId: string;
  title: string;
  reason: string | null;
  impactScope: string | null;
  impactSchedule: string | null;
  impactCost: string | null;
  status: string | null;
  approverStakeholderId: string | null;
  decidedAt: string | null;
  note: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 作成・更新で送る入力 */
export interface ChangeRequestInput {
  title?: string;
  reason?: string | null;
  impactScope?: string | null;
  impactSchedule?: string | null;
  impactCost?: string | null;
  status?: ChangeRequestStatus;
  approverStakeholderId?: string | null;
  note?: string | null;
  order?: number;
}

export const changeRequestApi = {
  async list(projectId: string): Promise<ChangeRequest[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/change-requests`, { headers: headers() });
    if (!res.ok) throw new Error('変更要求の取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: ChangeRequestInput & { title: string },
  ): Promise<ChangeRequest> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/change-requests`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('変更要求の作成に失敗しました');
    return res.json();
  },
  async update(id: string, patch: ChangeRequestInput): Promise<ChangeRequest> {
    const res = await fetch(`${API_URL}/api/change-requests/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('変更要求の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/change-requests/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('変更要求の削除に失敗しました');
  },
};

// ========== 教訓（LessonLearned） ==========

export type LessonKind = 'WENT_WELL' | 'PROBLEM' | 'IMPROVEMENT';

export const LESSON_KINDS: LessonKind[] = ['WENT_WELL', 'PROBLEM', 'IMPROVEMENT'];

/** 分類バッジ表示（うまくいった=emerald / 問題=rose / 改善提案=amber）。 */
export const lessonKindMeta: Record<LessonKind, { label: string; badge: string }> = {
  WENT_WELL: { label: 'うまくいった', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  PROBLEM: { label: '問題', badge: 'border-rose-200 bg-rose-50 text-rose-700' },
  IMPROVEMENT: { label: '改善提案', badge: 'border-amber-300 bg-amber-50 text-amber-800' },
};

/** 生値を LessonKind に正規化する（未設定・不明は WENT_WELL 扱い）。 */
export function normalizeLessonKind(raw: string | null | undefined): LessonKind {
  return raw === 'PROBLEM' || raw === 'IMPROVEMENT' ? raw : 'WENT_WELL';
}

export interface LessonLearned {
  id: string;
  projectId: string;
  kind: string | null;
  content: string;
  recommendation: string | null;
  subProjectId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 作成・更新で送る入力 */
export interface LessonLearnedInput {
  kind?: LessonKind;
  content?: string;
  recommendation?: string | null;
  subProjectId?: string | null;
  order?: number;
}

export const lessonApi = {
  async list(projectId: string): Promise<LessonLearned[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/lessons`, { headers: headers() });
    if (!res.ok) throw new Error('教訓の取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: LessonLearnedInput & { content: string },
  ): Promise<LessonLearned> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/lessons`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('教訓の作成に失敗しました');
    return res.json();
  },
  async update(id: string, patch: LessonLearnedInput): Promise<LessonLearned> {
    const res = await fetch(`${API_URL}/api/lessons/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('教訓の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/lessons/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('教訓の削除に失敗しました');
  },
};
