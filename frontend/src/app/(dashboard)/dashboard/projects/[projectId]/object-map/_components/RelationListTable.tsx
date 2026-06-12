'use client';

/**
 * RelationListTable — リレーション一覧テーブル（キャンバス下の一覧ビュー）。
 *
 * source/target/カーディナリティは select で即保存、ラベルは blur/Enter で保存。
 * 最下行は追加行（source・target を選んで「追加」）。
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  RELATION_CARDINALITY_OPTIONS,
  type DataObjectDto,
  type ObjectRelationDto,
  type RelationCardinality,
} from '@/lib/data-objects';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';
import { CARDINALITY_STYLES } from './object-map-shared';

/** カーディナリティ列のソート用表示文字列（例: 「1対多（1:多）」） */
const CARDINALITY_SORT_LABELS: Record<RelationCardinality, string> = Object.fromEntries(
  RELATION_CARDINALITY_OPTIONS.map((opt) => [
    opt.value,
    `${opt.label}（${CARDINALITY_STYLES[opt.value].short}）`,
  ]),
) as Record<RelationCardinality, string>;

export interface RelationListTableProps {
  objects: DataObjectDto[];
  relations: ObjectRelationDto[];
  onCreate: (body: {
    sourceObjectId: string;
    targetObjectId: string;
    cardinality: RelationCardinality;
    label?: string | null;
  }) => void | Promise<void>;
  onUpdate: (
    id: string,
    patch: {
      sourceObjectId?: string;
      targetObjectId?: string;
      cardinality?: RelationCardinality;
      label?: string | null;
    },
  ) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
}

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-ring';
const labelInputClass =
  'h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm text-gray-800 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none';

function RelationRow({
  rel,
  objects,
  onUpdate,
  onDelete,
}: {
  rel: ObjectRelationDto;
  objects: DataObjectDto[];
  onUpdate: RelationListTableProps['onUpdate'];
  onDelete: RelationListTableProps['onDelete'];
}) {
  const [label, setLabel] = useState(rel.label ?? '');
  useEffect(() => setLabel(rel.label ?? ''), [rel.label]);

  const commitLabel = () => {
    const v = label.trim();
    if (v === (rel.label ?? '')) return;
    void onUpdate(rel.id, { label: v === '' ? null : v });
  };

  const style = CARDINALITY_STYLES[rel.cardinality];

  return (
    <tr className="border-b border-gray-100 last:border-0 hover:bg-blue-50/30">
      <td className="px-3 py-1.5">
        <select
          className={selectClass}
          value={rel.sourceObjectId}
          onChange={(e) => {
            if (e.target.value === rel.targetObjectId) return; // 自己参照は不可
            void onUpdate(rel.id, { sourceObjectId: e.target.value });
          }}
        >
          {objects.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === rel.targetObjectId}>
              {o.name}
            </option>
          ))}
        </select>
      </td>
      <td className="w-8 px-1 py-1.5 text-center">
        <ArrowRight className="mx-auto h-4 w-4 text-gray-300" />
      </td>
      <td className="px-3 py-1.5">
        <select
          className={selectClass}
          value={rel.targetObjectId}
          onChange={(e) => {
            if (e.target.value === rel.sourceObjectId) return;
            void onUpdate(rel.id, { targetObjectId: e.target.value });
          }}
        >
          {objects.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id === rel.sourceObjectId}>
              {o.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: style.color }} />
          <select
            className={selectClass}
            value={rel.cardinality}
            onChange={(e) =>
              void onUpdate(rel.id, { cardinality: e.target.value as RelationCardinality })
            }
          >
            {RELATION_CARDINALITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}（{CARDINALITY_STYLES[opt.value].short}）
              </option>
            ))}
          </select>
        </div>
      </td>
      <td className="px-3 py-1.5">
        <input
          className={labelInputClass}
          placeholder="ラベル..."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </td>
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
          title="関係線を削除"
          onClick={() => {
            if (!window.confirm('この関係線を削除しますか？')) return;
            void onDelete(rel.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

export function RelationListTable({
  objects,
  relations,
  onCreate,
  onUpdate,
  onDelete,
}: RelationListTableProps) {
  const [newSourceId, setNewSourceId] = useState('');
  const [newTargetId, setNewTargetId] = useState('');
  const [newCardinality, setNewCardinality] = useState<RelationCardinality>('ONE_TO_MANY');
  const [newLabel, setNewLabel] = useState('');

  // ヘッダークリックソート（表示名で比較。解除時は従来の並びに戻る）
  const objectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of objects) map.set(o.id, o.name);
    return map;
  }, [objects]);

  const accessors = useMemo(
    () => ({
      source: (rel: ObjectRelationDto) => objectNameById.get(rel.sourceObjectId) ?? '',
      target: (rel: ObjectRelationDto) => objectNameById.get(rel.targetObjectId) ?? '',
      cardinality: (rel: ObjectRelationDto) => CARDINALITY_SORT_LABELS[rel.cardinality],
      label: (rel: ObjectRelationDto) => rel.label ?? '',
    }),
    [objectNameById],
  );

  const { sorted: sortedRelations, sortKey, sortDir, toggleSort } = useTableSort(relations, accessors);

  const canAdd = newSourceId !== '' && newTargetId !== '' && newSourceId !== newTargetId;

  const handleAdd = () => {
    if (!canAdd) return;
    void onCreate({
      sourceObjectId: newSourceId,
      targetObjectId: newTargetId,
      cardinality: newCardinality,
      label: newLabel.trim() === '' ? null : newLabel.trim(),
    });
    setNewSourceId('');
    setNewTargetId('');
    setNewCardinality('ONE_TO_MANY');
    setNewLabel('');
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold text-gray-600">
            <SortableTh label="source" sortKey="source" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-48" />
            <th className="w-8 px-1 py-2" />
            <SortableTh label="target" sortKey="target" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-48" />
            <SortableTh label="カーディナリティ" sortKey="cardinality" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-44" />
            <SortableTh label="ラベル" sortKey="label" current={sortKey} dir={sortDir} onToggle={toggleSort} />
            <th className="w-12 px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {relations.length === 0 && (
            <tr className="border-b border-gray-100">
              <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-400">
                関係線がありません。下の追加行か、キャンバスの「関係線を追加」（2クリック接続）で追加できます。
              </td>
            </tr>
          )}
          {sortedRelations.map((rel) => (
            <RelationRow
              key={rel.id}
              rel={rel}
              objects={objects}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
          {/* 追加行 */}
          <tr className="bg-gray-50/50">
            <td className="px-3 py-1.5">
              <select
                className={selectClass}
                value={newSourceId}
                onChange={(e) => setNewSourceId(e.target.value)}
              >
                <option value="">source を選択...</option>
                {objects.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.id === newTargetId}>
                    {o.name}
                  </option>
                ))}
              </select>
            </td>
            <td className="w-8 px-1 py-1.5 text-center">
              <ArrowRight className="mx-auto h-4 w-4 text-gray-300" />
            </td>
            <td className="px-3 py-1.5">
              <select
                className={selectClass}
                value={newTargetId}
                onChange={(e) => setNewTargetId(e.target.value)}
              >
                <option value="">target を選択...</option>
                {objects.map((o) => (
                  <option key={o.id} value={o.id} disabled={o.id === newSourceId}>
                    {o.name}
                  </option>
                ))}
              </select>
            </td>
            <td className="px-3 py-1.5">
              <select
                className={selectClass}
                value={newCardinality}
                onChange={(e) => setNewCardinality(e.target.value as RelationCardinality)}
              >
                {RELATION_CARDINALITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}（{CARDINALITY_STYLES[opt.value].short}）
                  </option>
                ))}
              </select>
            </td>
            <td className="px-3 py-1.5">
              <input
                className={`${labelInputClass} border-gray-200`}
                placeholder="ラベル（任意）"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd();
                }}
              />
            </td>
            <td className="px-3 py-1.5 text-right">
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1 px-2 text-xs"
                disabled={!canAdd}
                onClick={handleAdd}
              >
                <Plus className="h-3.5 w-3.5" />
                追加
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
