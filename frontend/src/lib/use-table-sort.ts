// 一覧テーブル用の共有カラムソートフック。
//
// tasks ページのヘッダーソート（昇順 → 降順 → 解除）を汎用化したもの。
// - 比較: null / undefined / 空文字は方向に関わらず末尾、number は数値比較、
//   string は localeCompare('ja')。
// - 非破壊（元配列は変更しない）・安定ソート（同値は元の並びを保つ）。
// - sortKey が null のときは items をそのまま返す（手動順のまま）。
//
// 使い方:
//   const accessors = useMemo(() => ({ name: (r) => r.name, ... }), []);
//   const { sorted, sortKey, sortDir, toggleSort } = useTableSort(rows, accessors);
//   ※ accessors はレンダーごとに作り直さないよう useMemo かモジュール定数にする。

'use client';

import { useMemo, useState } from 'react';

export type TableSortDir = 'asc' | 'desc';

export interface UseTableSortResult<T> {
  /** ソート適用後の配列（sortKey が null なら items そのもの） */
  sorted: T[];
  /** 現在のソートキー（null = 未ソート/手動順） */
  sortKey: string | null;
  /** 現在のソート方向 */
  sortDir: TableSortDir;
  /** ヘッダクリック: 昇順 → 降順 → 解除 のトグル */
  toggleSort: (key: string) => void;
}

/** 未設定値（null / undefined / 空文字）か判定する。 */
function isEmpty(v: string | number | null | undefined): boolean {
  return v === null || v === undefined || v === '';
}

export function useTableSort<T>(
  items: T[],
  accessors: Record<string, (item: T) => string | number | null | undefined>
): UseTableSortResult<T> {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<TableSortDir>('asc');

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortKey(null);
      setSortDir('asc');
    }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return items;
    const accessor = accessors[sortKey];
    if (!accessor) return items;

    const sign = sortDir === 'asc' ? 1 : -1;

    // 値と元の位置を先に確定させ、安定ソート＋非破壊を保証する
    const decorated = items.map((item, index) => ({
      item,
      index,
      value: accessor(item),
    }));

    decorated.sort((a, b) => {
      const av = a.value;
      const bv = b.value;

      // 未設定値は方向に関わらず末尾
      const aEmpty = isEmpty(av);
      const bEmpty = isEmpty(bv);
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return a.index - b.index;
        return aEmpty ? 1 : -1;
      }

      let cmp: number;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv), 'ja');
      }
      if (cmp !== 0) return sign * cmp;
      return a.index - b.index; // 同値は元の並びを保つ
    });

    return decorated.map((d) => d.item);
  }, [items, accessors, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggleSort };
}
