// 俯瞰思考（俯瞰資料図ビルダー）用の型・APIヘルパー。
//
// 汎用 N 軸マトリクス（v1 は最大 3 軸）を専用テーブル
// OverviewMatrix / OverviewMatrixAxis / OverviewMatrixAxisItem / OverviewMatrixCell
// に対して replace-all（$transaction 全置換）で保存する。
// 既存ページと同じく API_URL + /api への raw fetch（localStorage の accessToken）を使う。

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

/** セル値モード（表ごと）。TEXT=自由本文 / TAGS=タグ選択 / SYMBOL=記号。 */
export type CellMode = 'TEXT' | 'TAGS' | 'SYMBOL';

/** 第3軸の結合方向。ROW=行見出し側 / COL=列見出し側。 */
export type AxisSide = 'ROW' | 'COL';

/** TAGS/SYMBOL モード用の選択肢定義。 */
export interface TagOption {
  key: string;
  label: string;
  color?: string;
}

/** 一覧 API（GET projects/:projectId/overview-matrices）の 1 件。 */
export interface OverviewMatrixSummary {
  id: string;
  name: string;
  purpose: string | null;
  cellMode: CellMode;
  axisCount: number;
  updatedAt: string;
}

/** スナップショット内のマトリクス本体（メタ情報）。 */
export interface OverviewMatrix {
  id: string;
  projectId: string;
  name: string;
  purpose: string | null;
  cellMode: CellMode;
  tagOptions: TagOption[] | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** 軸項目（行/列/第3軸の 1 項目）。cells はこの id を参照する。 */
export interface OverviewMatrixAxisItem {
  id: string;
  label: string;
  order: number;
  sourceType: string; // FREE|ROLE|DATA_OBJECT|TABLE|SYSTEM|STATUS
  sourceId: string | null;
}

/** 軸定義。axisIndex 0=行 / 1=列 / 2=第3軸。 */
export interface OverviewMatrixAxis {
  id: string;
  axisIndex: number;
  name: string;
  side: AxisSide;
  items: OverviewMatrixAxisItem[];
}

/** セル（行項目 × 列項目 [× 第3軸項目]）。 */
export interface OverviewMatrixCell {
  // バックエンドのスナップショットは id を返さないため任意。
  id?: string;
  rowItemId: string;
  colItemId: string;
  layerItemId: string | null;
  value: string | null;
  note: string | null;
  isApplicable: boolean;
  reason: string | null;
}

/** GET :matrixId / POST / PUT / PATCH が返すスナップショット。 */
export interface OverviewMatrixSnapshot {
  matrix: OverviewMatrix;
  axes: OverviewMatrixAxis[];
  cells: OverviewMatrixCell[];
}

// ---- 書き込みペイロード ----------------------------------------------------

/** PUT（replace-all）で送る軸項目。id はクライアント採番（cells が参照）。 */
export interface OverviewMatrixAxisItemInput {
  id?: string;
  label: string;
  order?: number;
  sourceType?: string;
  sourceId?: string | null;
}

/** PUT で送る軸定義。 */
export interface OverviewMatrixAxisInput {
  axisIndex: number;
  name: string;
  side?: AxisSide;
  items: OverviewMatrixAxisItemInput[];
}

/** PUT で送るセル。 */
export interface OverviewMatrixCellInput {
  rowItemId: string;
  colItemId: string;
  layerItemId?: string | null;
  value?: string | null;
  note?: string | null;
  isApplicable?: boolean;
  reason?: string | null;
}

/** PUT（replace-all）の全置換ペイロード。 */
export interface ReplaceOverviewMatrixPayload {
  name?: string;
  purpose?: string | null;
  cellMode?: CellMode;
  tagOptions?: TagOption[] | null;
  axes: OverviewMatrixAxisInput[];
  cells: OverviewMatrixCellInput[];
}

/** PATCH（メタ更新）のパッチ。 */
export interface PatchOverviewMatrixPayload {
  name?: string;
  purpose?: string | null;
  cellMode?: CellMode;
  tagOptions?: TagOption[] | null;
}

// ---------------------------------------------------------------------------
// 俯瞰マトリクス API
// ---------------------------------------------------------------------------

export const overviewMatrixApi = {
  /** プロジェクトの俯瞰マトリクス一覧。 */
  async list(projectId: string): Promise<OverviewMatrixSummary[]> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/overview-matrices`,
      { headers: getHeaders() },
    );
    if (!res.ok) throw new Error('俯瞰マトリクス一覧の読み込みに失敗しました');
    return res.json();
  },

  /** 新規作成（2軸の空ひな形を生成）→ スナップショットを返す。 */
  async create(
    projectId: string,
    input: { name: string; purpose?: string | null },
  ): Promise<OverviewMatrixSnapshot> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/overview-matrices`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(input),
      },
    );
    if (!res.ok) throw new Error('俯瞰マトリクスの作成に失敗しました');
    return res.json();
  },

  /** スナップショット取得。 */
  async get(matrixId: string): Promise<OverviewMatrixSnapshot> {
    const res = await fetch(
      `${API_URL}/api/overview-matrices/${matrixId}`,
      { headers: getHeaders() },
    );
    if (!res.ok) throw new Error('俯瞰マトリクスの読み込みに失敗しました');
    return res.json();
  },

  /** 一括置換（axes+items+cells を全削除→再作成）→ スナップショットを返す。 */
  async replace(
    matrixId: string,
    payload: ReplaceOverviewMatrixPayload,
  ): Promise<OverviewMatrixSnapshot> {
    const res = await fetch(
      `${API_URL}/api/overview-matrices/${matrixId}`,
      {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw new Error('俯瞰マトリクスの保存に失敗しました');
    return res.json();
  },

  /** メタ更新（name/purpose/cellMode/tagOptions）→ スナップショットを返す。 */
  async update(
    matrixId: string,
    patch: PatchOverviewMatrixPayload,
  ): Promise<OverviewMatrixSnapshot> {
    const res = await fetch(
      `${API_URL}/api/overview-matrices/${matrixId}`,
      {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(patch),
      },
    );
    if (!res.ok) throw new Error('俯瞰マトリクスの更新に失敗しました');
    return res.json();
  },

  /** 削除（cascade）。 */
  async remove(matrixId: string): Promise<void> {
    const res = await fetch(
      `${API_URL}/api/overview-matrices/${matrixId}`,
      {
        method: 'DELETE',
        headers: getHeaders(),
      },
    );
    if (!res.ok) throw new Error('俯瞰マトリクスの削除に失敗しました');
  },
};
