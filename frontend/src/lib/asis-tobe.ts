// ASIS/TOBE メモ（REAL table）用の型・APIヘルパー。
//
// 旧来の RecordSheet（projectId × 'asis-overview' / 'tobe-vision' / 'tobe-roadmap', {rows}）
// ではなく、専用テーブル AsisMemo / TobeVision / TobeRoadmap を直接 CRUD する。
// 既存の Risk スライスと同じく API_URL + /api への raw fetch（localStorage の accessToken）を使う。

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

/** 現状メモ（AsisMemo テーブル） */
export interface AsisMemo {
  id: string;
  projectId: string;
  topic: string | null; // 項目
  currentState: string | null; // 現状
  pain: string | null; // 課題・痛み
  restriction: string | null; // 制約
  note: string | null; // メモ
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** あるべき姿・打ち手（TobeVision テーブル） */
export interface TobeVision {
  id: string;
  projectId: string;
  // 領域（SubProject マスタ）への紐づけ。データ連携の主役。未分類なら null。
  subProjectId: string | null;
  area: string | null; // 領域（フリーテキスト。後方互換のため残置）
  vision: string | null; // あるべき姿
  countermeasure: string | null; // 打ち手
  effect: string | null; // 期待効果
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 段階設計（TobeRoadmap テーブル） */
export interface TobeRoadmap {
  id: string;
  projectId: string;
  // 領域（SubProject マスタ）への紐づけ。未分類なら null。
  subProjectId: string | null;
  // 元になった あるべき姿・打ち手（TobeVision）への紐づけ。未選択なら null。
  tobeVisionId: string | null;
  phase: string | null; // フェーズ
  measure: string | null; // 打ち手
  roi: string | null; // ROI
  cost: string | null; // 実装コスト
  payback: string | null; // 回収期間
  scope: string | null; // スコープ判断
  order: number;
  createdAt?: string;
  updatedAt?: string;
}

/** 作成・更新で送る入力（すべて任意）。 */
export type AsisMemoInput = Partial<
  Omit<AsisMemo, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;
export type TobeVisionInput = Partial<
  Omit<TobeVision, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;
export type TobeRoadmapInput = Partial<
  Omit<TobeRoadmap, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
>;

// ---------------------------------------------------------------------------
// 汎用 CRUD ファクトリ
// ---------------------------------------------------------------------------

/**
 * /api/projects/:projectId/<listPath> (GET/POST) と
 * /api/<itemPath>/:id (PATCH/DELETE) を扱う CRUD クライアントを生成する。
 */
function makeApi<T, TInput>(
  listPath: string,
  itemPath: string,
  label: string,
) {
  return {
    async list(projectId: string): Promise<T[]> {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/${listPath}`,
        { headers: getHeaders() },
      );
      if (!res.ok) throw new Error(`${label}の読み込みに失敗しました`);
      return res.json();
    },
    async create(projectId: string, input: TInput): Promise<T> {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/${listPath}`,
        {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(input),
        },
      );
      if (!res.ok) throw new Error(`${label}の作成に失敗しました`);
      return res.json();
    },
    async update(id: string, input: TInput): Promise<T> {
      const res = await fetch(`${API_URL}/api/${itemPath}/${id}`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`${label}の更新に失敗しました`);
      return res.json();
    },
    async remove(id: string): Promise<void> {
      const res = await fetch(`${API_URL}/api/${itemPath}/${id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error(`${label}の削除に失敗しました`);
    },
  };
}

// ---------------------------------------------------------------------------
// API クライアント
// ---------------------------------------------------------------------------

export const asisMemoApi = makeApi<AsisMemo, AsisMemoInput>(
  'asis-memos',
  'asis-memos',
  '現状メモ',
);

export const tobeVisionApi = makeApi<TobeVision, TobeVisionInput>(
  'tobe-visions',
  'tobe-visions',
  'あるべき姿',
);

export const tobeRoadmapApi = makeApi<TobeRoadmap, TobeRoadmapInput>(
  'tobe-roadmaps',
  'tobe-roadmaps',
  '段階設計',
);
