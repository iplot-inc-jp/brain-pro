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

// ========== 用語集 / 用語対応表（Glossary） ==========

/** 用語の状態。 */
export type GlossaryTermStatus = 'APPROVED' | 'DRAFT' | 'DEPRECATED';

export const GLOSSARY_TERM_STATUSES: GlossaryTermStatus[] = ['APPROVED', 'DRAFT', 'DEPRECATED'];

export const glossaryTermStatusMeta: Record<GlossaryTermStatus, { label: string; badge: string }> = {
  APPROVED: { label: '確定', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  DRAFT: { label: '検討中', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  DEPRECATED: { label: '廃止', badge: 'bg-slate-100 text-slate-500 border-slate-200' },
};

/**
 * 用語対応の文脈。
 * 同じ概念が、現場・DB・画面・電文などで何と呼ばれるかを分類する。
 */
export type GlossaryMappingContext =
  | 'ALIAS'
  | 'ENGLISH'
  | 'DB'
  | 'SCREEN'
  | 'INTERFACE'
  | 'CODE'
  | 'FORBIDDEN'
  | 'OTHER';

export const GLOSSARY_MAPPING_CONTEXTS: GlossaryMappingContext[] = [
  'ALIAS',
  'ENGLISH',
  'DB',
  'SCREEN',
  'INTERFACE',
  'CODE',
  'FORBIDDEN',
  'OTHER',
];

export const glossaryMappingContextMeta: Record<
  GlossaryMappingContext,
  { label: string; hint: string; badge: string }
> = {
  ALIAS: { label: '現場の言い方', hint: '客先 / 取引先 / お客さん', badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  ENGLISH: { label: '英語', hint: 'customer', badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  DB: { label: 'DB', hint: 'customer.customer_cd', badge: 'bg-violet-50 text-violet-700 border-violet-200' },
  SCREEN: { label: '画面項目', hint: '得意先コード', badge: 'bg-teal-50 text-teal-700 border-teal-200' },
  INTERFACE: { label: '電文', hint: 'CUST_CD / 発注者コード', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  CODE: { label: 'コード', hint: 'CustomerEntity', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
  FORBIDDEN: { label: '使用禁止', hint: '顧客 / クライアント', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  OTHER: { label: 'その他', hint: '', badge: 'bg-slate-50 text-slate-600 border-slate-200' },
};

/** 生値を GlossaryMappingContext に正規化する（未知の値は OTHER 扱い）。 */
export function normalizeGlossaryContext(raw: string | null | undefined): GlossaryMappingContext {
  const v = (raw ?? 'ALIAS').toUpperCase() as GlossaryMappingContext;
  return GLOSSARY_MAPPING_CONTEXTS.includes(v) ? v : 'OTHER';
}

/** 生値を GlossaryTermStatus に正規化する。 */
export function normalizeGlossaryStatus(raw: string | null | undefined): GlossaryTermStatus {
  const v = (raw ?? 'APPROVED').toUpperCase() as GlossaryTermStatus;
  return GLOSSARY_TERM_STATUSES.includes(v) ? v : 'APPROVED';
}

export interface GlossaryTermMappingMaster {
  id: string;
  termId: string;
  context: string;
  /** どのシステム・電文での呼び名か（例: 基幹DB / WMS電文 / EDI）。 */
  systemName: string | null;
  value: string;
  note: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryTermMaster {
  id: string;
  projectId: string;
  subProjectId: string | null;
  /** 概念コード（例: CPT-001）。プロジェクト内で一意。 */
  termCode: string | null;
  /** 正式用語。 */
  name: string;
  /** 意味（それは何か）。 */
  definition: string | null;
  /** 正（source of truth）: 値が食い違ったときにどこを信じるか。 */
  sourceOfTruth: string | null;
  sourceOfTruthNote: string | null;
  category: string | null;
  status: string;
  notes: string | null;
  order: number;
  mappings: GlossaryTermMappingMaster[];
  createdAt: string;
  updatedAt: string;
}

export interface GlossaryTermBody {
  termCode?: string | null;
  name?: string;
  definition?: string | null;
  sourceOfTruth?: string | null;
  sourceOfTruthNote?: string | null;
  category?: string | null;
  status?: GlossaryTermStatus;
  notes?: string | null;
  subProjectId?: string | null;
  order?: number;
}

export interface GlossaryMappingBody {
  context?: GlossaryMappingContext;
  systemName?: string | null;
  value?: string;
  note?: string | null;
  order?: number;
}

export const glossaryTermApi = {
  async list(projectId: string): Promise<GlossaryTermMaster[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/glossary-terms`, { headers: headers() });
    if (!res.ok) throw new Error('用語集の取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: GlossaryTermBody & { name: string; mappings?: GlossaryMappingBody[] },
  ): Promise<GlossaryTermMaster> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/glossary-terms`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('用語の作成に失敗しました');
    return res.json();
  },
  async update(id: string, patch: GlossaryTermBody): Promise<GlossaryTermMaster> {
    const res = await fetch(`${API_URL}/api/glossary-terms/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('用語の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/glossary-terms/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('用語の削除に失敗しました');
  },
  async addMapping(
    termId: string,
    body: GlossaryMappingBody & { value: string },
  ): Promise<GlossaryTermMappingMaster> {
    const res = await fetch(`${API_URL}/api/glossary-terms/${termId}/mappings`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('用語対応の追加に失敗しました');
    return res.json();
  },
  async updateMapping(id: string, patch: GlossaryMappingBody): Promise<GlossaryTermMappingMaster> {
    const res = await fetch(`${API_URL}/api/glossary-term-mappings/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('用語対応の更新に失敗しました');
    return res.json();
  },
  async deleteMapping(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/glossary-term-mappings/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('用語対応の削除に失敗しました');
  },
};
