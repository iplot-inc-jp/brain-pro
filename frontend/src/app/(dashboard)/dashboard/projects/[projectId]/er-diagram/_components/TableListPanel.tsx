'use client';

/**
 * TableListPanel — ER図キャンバス下の一覧パネル。
 *
 * テーブル一覧をオブジェクトごとにグルーピング表示し、各行の「所属オブジェクト」select で
 * テーブル⇄オブジェクトの紐づけを即時保存（LinkTableToObject）できる。
 * テーブル名はデータカタログ詳細ページへのリンク。
 */

import Link from 'next/link';
import { ExternalLink, KeyRound, Loader2, Table2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DataObjectDto, ErTableDto } from '@/lib/data-objects';
import { objectColor } from './er-layout';

const NONE_VALUE = '__none__';
/** select 内の「＋ 新規オブジェクトを作成…」用センチネル（値としては保存しない） */
const CREATE_VALUE = '__create__';

interface TableListPanelProps {
  projectId: string;
  objects: DataObjectDto[];
  tables: ErTableDto[];
  /** 紐づけ保存中のテーブルID（select を一時的に無効化） */
  savingLinkTableId: string | null;
  onLinkChange: (tableId: string, dataObjectId: string | null) => void;
  /** select の「＋ 新規オブジェクトを作成…」選択時。作成後にこのテーブルへ紐づける */
  onCreateForTable: (tableId: string) => void;
}

export function TableListPanel({
  projectId,
  objects,
  tables,
  savingLinkTableId,
  onLinkChange,
  onCreateForTable,
}: TableListPanelProps) {
  const sortedObjects = [...objects].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'),
  );
  const objectIds = new Set(sortedObjects.map((o) => o.id));

  const groups: Array<{
    key: string;
    name: string;
    color: string;
    members: ErTableDto[];
  }> = sortedObjects.map((obj, index) => ({
    key: obj.id,
    name: obj.name,
    color: objectColor(obj, index),
    members: tables.filter((t) => t.dataObjectId === obj.id),
  }));
  const unassigned = tables.filter((t) => !t.dataObjectId || !objectIds.has(t.dataObjectId));
  if (unassigned.length > 0) {
    groups.push({ key: '__unassigned__', name: '未分類', color: '#9ca3af', members: unassigned });
  }

  const renderRow = (table: ErTableDto) => {
    const pkCount = table.columns.filter((c) => c.isPrimaryKey).length;
    const fkCount = table.columns.filter((c) => c.isForeignKey).length;
    const saving = savingLinkTableId === table.id;
    return (
      <div
        key={table.id}
        className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Table2 className="h-4 w-4 shrink-0 text-gray-400" />
          <Link
            href={`/dashboard/projects/${projectId}/catalog/${table.id}`}
            className="group inline-flex min-w-0 items-center gap-1 text-sm font-medium text-gray-900 hover:text-blue-700 hover:underline"
            title="データカタログ詳細を開く"
          >
            <span className="truncate">{table.displayName || table.name}</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-gray-300 group-hover:text-blue-500" />
          </Link>
          <code className="hidden truncate text-xs text-gray-400 sm:inline">{table.name}</code>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            {pkCount > 0 && <KeyRound className="h-3 w-3 text-amber-500" />}
            {table.columns.length} カラム
            {fkCount > 0 && <span className="text-indigo-500">/ FK {fkCount}</span>}
          </span>
          <div className="w-48">
            <Select
              value={table.dataObjectId && objectIds.has(table.dataObjectId) ? table.dataObjectId : NONE_VALUE}
              onValueChange={(value) => {
                // 「＋ 新規作成」は紐づけ変更ではなく作成ダイアログを開く。
                // controlled（value=現在の所属）なので表示値は変わらない。
                if (value === CREATE_VALUE) {
                  onCreateForTable(table.id);
                  return;
                }
                onLinkChange(table.id, value === NONE_VALUE ? null : value);
              }}
              disabled={saving}
            >
              <SelectTrigger className="h-8 bg-white border-gray-300 text-xs text-gray-700">
                {saving ? (
                  <span className="inline-flex items-center gap-1 text-gray-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    保存中...
                  </span>
                ) : (
                  <SelectValue placeholder="所属オブジェクト" />
                )}
              </SelectTrigger>
              <SelectContent className="bg-white">
                <SelectItem value={NONE_VALUE}>未分類</SelectItem>
                {sortedObjects.map((obj, index) => (
                  <SelectItem key={obj.id} value={obj.id}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: objectColor(obj, index) }}
                      />
                      {obj.name}
                    </span>
                  </SelectItem>
                ))}
                {/* 区切りの下に新規作成導線（選んでも値は変わらず、ダイアログが開く） */}
                <SelectSeparator />
                <SelectItem value={CREATE_VALUE} className="text-blue-600">
                  ＋ 新規オブジェクトを作成…
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="bg-white border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-gray-900">テーブル一覧（オブジェクト別）</CardTitle>
        <p className="text-xs text-gray-500">
          「所属オブジェクト」を変更すると即時保存され、ER図の点線囲みにも反映されます。テーブル名からデータカタログ詳細を開けます。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} />
              <span className="text-sm font-semibold text-gray-800">{group.name}</span>
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] text-gray-600">
                {group.members.length} テーブル
              </span>
            </div>
            {group.members.length > 0 ? (
              <div className="divide-y divide-gray-100">{group.members.map(renderRow)}</div>
            ) : (
              <p className="px-3 py-3 text-xs text-gray-400">
                このオブジェクトに紐づくテーブルはまだありません。下の他グループの select から割り当てられます。
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
