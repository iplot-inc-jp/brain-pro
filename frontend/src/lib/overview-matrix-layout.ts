/**
 * overview-matrix-layout.ts — 俯瞰マトリクスの決定論的レンダープラン生成エンジン
 *
 * 設計原則:
 *   軸（行/列/第3軸）と各セルという「構造」を、HTML `<table>` の `<thead>`/`<tbody>` に
 *   セル結合（colSpan/rowSpan）込みで一意にマップできる「レンダープラン」へ純粋関数で
 *   変換する。React / DOM に一切依存しない（単体テスト可能）。セル結合の正しさは
 *   このプランで決まり切り、レンダラ側はプランを素直に <th>/<td> に流すだけになる。
 *
 * 軸の約束:
 *   - axisIndex 0 = 行（ROW）軸、1 = 列（COL）軸、任意の 2 = 第3軸（LAYER）。
 *   - 各軸の items は order 昇順に並ぶ（このエンジンが昇順ソートして使う）。
 *   - 第3軸は side: 'ROW' | 'COL' を持ち、結合方向を決める。
 *
 * モード:
 *   - '2-axis'      : 第3軸なし or 第3軸の項目数 0。単純グリッド（layerItemId=null）。
 *   - '3-axis-col'  : 第3軸 side='COL'。列見出し 2 段（列項目を colSpan、下段に第3軸項目）。
 *   - '3-axis-row'  : 第3軸 side='ROW'。行見出し 2 列（行項目を rowSpan、第3軸項目で副行展開）。
 *
 * 入力が空（軸なし / 項目なし）でも例外を投げず、空のプランを返す。
 */

import type {
  OverviewMatrixAxis,
  OverviewMatrixAxisItem,
  OverviewMatrixCell,
} from './overview-matrix';

// ===========================================
// 出力型
// ===========================================

/** レンダープランのモード。 */
export type MatrixLayoutMode = '2-axis' | '3-axis-col' | '3-axis-row';

/** ヘッダーセル（<th> 1 個分）の種類。 */
export type HeaderCellKind =
  | 'corner' // 左上の空白コーナー（行軸名を兼ねることもある）
  | 'rowAxisName' // 行軸名コーナー（3-axis-row で行見出しが 2 列のとき）
  | 'col' // 列軸の項目
  | 'layer'; // 第3軸の項目

/** ヘッダーセル 1 個（renderer が <th> に直接マップする）。 */
export interface HeaderCell {
  /** 表示ラベル。 */
  label: string;
  /** 横結合数（<th colSpan>）。最低 1。 */
  colSpan: number;
  /** 縦結合数（<th rowSpan>）。最低 1。 */
  rowSpan: number;
  /** セル種別（スタイリング/役割分け用）。 */
  kind: HeaderCellKind;
  /** 列軸項目に対応する場合その id（kind='col'）。それ以外 null。 */
  colItemId: string | null;
  /** 第3軸項目に対応する場合その id（kind='layer'）。それ以外 null。 */
  layerItemId: string | null;
}

/** ボディの 1 セル（<td> 1 個分）の論理座標。 */
export interface BodyCellRef {
  rowItemId: string;
  colItemId: string;
  /** 2-axis では null。3 軸では第3軸項目 id。 */
  layerItemId: string | null;
}

/** ボディの 1 行（<tr> 1 本分）。 */
export interface BodyRow {
  /** この行が属する行軸項目 id。 */
  rowItemId: string;
  /** 行見出しラベル。 */
  rowLabel: string;
  /**
   * 行見出し <th> の rowSpan。
   *   - 2-axis / 3-axis-col: 常に 1。
   *   - 3-axis-row: 各行項目の最初の副行のみ (#layer items)、続く副行は 0
   *     （= 行見出し <th> を描かない）。
   */
  rowSpanForRowHeader: number;
  /**
   * 3-axis-row のとき、この副行が表す第3軸項目（行見出しの 2 列目に出す）。
   * それ以外のモードでは null。
   */
  layerHeader: { layerItemId: string; label: string } | null;
  /** 左→右の描画順に並んだボディセル。 */
  cells: BodyCellRef[];
}

/** buildMatrixLayout の戻り値。 */
export interface MatrixLayout {
  mode: MatrixLayoutMode;
  /** 行軸名（左上コーナー等に出す）。軸が無ければ ''。 */
  rowAxisName: string;
  /** 列軸名。軸が無ければ ''。 */
  colAxisName: string;
  /** 第3軸名（3 軸時のみ意味を持つ）。無ければ ''。 */
  layerAxisName: string;
  /** ヘッダー行の配列（各行は左→右の HeaderCell 配列）。 */
  headerCells: HeaderCell[][];
  /** ボディ行の配列（描画順）。 */
  bodyRows: BodyRow[];
  /** (rowItemId, colItemId, layerItemId|null) に対応するセルを返す。無ければ undefined。 */
  cellAt: (
    rowItemId: string,
    colItemId: string,
    layerItemId?: string | null,
  ) => OverviewMatrixCell | undefined;
}

// ===========================================
// 内部ヘルパ
// ===========================================

const cellMapKey = (
  rowItemId: string,
  colItemId: string,
  layerItemId: string | null | undefined,
): string => `${rowItemId}|${colItemId}|${layerItemId ?? ''}`;

/** 軸を axisIndex で引く。 */
function axisByIndex(
  axes: OverviewMatrixAxis[],
  index: number,
): OverviewMatrixAxis | undefined {
  return axes.find((a) => a.axisIndex === index);
}

/** items を order 昇順（同値は入力順）で安定ソートしたコピーを返す。 */
function sortedItems(
  axis: OverviewMatrixAxis | undefined,
): OverviewMatrixAxisItem[] {
  if (!axis || !axis.items) return [];
  return axis.items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const oa = a.it.order ?? 0;
      const ob = b.it.order ?? 0;
      return oa !== ob ? oa - ob : a.i - b.i;
    })
    .map((e) => e.it);
}

// ===========================================
// メイン
// ===========================================

/**
 * 軸 + セルから HTML テーブルのレンダープランを構築する純粋関数。
 *
 * @param axes  axisIndex 0=行 / 1=列 / 任意 2=第3軸。items は order 昇順に整列して使う。
 * @param cells セル配列（順不同で可。cellAt は内部 Map で O(1) 参照）。
 * @returns セル結合込みの {@link MatrixLayout}。
 */
export function buildMatrixLayout(
  axes: OverviewMatrixAxis[],
  cells: OverviewMatrixCell[],
): MatrixLayout {
  const safeAxes = Array.isArray(axes) ? axes : [];
  const safeCells = Array.isArray(cells) ? cells : [];

  // --- セル参照 Map ---
  const cellMap = new Map<string, OverviewMatrixCell>();
  for (const c of safeCells) {
    cellMap.set(cellMapKey(c.rowItemId, c.colItemId, c.layerItemId), c);
  }
  const cellAt = (
    rowItemId: string,
    colItemId: string,
    layerItemId?: string | null,
  ): OverviewMatrixCell | undefined =>
    cellMap.get(cellMapKey(rowItemId, colItemId, layerItemId));

  // --- 軸の解決 ---
  const rowAxis = axisByIndex(safeAxes, 0);
  const colAxis = axisByIndex(safeAxes, 1);
  const layerAxis = axisByIndex(safeAxes, 2);

  const rowItems = sortedItems(rowAxis);
  const colItems = sortedItems(colAxis);
  const layerItems = sortedItems(layerAxis);

  const rowAxisName = rowAxis?.name ?? '';
  const colAxisName = colAxis?.name ?? '';
  const layerAxisName = layerAxis?.name ?? '';

  // --- モード判定 ---
  // 第3軸が存在し、かつ項目が 1 個以上あるときだけ 3 軸。
  const hasLayer = !!layerAxis && layerItems.length > 0;
  const mode: MatrixLayoutMode = !hasLayer
    ? '2-axis'
    : (layerAxis!.side ?? 'COL') === 'ROW'
      ? '3-axis-row'
      : '3-axis-col';

  // 共通の空プランの組み立て関数。
  const base = (
    headerCells: HeaderCell[][],
    bodyRows: BodyRow[],
  ): MatrixLayout => ({
    mode,
    rowAxisName,
    colAxisName,
    layerAxisName,
    headerCells,
    bodyRows,
    cellAt,
  });

  // =========================================================================
  // 2-axis
  //   ヘッダー: 1 行（コーナー + 各列項目）。
  //   ボディ:   行項目ごとに 1 行、列項目ごとに 1 セル（layerItemId=null）。
  // =========================================================================
  if (mode === '2-axis') {
    const headerRow: HeaderCell[] = [
      {
        label: rowAxisName,
        colSpan: 1,
        rowSpan: 1,
        kind: 'corner',
        colItemId: null,
        layerItemId: null,
      },
      ...colItems.map<HeaderCell>((col) => ({
        label: col.label,
        colSpan: 1,
        rowSpan: 1,
        kind: 'col',
        colItemId: col.id,
        layerItemId: null,
      })),
    ];

    const bodyRows: BodyRow[] = rowItems.map((row) => ({
      rowItemId: row.id,
      rowLabel: row.label,
      rowSpanForRowHeader: 1,
      layerHeader: null,
      cells: colItems.map<BodyCellRef>((col) => ({
        rowItemId: row.id,
        colItemId: col.id,
        layerItemId: null,
      })),
    }));

    return base([headerRow], bodyRows);
  }

  // =========================================================================
  // 3-axis-col （第3軸 side='COL'）
  //   ヘッダー 1 段目: コーナー(rowSpan=2) + 各列項目(colSpan=#layer)。
  //   ヘッダー 2 段目: 各列項目の下に第3軸項目を繰り返す。
  //   ボディ: 行項目ごとに 1 行、列項目 × 第3軸項目 のセル。
  // =========================================================================
  if (mode === '3-axis-col') {
    const layerCount = layerItems.length;

    const topRow: HeaderCell[] = [
      {
        label: rowAxisName,
        colSpan: 1,
        rowSpan: 2, // 2 段ヘッダーをまたぐコーナー。
        kind: 'corner',
        colItemId: null,
        layerItemId: null,
      },
      ...colItems.map<HeaderCell>((col) => ({
        label: col.label,
        colSpan: layerCount,
        rowSpan: 1,
        kind: 'col',
        colItemId: col.id,
        layerItemId: null,
      })),
    ];

    const bottomRow: HeaderCell[] = [];
    for (const col of colItems) {
      for (const layer of layerItems) {
        bottomRow.push({
          label: layer.label,
          colSpan: 1,
          rowSpan: 1,
          kind: 'layer',
          colItemId: col.id,
          layerItemId: layer.id,
        });
      }
    }

    const bodyRows: BodyRow[] = rowItems.map((row) => {
      const cellsForRow: BodyCellRef[] = [];
      for (const col of colItems) {
        for (const layer of layerItems) {
          cellsForRow.push({
            rowItemId: row.id,
            colItemId: col.id,
            layerItemId: layer.id,
          });
        }
      }
      return {
        rowItemId: row.id,
        rowLabel: row.label,
        rowSpanForRowHeader: 1,
        layerHeader: null,
        cells: cellsForRow,
      };
    });

    return base([topRow, bottomRow], bodyRows);
  }

  // =========================================================================
  // 3-axis-row （第3軸 side='ROW'）
  //   ヘッダー 1 段: 行軸名(corner) + 第3軸名(rowAxisName 2 列目相当) + 各列項目。
  //   ボディ: 行項目 × 第3軸項目 ぶんの <tr>。各行項目の最初の副行だけ
  //           行見出し <th> を rowSpan=#layer で出し、続く副行は出さない（rowSpan=0）。
  //           各副行は第3軸項目を 2 列目に持ち、列項目ごとにセルを並べる。
  // =========================================================================
  // mode === '3-axis-row'
  const layerCount = layerItems.length;

  // 行見出しは 2 列（行軸名 + 第3軸名）を占める。コーナーは行軸名を colSpan=2 で覆う。
  const headerRow: HeaderCell[] = [
    {
      label: rowAxisName,
      colSpan: 1,
      rowSpan: 1,
      kind: 'corner',
      colItemId: null,
      layerItemId: null,
    },
    {
      label: layerAxisName,
      colSpan: 1,
      rowSpan: 1,
      kind: 'rowAxisName',
      colItemId: null,
      layerItemId: null,
    },
    ...colItems.map<HeaderCell>((col) => ({
      label: col.label,
      colSpan: 1,
      rowSpan: 1,
      kind: 'col',
      colItemId: col.id,
      layerItemId: null,
    })),
  ];

  const bodyRows: BodyRow[] = [];
  for (const row of rowItems) {
    layerItems.forEach((layer, layerIdx) => {
      bodyRows.push({
        rowItemId: row.id,
        rowLabel: row.label,
        // 行項目の最初の副行だけ行見出しを rowSpan=#layer で描く。続きは 0（描かない）。
        rowSpanForRowHeader: layerIdx === 0 ? layerCount : 0,
        layerHeader: { layerItemId: layer.id, label: layer.label },
        cells: colItems.map<BodyCellRef>((col) => ({
          rowItemId: row.id,
          colItemId: col.id,
          layerItemId: layer.id,
        })),
      });
    });
  }

  return base([headerRow], bodyRows);
}
