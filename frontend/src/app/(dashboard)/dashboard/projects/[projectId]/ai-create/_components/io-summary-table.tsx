'use client';

/**
 * フローIOサマリの選択テーブル。
 *
 * io-summary（フロー上の INPUT/OUTPUT・矢印上のデータを重複排除したもの）を
 * 種別ごと（帳票 / データ / 物体 = DOCUMENT / INFORMATION / OBJECT）にグルーピングし、
 * 各行に チェックボックス・名前・出現箇所(sources)・種別セレクタ を表示する。
 * 種別セレクタは編集可（editableCategory）のとき、その場で
 * informationTypeApi.update により保存される（KPIと紐付けやすくするため）。
 */

import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, LogIn, LogOut, Loader2 } from 'lucide-react';
import {
  informationTypeApi,
  INFORMATION_CATEGORY_OPTIONS,
  type InformationCategory,
} from '@/lib/dfd';
import type { IoSummaryItemDto, IoSummarySourceDto } from '@/lib/kpis';
import { normalizeIoCategory } from './kpi-format';

/** グループの表示順と見出し（タスク要件: 帳票 / データ / 物体）。 */
const GROUPS: ReadonlyArray<{ category: InformationCategory; title: string; tone: string }> = [
  { category: 'DOCUMENT', title: '帳票', tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  { category: 'INFORMATION', title: 'データ（情報）', tone: 'text-blue-700 bg-blue-50 border-blue-200' },
  { category: 'OBJECT', title: '物体', tone: 'text-amber-700 bg-amber-50 border-amber-200' },
];

/** 出現箇所チップ（ノードのIN/OUT or 矢印上のデータ）。 */
function SourceChip({ source }: { source: IoSummarySourceDto }) {
  if (source.kind === 'node') {
    const isInput = source.direction === 'INPUT';
    return (
      <span
        className={`inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[10px] ${
          isInput
            ? 'border-sky-200 bg-sky-50 text-sky-700'
            : 'border-orange-200 bg-orange-50 text-orange-700'
        }`}
        title={`業務「${source.label}」の${isInput ? 'INPUT' : 'OUTPUT'}`}
      >
        {isInput ? <LogIn className="h-2.5 w-2.5" /> : <LogOut className="h-2.5 w-2.5" />}
        {source.label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-gray-50 px-1 py-0.5 text-[10px] text-gray-600"
      title={`矢印上のデータ: ${source.label}`}
    >
      <ArrowRight className="h-2.5 w-2.5" />
      {source.label}
    </span>
  );
}

export function IoSummaryTable({
  items,
  selectedIds,
  onToggle,
  editableCategory = false,
  onCategoryChanged,
}: {
  items: IoSummaryItemDto[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  /** 種別セレクタをその場編集可能にする（informationType の category を更新） */
  editableCategory?: boolean;
  /** 種別変更の保存後に呼ばれる（io-summary 再取得など） */
  onCategoryChanged?: () => Promise<void> | void;
}) {
  // 種別変更の保存中の行ID
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<InformationCategory, IoSummaryItemDto[]>();
    for (const item of items) {
      const cat = normalizeIoCategory(item.category);
      const arr = map.get(cat) ?? [];
      arr.push(item);
      map.set(cat, arr);
    }
    return map;
  }, [items]);

  const handleCategoryChange = useCallback(
    async (item: IoSummaryItemDto, next: InformationCategory) => {
      if (next === normalizeIoCategory(item.category)) return;
      setSavingId(item.id);
      setRowError(null);
      try {
        // 種別はマスタ（InformationType）側を直接更新する＝他画面にも反映される
        await informationTypeApi.update(item.id, { category: next });
        await onCategoryChanged?.();
      } catch (err) {
        setRowError(err instanceof Error ? err.message : '種別の変更に失敗しました');
      } finally {
        setSavingId(null);
      }
    },
    [onCategoryChanged],
  );

  if (items.length === 0) {
    return (
      <p className="rounded border border-dashed border-gray-200 py-6 text-center text-sm text-gray-400">
        このフローには INPUT/OUTPUT・矢印上のデータがありません。フロー編集画面で業務の入出力を設定してください。
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rowError && <p className="text-xs text-red-600">{rowError}</p>}
      {GROUPS.map((group) => {
        const groupItems = grouped.get(group.category) ?? [];
        if (groupItems.length === 0) return null;
        return (
          <div key={group.category} className="overflow-hidden rounded border border-gray-100">
            <div className={`flex items-center gap-2 border-b px-3 py-1.5 ${group.tone}`}>
              <span className="text-xs font-semibold">{group.title}</span>
              <span className="text-[10px] opacity-70">{groupItems.length}件</span>
            </div>
            <ul className="divide-y divide-gray-100 bg-white">
              {groupItems.map((item) => (
                <li key={item.id} className="flex items-start gap-2 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => onToggle(item.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600"
                    title="KPI作成の対象に含める"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onToggle(item.id)}
                        className="truncate text-left text-sm font-medium text-gray-800 hover:text-blue-700"
                        title={item.description || item.name}
                      >
                        {item.name}
                      </button>
                      {editableCategory && (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          {savingId === item.id && (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                          )}
                          <select
                            value={normalizeIoCategory(item.category)}
                            onChange={(e) =>
                              void handleCategoryChange(item, e.target.value as InformationCategory)
                            }
                            disabled={savingId === item.id}
                            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[11px] text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                            title="種別（その場で変更して保存）"
                          >
                            {INFORMATION_CATEGORY_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </span>
                      )}
                    </div>
                    {/* 出現箇所（ノードのIN/OUT・矢印） */}
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] text-gray-400">出現箇所:</span>
                      {item.sources.length === 0 ? (
                        <span className="text-[10px] text-gray-400">-</span>
                      ) : (
                        item.sources.map((s, i) => <SourceChip key={i} source={s} />)
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
