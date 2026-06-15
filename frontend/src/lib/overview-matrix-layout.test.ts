import { describe, it, expect } from 'vitest';
import { buildMatrixLayout } from './overview-matrix-layout';
import type {
  OverviewMatrixAxis,
  OverviewMatrixAxisItem,
  OverviewMatrixCell,
} from './overview-matrix';

// --- 小さなビルダー ---------------------------------------------------------

function item(id: string, label: string, order = 0): OverviewMatrixAxisItem {
  return { id, label, order, sourceType: 'FREE', sourceId: null };
}

function axis(
  axisIndex: number,
  name: string,
  side: 'ROW' | 'COL',
  items: OverviewMatrixAxisItem[],
): OverviewMatrixAxis {
  return { id: `axis-${axisIndex}`, axisIndex, name, side, items };
}

function cell(
  rowItemId: string,
  colItemId: string,
  layerItemId: string | null,
  value: string | null = null,
): OverviewMatrixCell {
  return {
    rowItemId,
    colItemId,
    layerItemId,
    value,
    note: null,
    isApplicable: true,
    reason: null,
  };
}

// 2 行 (r1,r2) × 2 列 (c1,c2) の軸セット。
const rowAxis2 = axis(0, '行軸', 'ROW', [item('r1', '行1', 0), item('r2', '行2', 1)]);
const colAxis2 = axis(1, '列軸', 'COL', [item('c1', '列1', 0), item('c2', '列2', 1)]);

// =============================================================================
describe('buildMatrixLayout — 2-axis', () => {
  const cells: OverviewMatrixCell[] = [
    cell('r1', 'c1', null, 'A'),
    cell('r1', 'c2', null, 'B'),
    cell('r2', 'c1', null, 'C'),
    cell('r2', 'c2', null, 'D'),
  ];
  const layout = buildMatrixLayout([rowAxis2, colAxis2], cells);

  it('モードは 2-axis', () => {
    expect(layout.mode).toBe('2-axis');
  });

  it('ヘッダーは 1 行で コーナー + 列項目', () => {
    expect(layout.headerCells).toHaveLength(1);
    const header = layout.headerCells[0];
    expect(header).toHaveLength(3); // corner + 2 cols
    expect(header[0].kind).toBe('corner');
    expect(header[0].label).toBe('行軸');
    expect(header.slice(1).map((h) => h.kind)).toEqual(['col', 'col']);
    expect(header.slice(1).map((h) => h.label)).toEqual(['列1', '列2']);
    // 2-axis ヘッダーは結合なし。
    expect(header.every((h) => h.colSpan === 1 && h.rowSpan === 1)).toBe(true);
  });

  it('ボディは行項目ごとに 1 行、各行は列ぶんのセル（layerItemId=null）', () => {
    expect(layout.bodyRows).toHaveLength(2);
    const first = layout.bodyRows[0];
    expect(first.rowItemId).toBe('r1');
    expect(first.rowLabel).toBe('行1');
    expect(first.rowSpanForRowHeader).toBe(1);
    expect(first.layerHeader).toBeNull();
    expect(first.cells).toEqual([
      { rowItemId: 'r1', colItemId: 'c1', layerItemId: null },
      { rowItemId: 'r1', colItemId: 'c2', layerItemId: null },
    ]);
  });

  it('cellAt はヒット/ミスを正しく返す', () => {
    expect(layout.cellAt('r1', 'c1', null)?.value).toBe('A');
    expect(layout.cellAt('r2', 'c2')?.value).toBe('D'); // layer 省略 = null
    expect(layout.cellAt('r1', 'c9', null)).toBeUndefined();
    expect(layout.cellAt('r1', 'c1', 'nope')).toBeUndefined();
  });
});

// =============================================================================
describe('buildMatrixLayout — 3-axis-col (side=COL)', () => {
  // 第3軸: 3 項目 (l1,l2,l3)。
  const layerAxis = axis(2, '第3軸', 'COL', [
    item('l1', 'L1', 0),
    item('l2', 'L2', 1),
    item('l3', 'L3', 2),
  ]);
  const layout = buildMatrixLayout([rowAxis2, colAxis2, layerAxis], []);

  it('モードは 3-axis-col', () => {
    expect(layout.mode).toBe('3-axis-col');
  });

  it('ヘッダーは 2 段', () => {
    expect(layout.headerCells).toHaveLength(2);
  });

  it('1 段目: コーナー(rowSpan=2) + 各列項目(colSpan=第3軸項目数)', () => {
    const top = layout.headerCells[0];
    expect(top[0].kind).toBe('corner');
    expect(top[0].rowSpan).toBe(2);
    const cols = top.slice(1);
    expect(cols).toHaveLength(2);
    expect(cols.every((c) => c.colSpan === 3 && c.kind === 'col')).toBe(true);
  });

  it('2 段目: 各列項目の下に第3軸項目を繰り返す', () => {
    const bottom = layout.headerCells[1];
    // 2 列 × 3 layer = 6 セル。
    expect(bottom).toHaveLength(6);
    expect(bottom.every((c) => c.kind === 'layer')).toBe(true);
    expect(bottom.map((c) => c.label)).toEqual([
      'L1', 'L2', 'L3', 'L1', 'L2', 'L3',
    ]);
    // 最初の 3 つは c1 配下、次の 3 つは c2 配下。
    expect(bottom.slice(0, 3).every((c) => c.colItemId === 'c1')).toBe(true);
    expect(bottom.slice(3, 6).every((c) => c.colItemId === 'c2')).toBe(true);
  });

  it('ボディ: 行ぶんの <tr>、セル数 = 列 × 第3軸', () => {
    expect(layout.bodyRows).toHaveLength(2); // 行 2
    const totalCells = layout.bodyRows.reduce((n, r) => n + r.cells.length, 0);
    // rows(2) × cols(2) × layers(3) = 12
    expect(totalCells).toBe(12);
    // 各行は cols×layers = 6 セル。
    expect(layout.bodyRows[0].cells).toHaveLength(6);
    expect(layout.bodyRows[0].cells[0]).toEqual({
      rowItemId: 'r1', colItemId: 'c1', layerItemId: 'l1',
    });
    expect(layout.bodyRows[0].rowSpanForRowHeader).toBe(1);
  });

  it('cellAt は第3軸込みで参照', () => {
    const layout2 = buildMatrixLayout(
      [rowAxis2, colAxis2, layerAxis],
      [cell('r2', 'c2', 'l3', 'XYZ')],
    );
    expect(layout2.cellAt('r2', 'c2', 'l3')?.value).toBe('XYZ');
    expect(layout2.cellAt('r2', 'c2', 'l1')).toBeUndefined();
  });
});

// =============================================================================
describe('buildMatrixLayout — 3-axis-row (side=ROW)', () => {
  // 第3軸: 2 項目 (l1,l2)。
  const layerAxis = axis(2, '第3軸', 'ROW', [
    item('l1', 'L1', 0),
    item('l2', 'L2', 1),
  ]);
  const layout = buildMatrixLayout([rowAxis2, colAxis2, layerAxis], []);

  it('モードは 3-axis-row', () => {
    expect(layout.mode).toBe('3-axis-row');
  });

  it('ヘッダーは 1 行で コーナー + 第3軸名 + 列項目', () => {
    expect(layout.headerCells).toHaveLength(1);
    const header = layout.headerCells[0];
    expect(header[0].kind).toBe('corner');
    expect(header[1].kind).toBe('rowAxisName');
    expect(header[1].label).toBe('第3軸');
    expect(header.slice(2).map((h) => h.kind)).toEqual(['col', 'col']);
  });

  it('ボディ行数 = 行項目 × 第3軸項目', () => {
    // rows(2) × layers(2) = 4 行。
    expect(layout.bodyRows).toHaveLength(4);
  });

  it('行見出しは各行項目の最初の副行のみ rowSpan=第3軸項目数、続きは 0', () => {
    const spans = layout.bodyRows.map((r) => r.rowSpanForRowHeader);
    expect(spans).toEqual([2, 0, 2, 0]);
    // r1 の 2 副行 + r2 の 2 副行。
    expect(layout.bodyRows.map((r) => r.rowItemId)).toEqual([
      'r1', 'r1', 'r2', 'r2',
    ]);
  });

  it('各副行は layerHeader を持ち、列ぶんのセル（第3軸込み）を持つ', () => {
    const first = layout.bodyRows[0];
    expect(first.layerHeader).toEqual({ layerItemId: 'l1', label: 'L1' });
    expect(first.cells).toEqual([
      { rowItemId: 'r1', colItemId: 'c1', layerItemId: 'l1' },
      { rowItemId: 'r1', colItemId: 'c2', layerItemId: 'l1' },
    ]);
    expect(layout.bodyRows[1].layerHeader).toEqual({
      layerItemId: 'l2', label: 'L2',
    });
  });

  it('ボディ総セル数 = 行 × 第3軸 × 列', () => {
    const total = layout.bodyRows.reduce((n, r) => n + r.cells.length, 0);
    // 2 × 2 × 2 = 8
    expect(total).toBe(8);
  });
});

// =============================================================================
describe('buildMatrixLayout — 第3軸が項目0なら 2-axis にフォールバック', () => {
  it('side=COL でも items 空なら 2-axis', () => {
    const emptyLayer = axis(2, '第3軸', 'COL', []);
    const layout = buildMatrixLayout([rowAxis2, colAxis2, emptyLayer], []);
    expect(layout.mode).toBe('2-axis');
    expect(layout.headerCells).toHaveLength(1);
    expect(layout.bodyRows[0].cells).toHaveLength(2);
  });
});

// =============================================================================
describe('buildMatrixLayout — order 昇順で整列', () => {
  it('items は order に従って並ぶ（入力順に依らない）', () => {
    const rows = axis(0, '行', 'ROW', [item('r2', '行2', 1), item('r1', '行1', 0)]);
    const cols = axis(1, '列', 'COL', [item('c2', '列2', 1), item('c1', '列1', 0)]);
    const layout = buildMatrixLayout([rows, cols], []);
    expect(layout.bodyRows.map((r) => r.rowItemId)).toEqual(['r1', 'r2']);
    expect(layout.headerCells[0].slice(1).map((h) => h.colItemId)).toEqual([
      'c1', 'c2',
    ]);
  });
});

// =============================================================================
describe('buildMatrixLayout — 空入力エッジ（例外を投げない）', () => {
  it('軸なし', () => {
    const layout = buildMatrixLayout([], []);
    expect(layout.mode).toBe('2-axis');
    expect(layout.headerCells).toHaveLength(1);
    // コーナーのみ。
    expect(layout.headerCells[0]).toHaveLength(1);
    expect(layout.headerCells[0][0].kind).toBe('corner');
    expect(layout.bodyRows).toHaveLength(0);
    expect(layout.rowAxisName).toBe('');
    expect(layout.colAxisName).toBe('');
  });

  it('行軸だけ（列項目なし）', () => {
    const layout = buildMatrixLayout([rowAxis2], []);
    expect(layout.mode).toBe('2-axis');
    // 行 2 つ、各行はセル 0。
    expect(layout.bodyRows).toHaveLength(2);
    expect(layout.bodyRows[0].cells).toHaveLength(0);
  });

  it('cellAt は空でも undefined を返す（throw しない）', () => {
    const layout = buildMatrixLayout([], []);
    expect(layout.cellAt('x', 'y', 'z')).toBeUndefined();
    expect(layout.cellAt('x', 'y')).toBeUndefined();
  });

  it('undefined を渡しても落ちない（防御的）', () => {
    // @ts-expect-error 故意に不正入力
    const layout = buildMatrixLayout(undefined, undefined);
    expect(layout.mode).toBe('2-axis');
    expect(layout.bodyRows).toHaveLength(0);
  });
});
