'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Trash2, Plus, Users } from 'lucide-react';
import type { RecordTemplate } from '@/lib/record-templates';
import { useSheetStore, useSheetRowsReadOnly, type SheetRow } from './sheet-store';
import { SaveBar } from './save-bar';

/**
 * meeting-list の rows に追記する独自キー（テンプレ列とは別管理）。
 * ★PURPOSE はテンプレの 'purpose'（目的・ゴール）と衝突しないよう 'reportPurpose' にする。
 */
const STAKEHOLDERS_KEY = 'stakeholders'; // 対象ステークホルダー（氏名をカンマ連結）
const REPORT_PURPOSE_KEY = 'reportPurpose'; // 報告事項（この会議体で何を報告するか）
const GRANULARITY_KEY = 'reportGranularity'; // 報告の粒度

/** 報告粒度の選択肢（相手に応じた報告の濃淡）。 */
const GRANULARITY_OPTIONS = [
  'エグゼクティブサマリ',
  '標準',
  '詳細',
  '口頭共有のみ',
] as const;

const CUSTOM_KEYS = [STAKEHOLDERS_KEY, REPORT_PURPOSE_KEY, GRANULARITY_KEY];

function splitNames(raw: string): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 支持度→ドット色（粒度判断の手掛かりに併記）。 */
function supportDot(support: string): string {
  if (support === '支持') return 'bg-emerald-500';
  if (support === '反対') return 'bg-rose-500';
  if (support === '中立') return 'bg-gray-400';
  return 'bg-gray-300';
}

/** 報告粒度→バッジ色。 */
function granularityClass(g: string): string {
  switch (g) {
    case 'エグゼクティブサマリ':
      return 'bg-[#050f3e] text-white';
    case '詳細':
      return 'bg-blue-100 text-blue-800';
    case '口頭共有のみ':
      return 'bg-amber-100 text-amber-800';
    case '標準':
      return 'bg-gray-100 text-gray-700';
    default:
      return 'bg-white text-gray-400 border border-dashed border-gray-300';
  }
}

type StakeholderInfo = {
  name: string;
  influence: string;
  support: string;
  reportFrequency: string;
};

/**
 * 会議体一覧：既存の会議列に加えて「対象ステークホルダー（複数選択）」「報告粒度」「報告事項」を持たせ、
 * どの会議体が・誰に・どの粒度で・何を報告するか（＝報告の粒度管理）を一画面で設計できるようにする。
 * 選択肢は 'stakeholder-map' RecordSheet の氏名＋影響度/支持度/報告頻度から動的に取得する。
 */
export function MeetingListEditor({
  projectId,
  template,
}: {
  projectId: string;
  template: RecordTemplate;
}) {
  const { rows, update, loading, saving, savedAt, save, error } = useSheetStore(
    projectId,
    template.key,
  );
  const stakeholderRows = useSheetRowsReadOnly(projectId, 'stakeholder-map');
  const [openPicker, setOpenPicker] = useState<number | null>(null);

  // 氏名→属性。重複氏名は最初の1件を採用。
  const stakeholders = useMemo<StakeholderInfo[]>(() => {
    const seen = new Set<string>();
    const out: StakeholderInfo[] = [];
    for (const r of stakeholderRows) {
      const name = (r.name ?? '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({
        name,
        influence: (r.influence ?? '').trim(),
        support: (r.support ?? '').trim(),
        reportFrequency: (r.reportFrequency ?? '').trim(),
      });
    }
    return out;
  }, [stakeholderRows]);
  const infoByName = useMemo(
    () => new Map(stakeholders.map((s) => [s.name, s])),
    [stakeholders],
  );
  const hasStakeholders = stakeholders.length > 0;

  // 表に出す基本列（独自キーは専用UIで扱うので除外。テンプレの purpose=目的・ゴール は通常列として残す）
  const baseCols = template.columns.filter((c) => !CUSTOM_KEYS.includes(c.key));

  const emptyRow = (): SheetRow => {
    const r: SheetRow = {};
    for (const c of template.columns) r[c.key] = '';
    for (const k of CUSTOM_KEYS) r[k] = '';
    return r;
  };

  const addMeeting = () => update((prev) => [...prev, emptyRow()]);
  const deleteMeeting = (i: number) =>
    update((prev) => prev.filter((_, idx) => idx !== i));
  const setCell = (i: number, key: string, value: string) =>
    update((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)),
    );

  const toggleStakeholder = (rowIndex: number, name: string) => {
    update((prev) =>
      prev.map((r, idx) => {
        if (idx !== rowIndex) return r;
        const current = splitNames(r[STAKEHOLDERS_KEY] ?? '');
        const next = current.includes(name)
          ? current.filter((n) => n !== name)
          : [...current, name];
        return { ...r, [STAKEHOLDERS_KEY]: next.join(', ') };
      }),
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SaveBar
        onAdd={addMeeting}
        addLabel="会議体を追加"
        onSave={() => save(rows)}
        saving={saving}
        savedAt={savedAt}
      />

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-500">
        各会議体に「誰に（対象ステークホルダー）」「どの粒度で（報告粒度）」「何を（報告事項）」を結びつけ、
        相手・内容・濃淡を分けて報告を設計します。対象候補はステークホルダーマップの氏名と連動します。
      </p>

      {!hasStakeholders && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          「ステークホルダーマップ」タブに氏名を登録すると、各会議体の対象ステークホルダーとして選べるようになります。
        </div>
      )}

      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                    #
                  </th>
                  {baseCols.map((col) => (
                    <th
                      key={col.key}
                      className="min-w-[140px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-600"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="min-w-[230px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                    対象ステークホルダー
                  </th>
                  <th className="min-w-[150px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                    報告粒度
                  </th>
                  <th className="min-w-[200px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                    報告事項
                  </th>
                  <th className="w-12 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const selected = splitNames(row[STAKEHOLDERS_KEY] ?? '');
                  return (
                    <tr
                      key={i}
                      className="border-b border-gray-100 align-top hover:bg-gray-50/50"
                    >
                      <td className="px-2 py-2 align-middle text-xs text-gray-400">
                        {i + 1}
                      </td>
                      {baseCols.map((col) => (
                        <td key={col.key} className="px-1.5 py-1.5 align-middle">
                          <input
                            type="text"
                            value={row[col.key] ?? ''}
                            onChange={(e) => setCell(i, col.key, e.target.value)}
                            className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder={col.label}
                          />
                        </td>
                      ))}

                      {/* 対象ステークホルダー（複数選択・影響度/支持度を併記） */}
                      <td className="bg-blue-50/40 px-2 py-1.5">
                        <div className="flex flex-wrap gap-1">
                          {selected.map((name) => {
                            const info = infoByName.get(name);
                            return (
                              <span
                                key={name}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
                                title={
                                  info
                                    ? `影響度:${info.influence || '—'} / 支持度:${info.support || '—'}${info.reportFrequency ? ` / 報告:${info.reportFrequency}` : ''}`
                                    : 'マップに未登録'
                                }
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${supportDot(info?.support ?? '')}`}
                                />
                                {name}
                                <button
                                  type="button"
                                  onClick={() => toggleStakeholder(i, name)}
                                  className="text-blue-500 hover:text-blue-800"
                                  aria-label={`${name} を外す`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                        <div className="relative mt-1">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenPicker(openPicker === i ? null : i)
                            }
                            disabled={!hasStakeholders}
                            className="flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Users className="h-3 w-3" />
                            選択
                          </button>
                          {openPicker === i && hasStakeholders && (
                            <>
                              {/* クリックアウトで閉じる透明オーバーレイ */}
                              <button
                                type="button"
                                aria-label="閉じる"
                                onClick={() => setOpenPicker(null)}
                                className="fixed inset-0 z-10 cursor-default"
                              />
                              <div className="absolute z-20 mt-1 max-h-56 w-60 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
                                {stakeholders.map((s) => {
                                  const checked = selected.includes(s.name);
                                  return (
                                    <label
                                      key={s.name}
                                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() =>
                                          toggleStakeholder(i, s.name)
                                        }
                                        className="h-3.5 w-3.5"
                                      />
                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${supportDot(s.support)}`}
                                      />
                                      <span className="flex-1 text-gray-800">
                                        {s.name}
                                      </span>
                                      {s.influence && (
                                        <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">
                                          影響{s.influence}
                                        </span>
                                      )}
                                    </label>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </td>

                      {/* 報告粒度 */}
                      <td className="bg-blue-50/40 px-2 py-1.5 align-middle">
                        <select
                          value={row[GRANULARITY_KEY] ?? ''}
                          onChange={(e) =>
                            setCell(i, GRANULARITY_KEY, e.target.value)
                          }
                          className={`w-full rounded-md px-2 py-1 text-[11px] font-medium focus:outline-none focus:ring-1 focus:ring-primary ${granularityClass(
                            row[GRANULARITY_KEY] ?? '',
                          )}`}
                          aria-label="報告粒度"
                        >
                          <option value="">粒度を選択</option>
                          {GRANULARITY_OPTIONS.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* 報告事項 */}
                      <td className="bg-blue-50/40 px-1.5 py-1.5">
                        <textarea
                          value={row[REPORT_PURPOSE_KEY] ?? ''}
                          onChange={(e) =>
                            setCell(i, REPORT_PURPOSE_KEY, e.target.value)
                          }
                          rows={2}
                          className="w-full resize-y rounded-md border border-transparent bg-white/70 px-2 py-1 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder="この会議体で何を報告するか"
                        />
                      </td>

                      <td className="px-2 py-1.5 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => deleteMeeting(i)}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="この会議体を削除"
                          aria-label="この会議体を削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={baseCols.length + 5}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      まだ会議体がありません。「会議体を追加」から始めましょう。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-400">{rows.length} 会議体</p>
            <button
              type="button"
              onClick={addMeeting}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              会議体を追加
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
