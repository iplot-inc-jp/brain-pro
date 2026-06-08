'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Trash2, Plus, Grid3x3 } from 'lucide-react';
import {
  type InterestMatrixRow,
  type InterestMatrixRowInput,
  interestRowsApi,
} from '@/lib/stakeholders';

// フェーズ×視点の実テーブル。各セルは入力後フォーカスを外すと PATCH 保存。
const INTEREST_FIELDS: {
  key: keyof InterestMatrixRowInput;
  label: string;
  multiline?: boolean;
  highlight?: boolean;
}[] = [
  { key: 'phase', label: 'フェーズ' },
  { key: 'duration', label: '期間目安' },
  { key: 'mainMeetings', label: '主要ミーティング体', multiline: true },
  { key: 'fieldStaff', label: '現場（実務担当）', multiline: true, highlight: true },
  { key: 'clientPm', label: '先方プロマネ', multiline: true, highlight: true },
  { key: 'executive', label: '役員（経営層）', multiline: true, highlight: true },
];

export function InterestMatrixBoard({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<InterestMatrixRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await interestRowsApi.list(projectId);
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const handleAdd = async () => {
    setError(null);
    try {
      await interestRowsApi.create(projectId, { order: rows.length });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '行の追加に失敗しました');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このフェーズ行を削除しますか？')) return;
    setError(null);
    try {
      await interestRowsApi.delete(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '行の削除に失敗しました');
    }
  };

  // ローカル編集。
  const setField = (
    id: string,
    key: keyof InterestMatrixRowInput,
    value: string,
  ) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)),
    );

  // blur で PATCH（空文字は null に正規化）。
  const commitField = async (
    id: string,
    key: keyof InterestMatrixRowInput,
    value: string,
  ) => {
    const trimmed = value.trim();
    try {
      await interestRowsApi.update(id, {
        [key]: trimmed === '' ? null : trimmed,
      } as InterestMatrixRowInput);
    } catch (e) {
      setError(e instanceof Error ? e.message : '行の更新に失敗しました');
      await reload();
    }
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
          <Grid3x3 className="h-4 w-4 text-blue-600" />
          関心ごとマトリクス（フェーズ × 視点）
        </h3>
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          フェーズ行を追加
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <p className="text-xs text-gray-500">
        各フェーズ（行）について、現場・先方プロマネ・役員それぞれの関心ごとを整理します。各セルは入力後フォーカスを外すと自動保存されます。
      </p>

      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                    #
                  </th>
                  {INTEREST_FIELDS.map((f) => (
                    <th
                      key={f.key as string}
                      className={`min-w-[150px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold ${
                        f.highlight
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-600'
                      }`}
                    >
                      {f.label}
                    </th>
                  ))}
                  <th className="w-12 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-100 align-top hover:bg-gray-50/50"
                  >
                    <td className="px-2 py-2 align-middle text-xs text-gray-400">
                      {i + 1}
                    </td>
                    {INTEREST_FIELDS.map((f) => (
                      <td
                        key={f.key as string}
                        className={`px-1.5 py-1.5 align-middle ${
                          f.highlight ? 'bg-blue-50/40' : ''
                        }`}
                      >
                        {f.multiline ? (
                          <textarea
                            value={(r[f.key] as string | null) ?? ''}
                            onChange={(e) =>
                              setField(r.id, f.key, e.target.value)
                            }
                            onBlur={(e) =>
                              commitField(r.id, f.key, e.target.value)
                            }
                            rows={2}
                            placeholder={f.label}
                            className="w-full min-w-[130px] resize-y rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : (
                          <input
                            type="text"
                            value={(r[f.key] as string | null) ?? ''}
                            onChange={(e) =>
                              setField(r.id, f.key, e.target.value)
                            }
                            onBlur={(e) =>
                              commitField(r.id, f.key, e.target.value)
                            }
                            placeholder={f.label}
                            className="w-full min-w-[110px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="このフェーズ行を削除"
                        aria-label="このフェーズ行を削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={INTEREST_FIELDS.length + 2}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      まだフェーズ行がありません。「フェーズ行を追加」から始めましょう。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <p className="text-xs text-gray-400">{rows.length} フェーズ</p>
            <button
              type="button"
              onClick={handleAdd}
              className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              フェーズ行を追加
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
