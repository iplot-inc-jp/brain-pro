'use client';

/**
 * ObjectDetailPanel — オブジェクト選択時の右サイドパネル。
 *
 * - 名前/説明（blurで保存）・色（クリックで保存）の詳細編集
 * - 所属テーブル: 紐づくテーブル一覧（外す= dataObjectId:null）＋
 *   プロジェクトの全テーブルから select で追加（= LinkTableToObject）
 * - 紐づくDFDデータストア（読み取り専用チップ）
 * - ER図ページへのリンク
 * - オブジェクト削除
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, Table2, Trash2, Database, Share2, ExternalLink, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Table } from '@/lib/api';
import type { DataObjectDto } from '@/lib/data-objects';
import { OBJECT_COLORS, objectColor } from './object-map-shared';
import { NodeInspectorPanel } from '@/components/diagram/NodeInspectorPanel';

export interface ObjectDetailPanelProps {
  object: DataObjectDto;
  projectId: string;
  /** プロジェクトの全テーブル（カタログ） */
  allTables: Table[];
  /** テーブルID → 紐づいているオブジェクト名（他オブジェクト所属の表示用） */
  tableLinkMap: Map<string, { objectId: string; objectName: string }>;
  onClose: () => void;
  onUpdate: (id: string, patch: { name?: string; description?: string | null; color?: string | null }) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  /** dataObjectId=null で解除 */
  onLinkTable: (tableId: string, dataObjectId: string | null) => void | Promise<void>;
}

export function ObjectDetailPanel({
  object,
  projectId,
  allTables,
  tableLinkMap,
  onClose,
  onUpdate,
  onDelete,
  onLinkTable,
}: ObjectDetailPanelProps) {
  const [name, setName] = useState(object.name);
  const [description, setDescription] = useState(object.description ?? '');
  const [showInspector, setShowInspector] = useState(false);

  // 別オブジェクトに切り替わったらフォームを引き直し、インスペクタを閉じる
  useEffect(() => {
    setName(object.name);
    setDescription(object.description ?? '');
    setShowInspector(false);
  }, [object.id, object.name, object.description]);

  const commitName = () => {
    const v = name.trim();
    if (v === '' || v === object.name) {
      setName(object.name);
      return;
    }
    void onUpdate(object.id, { name: v });
  };

  const commitDescription = () => {
    const v = description.trim();
    if (v === (object.description ?? '')) return;
    void onUpdate(object.id, { description: v === '' ? null : v });
  };

  const linkedIds = new Set(object.tables.map((t) => t.id));
  const candidates = allTables.filter((t) => !linkedIds.has(t.id));
  const color = objectColor(object.color);

  // NodeInspectorPanel を表示中はそちらを優先表示（同一エリアで衝突しないようにトグル）
  if (showInspector) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col rounded-lg border border-gray-200 bg-white overflow-hidden">
        <NodeInspectorPanel
          projectId={projectId}
          nodeKind="DATA_OBJECT"
          nodeId={object.id}
          nodeLabel={object.name}
          onClose={() => setShowInspector(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white">
      {/* ヘッダー */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
          <h3 className="truncate text-sm font-semibold text-gray-800">{object.name}</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="添付・ナレッジグラフを開く"
            onClick={() => setShowInspector(true)}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <button type="button" className="text-gray-400 hover:text-gray-600" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 px-4 py-4">
        {/* 名前 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">名前</label>
          <Input
            className="h-9 text-sm"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        </div>

        {/* 説明 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">説明</label>
          <Textarea
            className="min-h-[72px] text-sm"
            placeholder="このオブジェクトが表す業務上の実体・役割"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
          />
        </div>

        {/* 色 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">色</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {OBJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="h-6 w-6 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  background: c,
                  borderColor: c === color ? '#0f172a' : 'transparent',
                }}
                title={c}
                onClick={() => void onUpdate(object.id, { color: c })}
              />
            ))}
          </div>
        </div>

        {/* 所属テーブル */}
        <div>
          <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-500">
            <Database className="h-3.5 w-3.5" />
            所属テーブル（{object.tables.length}）
          </label>
          {object.tables.length === 0 ? (
            <p className="rounded-md bg-gray-50 px-2 py-2 text-xs text-gray-400">
              紐づくテーブルはまだありません。
            </p>
          ) : (
            <ul className="space-y-1">
              {object.tables.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50/60 px-2 py-1.5"
                >
                  <span className="min-w-0 truncate text-xs text-gray-700">
                    {t.displayName ? `${t.displayName}（${t.name}）` : t.name}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-gray-400 hover:text-red-500"
                    title="このテーブルを外す"
                    onClick={() => void onLinkTable(t.id, null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {/* 追加セレクト */}
          {candidates.length > 0 && (
            <select
              className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-ring"
              value=""
              onChange={(e) => {
                if (e.target.value) void onLinkTable(e.target.value, object.id);
              }}
            >
              <option value="">＋ テーブルを追加...</option>
              {candidates.map((t) => {
                const other = tableLinkMap.get(t.id);
                const label = t.displayName ? `${t.displayName}（${t.name}）` : t.name;
                return (
                  <option key={t.id} value={t.id}>
                    {label}
                    {other ? `（現在: ${other.objectName}）` : ''}
                  </option>
                );
              })}
            </select>
          )}
        </div>

        {/* DFDデータストア（読み取り専用） */}
        <div>
          <label className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-500">
            <Share2 className="h-3.5 w-3.5" />
            DFDデータストア（{object.dfdNodes.length}）
          </label>
          {object.dfdNodes.length === 0 ? (
            <p className="rounded-md bg-gray-50 px-2 py-2 text-xs text-gray-400">
              紐づくDFDデータストアはありません。「DFDのデータストアから取り込み」で紐づけできます。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {object.dfdNodes.map((n) => (
                <span
                  key={n.id}
                  className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700"
                >
                  {n.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* ER図リンク */}
        <Link
          href={`/dashboard/projects/${projectId}/er-diagram`}
          className="flex items-center justify-between rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          <span className="inline-flex items-center gap-1.5">
            <Table2 className="h-4 w-4" />
            ER図でテーブル構造を見る
          </span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* フッター: 削除 */}
      <div className="border-t border-gray-100 px-4 py-3">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full gap-1.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={() => {
            if (!window.confirm(`オブジェクト「${object.name}」を削除しますか？\n関係線とテーブル・DFDの紐づけも解除されます。`)) return;
            void onDelete(object.id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          オブジェクトを削除
        </Button>
      </div>
    </div>
  );
}
