// ソート可能なテーブルヘッダセル（<th>）。
//
// useTableSort（@/lib/use-table-sort）と組み合わせて使う共有コンポーネント。
// tasks ページのヘッダーソート UI を汎用化したもの:
// - 選択中: ArrowUp / ArrowDown（青）、未選択: ArrowUpDown（半透明）
// - title 属性で次の動作を案内（昇順 → 降順 → 解除）
//
// 使い方:
//   <SortableTh label="名前" sortKey="name" current={sortKey} dir={sortDir}
//     onToggle={toggleSort} className="w-[150px]" />

'use client';

import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableSortDir } from '@/lib/use-table-sort';

export interface SortableThProps {
  /** ヘッダに表示するラベル */
  label: string;
  /** この列のソートキー */
  sortKey: string;
  /** 現在選択中のソートキー（null = 未ソート） */
  current: string | null;
  /** 現在のソート方向 */
  dir: TableSortDir;
  /** ヘッダクリック時に呼ぶトグル（useTableSort の toggleSort） */
  onToggle: (key: string) => void;
  /** <th> に付与する追加クラス（幅指定など） */
  className?: string;
  /** ラベル右に表示する追加要素（HelpTooltip など。ソートボタンの外側に置く） */
  children?: ReactNode;
}

export function SortableTh({
  label,
  sortKey: k,
  current,
  dir,
  onToggle,
  className,
  children,
}: SortableThProps) {
  const active = current === k;
  return (
    <th
      className={cn('px-3 py-2', className)}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onToggle(k)}
          className="inline-flex items-center gap-1 hover:text-gray-800"
          title={
            active
              ? dir === 'asc'
                ? '降順に切り替え'
                : 'ソート解除（手動順に戻す）'
              : `${label}で昇順ソート`
          }
        >
          {label}
          {active ? (
            dir === 'asc' ? (
              <ArrowUp className="h-3 w-3 text-blue-600" />
            ) : (
              <ArrowDown className="h-3 w-3 text-blue-600" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-40" />
          )}
        </button>
        {children}
      </span>
    </th>
  );
}
