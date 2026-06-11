// リスクマネジメント（REAL table）用の型・APIヘルパー。
//
// 旧来の RecordSheet（projectId × 'risk-register', {rows}）ではなく、
// 専用テーブル Risk を直接 CRUD する。
// 既存の他ページと同じく API_URL + /api への raw fetch（localStorage の accessToken）を使う。

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** リスク・ボトルネック（Risk テーブル） */
export interface Risk {
  id: string;
  projectId: string;
  code: string | null; // リスクID（表示用）
  type: string | null; // 種別（リスク / ボトルネック）
  event: string | null; // 事象内容
  causeCategory: string | null; // 原因区分（人 / 情報 / 決裁 / 技術 / 外部）
  probability: string | null; // 発生確率（高 / 中 / 低）
  impact: string | null; // 影響度（高 / 中 / 低）
  priority: string | null; // 優先度（高 / 中 / 低）
  countermeasure: string | null; // 対応策（予防・軽減）
  needsMtg: string | null; // 対応MTG（要 / 不要）
  mtgDate: string | null; // MTG設定日
  deadline: string | null; // 期限
  owner: string | null; // 担当
  status: string | null; // ステータス
  note: string | null; // 備考
  order: number;
  createdAt?: string;
  updatedAt?: string;

  // --- PMBOK準拠の追加項目 ---
  // バックエンド（RiskOutput）は常に返すが、既存テスト・既存呼び出しの
  // 後方互換のためフロント型ではすべて任意にしている。
  /** RBSカテゴリ（RiskCategory）ID。null は未分類。 */
  categoryId?: string | null;
  /** 対象サブ領域（SubProject）ID */
  subProjectId?: string | null;
  /** リスクオーナー（Stakeholder）ID */
  ownerStakeholderId?: string | null;
  /** レビュー会議体（Meeting）ID */
  reviewMeetingId?: string | null;
  /** 発生確率スコア（1-5） */
  probabilityScore?: number | null;
  /** 影響度スコア（1-5） */
  impactScore?: number | null;
  /** リスク種別（THREAT=脅威 / OPPORTUNITY=好機） */
  riskType?: string | null;
  /** 対応戦略（脅威: 回避/転嫁/軽減/受容、好機: 活用/共有/強化/受容） */
  strategy?: string | null;
  /** 対応計画 */
  responsePlan?: string | null;
  /** コンティンジェンシー計画 */
  contingencyPlan?: string | null;
  /** トリガー条件 */
  trigger?: string | null;
  /** ライフサイクル（IDENTIFIED/ANALYZED/RESPONDING/MONITORING/OCCURRED/CLOSED） */
  lifecycle?: string | null;
}

/** RBS（リスク・ブレークダウン・ストラクチャー）カテゴリ（RiskCategory テーブル） */
export interface RiskCategory {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 作成・更新で送る入力（すべて任意）。 */
export type RiskInput = Partial<
  Omit<Risk, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;

// ---------------------------------------------------------------------------
// Risk API
// ---------------------------------------------------------------------------

export async function listRisks(projectId: string): Promise<Risk[]> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/risks`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('リスクの読み込みに失敗しました');
  return res.json();
}

export async function createRisk(
  projectId: string,
  input: RiskInput,
): Promise<Risk> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/risks`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('リスクの作成に失敗しました');
  return res.json();
}

export async function updateRisk(
  id: string,
  input: RiskInput,
): Promise<Risk> {
  const res = await fetch(`${API_URL}/api/risks/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error('リスクの更新に失敗しました');
  return res.json();
}

export async function deleteRisk(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/risks/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error('リスクの削除に失敗しました');
}

// ---------------------------------------------------------------------------
// RiskCategory API（masters.ts の systemApi 等と同じ作法）
// ---------------------------------------------------------------------------

export const riskCategoryApi = {
  /** 一覧取得（0件ならバックエンド側で PMBOK RBS 初期カテゴリをシード）。 */
  async list(projectId: string): Promise<RiskCategory[]> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/risk-categories`,
      { headers: getHeaders() },
    );
    if (!res.ok) throw new Error('リスク種別の取得に失敗しました');
    return res.json();
  },
  async create(
    projectId: string,
    body: { name: string; order?: number },
  ): Promise<RiskCategory> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/risk-categories`,
      { method: 'POST', headers: getHeaders(), body: JSON.stringify(body) },
    );
    if (!res.ok) throw new Error('リスク種別の作成に失敗しました');
    return res.json();
  },
  async update(
    id: string,
    patch: { name?: string; order?: number },
  ): Promise<RiskCategory> {
    const res = await fetch(`${API_URL}/api/risk-categories/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('リスク種別の更新に失敗しました');
    return res.json();
  },
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/risk-categories/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error('リスク種別の削除に失敗しました');
  },
};

// ---------------------------------------------------------------------------
// PMBOK 区分定義（リスク種別・戦略・ライフサイクル・スコア）
// ---------------------------------------------------------------------------

/** リスク種別: THREAT=脅威（マイナス影響）/ OPPORTUNITY=好機（プラス影響）。 */
export type RiskType = 'THREAT' | 'OPPORTUNITY';

export const RISK_TYPE_OPTIONS: { value: RiskType; label: string }[] = [
  { value: 'THREAT', label: '脅威' },
  { value: 'OPPORTUNITY', label: '好機' },
];

/** 生値を THREAT / OPPORTUNITY に正規化する（未設定・不明は THREAT 扱い）。 */
export function normalizeRiskType(raw: string | null | undefined): RiskType {
  return raw === 'OPPORTUNITY' ? 'OPPORTUNITY' : 'THREAT';
}

export function riskTypeLabel(raw: string | null | undefined): string {
  return normalizeRiskType(raw) === 'OPPORTUNITY' ? '好機' : '脅威';
}

/** 脅威への対応戦略（PMBOK）。 */
export const THREAT_STRATEGIES = ['回避', '転嫁', '軽減', '受容'] as const;
/** 好機への対応戦略（PMBOK）。 */
export const OPPORTUNITY_STRATEGIES = ['活用', '共有', '強化', '受容'] as const;

/** リスク種別（脅威/好機）に応じた戦略の選択肢。純粋関数（テスト可能）。 */
export function strategiesForRiskType(
  riskType: string | null | undefined,
): readonly string[] {
  return normalizeRiskType(riskType) === 'OPPORTUNITY'
    ? OPPORTUNITY_STRATEGIES
    : THREAT_STRATEGIES;
}

/** ライフサイクル（PMBOK のリスク監視プロセスに沿った状態遷移）。 */
export type RiskLifecycle =
  | 'IDENTIFIED'
  | 'ANALYZED'
  | 'RESPONDING'
  | 'MONITORING'
  | 'OCCURRED'
  | 'CLOSED';

export const RISK_LIFECYCLES: RiskLifecycle[] = [
  'IDENTIFIED',
  'ANALYZED',
  'RESPONDING',
  'MONITORING',
  'OCCURRED',
  'CLOSED',
];

export const riskLifecycleMeta: Record<
  RiskLifecycle,
  { label: string; chip: string }
> = {
  IDENTIFIED: { label: '特定', chip: 'bg-gray-100 text-gray-700 border-gray-200' },
  ANALYZED: { label: '分析済', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  RESPONDING: { label: '対応中', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  MONITORING: { label: '監視中', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  OCCURRED: { label: '顕在化', chip: 'bg-red-50 text-red-700 border-red-200' },
  CLOSED: { label: '終結', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** 未知のライフサイクル値でも落ちないようフォールバック付きで参照する。 */
export function lifecycleMeta(raw: string | null | undefined): {
  label: string;
  chip: string;
} {
  if (raw && raw in riskLifecycleMeta) {
    return riskLifecycleMeta[raw as RiskLifecycle];
  }
  return {
    label: raw ?? '—',
    chip: 'bg-gray-100 text-gray-500 border-gray-200',
  };
}

/** 1-5 の整数スコアならその値、それ以外（未評価）は null。純粋関数。 */
export function pickScore(raw: number | null | undefined): number | null {
  return raw != null && Number.isInteger(raw) && raw >= 1 && raw <= 5
    ? raw
    : null;
}

/**
 * 確率×影響のスコア（P×I）。どちらかが未評価（1-5以外）なら null。
 * 純粋関数（テスト可能）。
 */
export function riskScore(
  probabilityScore: number | null | undefined,
  impactScore: number | null | undefined,
): number | null {
  const p = pickScore(probabilityScore);
  const i = pickScore(impactScore);
  return p != null && i != null ? p * i : null;
}

/** スコア帯: 低（1-4）/ 中（5-12）/ 高（15-25）。純粋関数（テスト可能）。 */
export type ScoreBand = 'low' | 'mid' | 'high';

export function scoreBand(score: number): ScoreBand {
  if (score >= 15) return 'high';
  if (score >= 5) return 'mid';
  return 'low';
}

/** スコアバッジ（一覧・モーダル）の色。 */
export const scoreBandBadgeClasses: Record<ScoreBand, string> = {
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  mid: 'border-amber-200 bg-amber-50 text-amber-700',
  high: 'border-red-200 bg-red-50 text-red-700',
};

/** ヒートマップのセル背景色（薄色）。 */
export const scoreBandCellClasses: Record<ScoreBand, string> = {
  low: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800',
  mid: 'bg-amber-50 hover:bg-amber-100 text-amber-800',
  high: 'bg-red-50 hover:bg-red-100 text-red-800',
};

/** ヒートマップセルのキー（確率×影響）。 */
export function heatmapCellKey(probability: number, impact: number): string {
  return `${probability}-${impact}`;
}

/**
 * 確率×影響 5×5 ヒートマップの件数集計。
 * THREAT（脅威。未設定も THREAT 扱い）のみ・確率/影響とも 1-5 で評価済みの
 * リスクだけを数える。キーは heatmapCellKey(確率, 影響)。純粋関数（テスト可能）。
 */
export function countHeatmapCells(risks: Risk[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of risks) {
    if (normalizeRiskType(r.riskType) !== 'THREAT') continue;
    const p = pickScore(r.probabilityScore);
    const i = pickScore(r.impactScore);
    if (p == null || i == null) continue;
    const key = heatmapCellKey(p, i);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------------------
// 区分定義・集計（純粋・テスト可能）
// ---------------------------------------------------------------------------

export const LEVELS = ['高', '中', '低'] as const;
export type Level = (typeof LEVELS)[number];

export const RISK_TYPES = ['リスク', 'ボトルネック'] as const;
export const CAUSE_CATEGORIES = ['人', '情報', '決裁', '技術', '外部'] as const;
export const NEEDS_MTG_OPTIONS = ['要', '不要'] as const;
export const STATUS_OPTIONS = [
  '未対応',
  '対応中',
  '監視中',
  '解消',
] as const;

/** 優先度ごとの件数。 */
export type PriorityCounts = {
  high: number;
  mid: number;
  low: number;
  other: number;
};

/**
 * 優先度の生値を 高/中/低/その他 に分類する。
 * 高/high/h、中/mid/medium/m、低/low/l を許容（大文字小文字・前後空白を無視）。
 * いずれにも一致しない値・未設定は 'other'。純粋関数（テスト可能）。
 */
export function classifyPriority(
  raw: string | null | undefined,
): 'high' | 'mid' | 'low' | 'other' {
  const p = (raw ?? '').trim();
  if (!p) return 'other';
  if (/高|high|h/i.test(p)) return 'high';
  if (/中|mid|medium|m/i.test(p)) return 'mid';
  if (/低|low|l/i.test(p)) return 'low';
  return 'other';
}

/** リスク一覧から優先度ごとの件数を集計する。純粋関数（テスト可能）。 */
export function countByPriority(risks: Risk[]): PriorityCounts {
  const acc: PriorityCounts = { high: 0, mid: 0, low: 0, other: 0 };
  for (const r of risks) {
    acc[classifyPriority(r.priority)] += 1;
  }
  return acc;
}

/**
 * 発生確率 × 影響度 から推奨優先度を導く（高×高=高 など）。
 * 完全一致のみ評価し、いずれかが未区分なら '' を返す。純粋関数（テスト可能）。
 */
export function suggestPriority(
  probability: string | null | undefined,
  impact: string | null | undefined,
): Level | '' {
  const pr = pickLevel(probability);
  const im = pickLevel(impact);
  if (!pr || !im) return '';
  const score = (lv: Level) => (lv === '高' ? 3 : lv === '中' ? 2 : 1);
  const total = score(pr) + score(im);
  if (total >= 5) return '高';
  if (total >= 4) return '中';
  return '低';
}

/** 高/中/低 のいずれかに完全一致すればその値、それ以外は '' を返す。 */
export function pickLevel(raw: string | null | undefined): Level | '' {
  const t = (raw ?? '').trim();
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : '';
}
