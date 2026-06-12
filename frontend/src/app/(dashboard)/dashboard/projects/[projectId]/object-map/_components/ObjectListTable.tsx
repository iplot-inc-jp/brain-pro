'use client';

/**
 * ObjectListTable — オブジェクト一覧テーブル（キャンバス下の一覧ビュー）。
 *
 * 名前/説明はインライン編集（blur/Enterで保存）、色はスウォッチクリックで保存。
 * 紐づくテーブル・DFDデータストアはチップ表示（title に名称一覧）。行クリックで選択。
 * 名前/説明/紐づき（件数）はヘッダークリックでソート（昇順 → 降順 → 解除で元の並び）。
 */

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { DataObjectDto } from '@/lib/data-objects';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';
import { OBJECT_COLORS, objectColor } from './object-map-shared';

export interface ObjectListTableProps {
  objects: DataObjectDto[];
  selectedObjectId: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (
    id: string,
    patch: { name?: string; description?: string | null; color?: string | null },
  ) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

// ヘッダーソート用 accessor（色・操作列はソート対象外）。
// 紐づきは件数基準（テーブル数 + DFD数）で比較する。
const SORT_ACCESSORS: Record<string, (o: DataObjectDto) => string | number | null | undefined> = {
  name: (o) => o.name,
  description: (o) => o.description ?? '',
  links: (o) => o.tables.length + o.dfdNodes.length,
};

const cellInput =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-gray-800 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none';

function ObjectRow({
  obj,
  selected,
  onSelect,
  onUpdate,
  onDelete,
}: {
  obj: DataObjectDto;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onUpdate: ObjectListTableProps['onUpdate'];
  onDelete: ObjectListTableProps['onDelete'];
}) {
  const [name, setName] = useState(obj.name);
  const [description, setDescription] = useState(obj.description ?? '');

  useEffect(() => {
    setName(obj.name);
    setDescription(obj.description ?? '');
  }, [obj.name, obj.description]);

  const commitName = () => {
    const v = name.trim();
    if (v === '' || v === obj.name) {
      setName(obj.name);
      return;
    }
    void onUpdate(obj.id, { name: v });
  };

  const commitDescription = () => {
    const v = description.trim();
    if (v === (obj.description ?? '')) return;
    void onUpdate(obj.id, { description: v === '' ? null : v });
  };

  const color = objectColor(obj.color);
  const tableNames = obj.tables.map((t) => t.displayName ?? t.name).join('、');
  const dfdLabels = obj.dfdNodes.map((n) => n.label).join('、');

  return (
    <tr
      className={`border-b border-gray-100 last:border-0 ${
        selected ? 'bg-blue-50/60' : 'hover:bg-blue-50/30'
      }`}
      onClick={() => onSelect(obj.id)}
    >
      <td className="px-3 py-1.5">
        <input
          className={`${cellInput} font-medium`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="px-3 py-1.5">
        <input
          className={cellInput}
          placeholder="説明..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {OBJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="rounded-full border-2"
              style={{
                background: c,
                width: 18,
                height: 18,
                borderColor: c === color ? '#0f172a' : 'transparent',
              }}
              title={c}
              onClick={() => void onUpdate(obj.id, { color: c })}
            />
          ))}
        </div>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <span
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600"
            title={tableNames || '紐づくテーブルなし'}
          >
            テーブル {obj.tables.length}
          </span>
          {obj.dfdNodes.length > 0 && (
            <span
              className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
              title={dfdLabels}
            >
              DFD {obj.dfdNodes.length}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
          title="オブジェクトを削除"
          onClick={(e) => {
            e.stopPropagation();
            if (!window.confirm(`オブジェクト「${obj.name}」を削除しますか？`)) return;
            void onDelete(obj.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

export function ObjectListTable({
  objects,
  selectedObjectId,
  onSelect,
  onUpdate,
  onDelete,
}: ObjectListTableProps) {
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(objects, SORT_ACCESSORS);

  if (objects.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white py-10 text-center text-sm text-gray-400">
        オブジェクトがありません。
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
            <SortableTh
              label="名前"
              sortKey="name"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className="w-48"
            />
            <SortableTh
              label="説明"
              sortKey="description"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
            />
            <th className="w-48 px-3 py-2">色</th>
            <SortableTh
              label="紐づき"
              sortKey="links"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className="w-44"
            />
            <th className="w-12 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => (
            <ObjectRow
              key={o.id}
              obj={o}
              selected={o.id === selectedObjectId}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
