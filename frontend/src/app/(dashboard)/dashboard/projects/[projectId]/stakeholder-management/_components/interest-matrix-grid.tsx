'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Trash2, Plus } from 'lucide-react';
import type { RecordTemplate } from '@/lib/record-templates';
import { useSheetStore, type SheetRow } from './sheet-store';
import { SaveBar } from './save-bar';

/**
 * 関心ごとマトリクス：フェーズ（行）× ロール/側面（列）の編集グリッド。
 * 先頭列（フェーズ）を sticky にして「マトリクス感」を出す。
 * 各セルは textarea で複数行入力でき、RecordSheet 'interest-matrix' に保存する。
 */
export function InterestMatrixGrid({
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

  // 先頭列 = phase（sticky）、残り = 各ロール/側面
  const phaseCol = template.columns[0];
  const valueCols = template.columns.slice(1);

  const emptyRow = (): SheetRow => {
    const r: SheetRow = {};
    for (const c of template.columns) r[c.key] = '';
    return r;
  };

  const addPhase = () => update((prev) => [...prev, emptyRow()]);
  const deletePhase = (i: number) =>
    update((prev) => prev.filter((_, idx) => idx !== i));
  const setCell = (i: number, key: string, value: string) =>
    update((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)),
    );

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
        onAdd={addPhase}
        addLabel="フェーズを追加"
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
        フェーズ（行）×ロール（列）で「各局面で誰が何に関心を持つか」を整理します。ここで決めた関心ごとが、会議体での
        「報告の中身（何を）」を相手別に決める土台になります。
      </p>

      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[#050f3e] text-white">
                  <th className="sticky left-0 z-10 min-w-[160px] bg-[#050f3e] px-3 py-2 text-left text-xs font-semibold">
                    {phaseCol?.label ?? 'フェーズ'}
                  </th>
                  {valueCols.map((col) => (
                    <th
                      key={col.key}
                      className="min-w-[180px] px-3 py-2 text-left text-xs font-semibold"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="w-12 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-gray-100 align-top transition-colors hover:bg-blue-50/30"
                  >
                    {/* sticky フェーズ列 */}
                    <td className="sticky left-0 z-10 bg-blue-50/70 px-2 py-1.5">
                      <textarea
                        value={row[phaseCol?.key ?? 'phase'] ?? ''}
                        onChange={(e) =>
                          setCell(i, phaseCol?.key ?? 'phase', e.target.value)
                        }
                        rows={2}
                        className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-[#050f3e] hover:border-blue-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder={phaseCol?.label}
                      />
                    </td>
                    {valueCols.map((col) => (
                      <td key={col.key} className="px-1.5 py-1.5">
                        <textarea
                          value={row[col.key] ?? ''}
                          onChange={(e) =>
                            setCell(i, col.key, e.target.value)
                          }
                          rows={2}
                          className="w-full resize-y rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                          placeholder={col.label}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <button
                        type="button"
                        onClick={() => deletePhase(i)}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="このフェーズを削除"
                        aria-label="このフェーズを削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={template.columns.length + 1}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      まだフェーズがありません。「フェーズを追加」から始めましょう。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-400">
              {rows.length} フェーズ × {valueCols.length} ロール
            </p>
            <button
              type="button"
              onClick={addPhase}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              フェーズを追加
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
