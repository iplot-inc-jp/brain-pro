'use client';

/**
 * ObjectScopeLinkPanel — オブジェクト関係性マップ下の「領域紐付け」一覧パネル。
 *
 * オブジェクトを領域（SubProject）別にグルーピング表示し、各行の領域ピッカーで
 * オブジェクト⇄領域の紐づけを即時保存（linkObjectToSubProject）できる。
 * 「未分類」グループも表示する（subProjectId=null）。
 * ER図の TableListPanel（テーブル別グルーピング）と同じ作法。
 */

import { Boxes, Layers } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SubProjectPicker, subProjectPath } from '@/components/ui/sub-project-picker';
import type { SubProjectMaster } from '@/lib/masters';
import type { DataObjectDto } from '@/lib/data-objects';
import { objectColor } from './object-map-shared';

interface ObjectScopeLinkPanelProps {
  objects: DataObjectDto[];
  subProjects: SubProjectMaster[];
  /** 紐づけ保存中のオブジェクトID（ピッカーを一時的に無効化） */
  savingObjectId: string | null;
  /** subProjectId=null で未分類へ */
  onLinkChange: (objectId: string, subProjectId: string | null) => void;
}

export function ObjectScopeLinkPanel({
  objects,
  subProjects,
  savingObjectId,
  onLinkChange,
}: ObjectScopeLinkPanelProps) {
  const sortedSubProjects = [...subProjects].sort(
    (a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'),
  );
  const subProjectIds = new Set(sortedSubProjects.map((s) => s.id));

  // 領域ごとのグループ（領域順）＋ 末尾に「未分類」
  const groups: Array<{
    key: string;
    name: string;
    members: DataObjectDto[];
  }> = sortedSubProjects.map((sp) => ({
    key: sp.id,
    name: subProjectPath(sp.id, subProjects) || sp.name,
    members: objects.filter((o) => o.subProjectId === sp.id),
  }));
  const unassigned = objects.filter(
    (o) => !o.subProjectId || !subProjectIds.has(o.subProjectId),
  );
  groups.push({ key: '__unassigned__', name: '未分類', members: unassigned });

  const renderRow = (obj: DataObjectDto) => {
    const saving = savingObjectId === obj.id;
    const color = objectColor(obj.color);
    return (
      <div
        key={obj.id}
        className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-sm font-medium text-gray-900">{obj.name}</span>
          <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
            テーブル {obj.tables.length}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {saving && <span className="text-[11px] text-gray-400">保存中...</span>}
          <SubProjectPicker
            subProjects={subProjects}
            value={obj.subProjectId && subProjectIds.has(obj.subProjectId) ? obj.subProjectId : ''}
            onChange={(v) => onLinkChange(obj.id, v === '' ? null : v)}
            placeholder="未分類"
            disabled={saving}
          />
        </div>
      </div>
    );
  };

  return (
    <Card className="bg-white border-gray-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-1.5 text-base text-gray-900">
          <Layers className="h-4 w-4 text-gray-400" />
          領域紐付け（オブジェクト × 領域）
        </CardTitle>
        <p className="text-xs text-gray-500">
          オブジェクトを領域（SubProject）別に整理します。各行の領域ピッカーを変更すると即時保存されます。キャンバスの「スコープ」囲みで内側のオブジェクトをまとめて紐付けることもできます。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-lg border border-gray-200">
            <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2">
              {group.key === '__unassigned__' ? (
                <Boxes className="h-4 w-4 text-gray-400" />
              ) : (
                <Layers className="h-4 w-4 text-indigo-400" />
              )}
              <span className="text-sm font-semibold text-gray-800">{group.name}</span>
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] text-gray-600">
                {group.members.length} オブジェクト
              </span>
            </div>
            {group.members.length > 0 ? (
              <div className="divide-y divide-gray-100">{group.members.map(renderRow)}</div>
            ) : (
              <p className="px-3 py-3 text-xs text-gray-400">
                この領域に紐づくオブジェクトはまだありません。他グループの領域ピッカーから割り当てられます。
              </p>
            )}
          </div>
        ))}
        {subProjects.length === 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            領域（SubProject）がまだ定義されていません。プロジェクト設定で領域を作成すると、ここで紐付けできます。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
