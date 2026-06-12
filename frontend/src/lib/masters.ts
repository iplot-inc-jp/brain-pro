// 共通マスタ（システム / 制約条件 / 領域(SubProject)）の API クライアント。
// fetch 作法・headers()・エラーメッセージは dfd.ts の informationTypeApi を踏襲する。

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ========== システム（System） ==========

/** システム種別: 周辺システム / 対象システム。 */
export type SystemKind = 'PERIPHERAL' | 'TARGET';

export interface SystemMaster {
  id: string;
  projectId: string;
  /** 所属する領域（サブプロジェクト）ID。未指定なら null。 */
  subProjectId: string | null;
  name: string;
  kind: SystemKind;
  description: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export const systemApi = {
  async list(projectId: string): Promise<SystemMaster[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/systems`, { headers: headers() });
    if (!res.ok) throw new Error('システムの取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: { name: string; kind?: SystemKind; description?: string | null; subProjectId?: string | null; order?: number },
  ): Promise<SystemMaster> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/systems`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('システムの作成に失敗しました');
    return res.json();
  },
  async update(
    id: string,
    patch: { name?: string; kind?: SystemKind; description?: string | null; subProjectId?: string | null; order?: number },
  ): Promise<SystemMaster> {
    const res = await fetch(`${API_URL}/api/systems/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('システムの更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/systems/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('システムの削除に失敗しました');
  },
};

// ========== 制約条件（Constraint） ==========

/** 制約の種別: CONSTRAINT=制約 / ASSUMPTION=前提条件。 */
export type ConstraintKind = 'CONSTRAINT' | 'ASSUMPTION';

export const CONSTRAINT_KINDS: ConstraintKind[] = ['CONSTRAINT', 'ASSUMPTION'];

/** 種別バッジ表示（制約=blue / 前提条件=violet）。 */
export const constraintKindMeta: Record<ConstraintKind, { label: string; badge: string }> = {
  CONSTRAINT: { label: '制約', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  ASSUMPTION: { label: '前提条件', badge: 'border-violet-200 bg-violet-50 text-violet-700' },
};

/** 生値を ConstraintKind に正規化する（既存データ＝未設定は制約扱い）。 */
export function normalizeConstraintKind(raw: string | null | undefined): ConstraintKind {
  return raw === 'ASSUMPTION' ? 'ASSUMPTION' : 'CONSTRAINT';
}

export interface ConstraintMaster {
  id: string;
  projectId: string;
  /** 所属する領域（サブプロジェクト）ID。未指定なら null。 */
  subProjectId: string | null;
  title: string;
  description: string | null;
  category: string | null;
  /** 種別（CONSTRAINT=制約 / ASSUMPTION=前提条件）。既存データは null（=制約扱い）。 */
  kind?: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export const constraintApi = {
  async list(projectId: string): Promise<ConstraintMaster[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/constraints`, { headers: headers() });
    if (!res.ok) throw new Error('制約条件の取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: { title: string; description?: string | null; category?: string | null; kind?: ConstraintKind; subProjectId?: string | null; order?: number },
  ): Promise<ConstraintMaster> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/constraints`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('制約条件の作成に失敗しました');
    return res.json();
  },
  async update(
    id: string,
    patch: { title?: string; description?: string | null; category?: string | null; kind?: ConstraintKind; subProjectId?: string | null; order?: number },
  ): Promise<ConstraintMaster> {
    const res = await fetch(`${API_URL}/api/constraints/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('制約条件の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/constraints/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('制約条件の削除に失敗しました');
  },
};

// ========== 領域（SubProject） ==========

export interface SubProjectMaster {
  id: string;
  projectId: string;
  /** 親領域ID。トップ領域なら null、サブ領域なら親領域のID。 */
  parentId: string | null;
  name: string;
  description: string | null;
  order: number;
}

export const subProjectApi = {
  async list(projectId: string): Promise<SubProjectMaster[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/sub-projects`, { headers: headers() });
    if (!res.ok) throw new Error('領域の取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: { name: string; parentId?: string | null; description?: string | null; order?: number },
  ): Promise<SubProjectMaster> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/sub-projects`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error('領域の作成に失敗しました');
    return res.json();
  },
  // バックエンドの更新ルートは PUT /api/sub-projects/:id（system/constraint の PATCH とは異なる）。
  async update(
    id: string,
    patch: { name?: string; parentId?: string | null; description?: string | null; order?: number },
  ): Promise<SubProjectMaster> {
    const res = await fetch(`${API_URL}/api/sub-projects/${id}`, { method: 'PUT', headers: headers(), body: JSON.stringify(patch) });
    if (!res.ok) throw new Error('領域の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/sub-projects/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('領域の削除に失敗しました');
  },
};
