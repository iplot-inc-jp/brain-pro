'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, Trash2, Save, Loader2, Check } from 'lucide-react';
import type { RecordTemplate } from '@/lib/record-templates';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// 1行 = { 列key: 値 } のオブジェクト（値は文字列で扱う）
type RecordRow = Record<string, string>;

/**
 * 1つの記録テンプレ（配布物Excel由来）を編集可能な表として描画・保存する共通部品。
 * 記録ページとプロジェクト管理ワークスペース（タブ）の両方から使う。
 * 自前でフェッチ・保存を行うため、複数同時マウントしても各タブの編集状態が保持される。
 */
export function RecordSheetTable({
  projectId,
  template,
}: {
  projectId: string;
  template: RecordTemplate;
}) {
  const templateKey = template.key;

  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const getHeaders = useCallback(() => {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchSheet = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/record-sheets/${templateKey}`,
        { headers: getHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        const fetchedRows = Array.isArray(data?.rows) ? data.rows : [];
        // 各セルを文字列に正規化（input が文字列前提のため）
        const normalized: RecordRow[] = fetchedRows.map((row: unknown) => {
          const out: RecordRow = {};
          if (row && typeof row === 'object') {
            for (const col of template.columns) {
              const v = (row as Record<string, unknown>)[col.key];
              out[col.key] = v == null ? '' : String(v);
            }
          }
          return out;
        });
        setRows(normalized);
      } else if (res.status === 404) {
        // 未作成のシートは空表として扱う
        setRows([]);
      } else {
        setError('記録の読み込みに失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch record sheet:', err);
      setError('記録の読み込み中にエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, templateKey, template, getHeaders]);

  useEffect(() => {
    fetchSheet();
  }, [fetchSheet]);

  const emptyRow = useCallback((): RecordRow => {
    const row: RecordRow = {};
    for (const col of template.columns) row[col.key] = '';
    return row;
  }, [template]);

  const addRow = () => {
    setRows((prev) => [...prev, emptyRow()]);
    setSavedAt(null);
  };

  const deleteRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    setSavedAt(null);
  };

  const updateCell = (rowIndex: number, key: string, value: string) => {
    setRows((prev) =>
      prev.map((row, i) => (i === rowIndex ? { ...row, [key]: value } : row))
    );
    setSavedAt(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/record-sheets/${templateKey}`,
        {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ rows }),
        }
      );
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError('保存に失敗しました');
      }
    } catch (err) {
      console.error('Failed to save record sheet:', err);
      setError('保存中にエラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* ツールバー（行追加・保存） */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
          <Plus className="h-4 w-4" />
          行を追加
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 gap-1.5"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : savedAt ? (
            <Check className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? '保存中...' : savedAt ? '保存しました' : '保存'}
        </Button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-[240px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                      #
                    </th>
                    {template.columns.map((col) => (
                      <th
                        key={col.key}
                        className="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap min-w-[140px]"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr
                      key={rowIndex}
                      className="border-b border-gray-100 hover:bg-gray-50/50"
                    >
                      <td className="px-2 py-1 text-xs text-gray-400 align-middle">
                        {rowIndex + 1}
                      </td>
                      {template.columns.map((col) => (
                        <td key={col.key} className="px-1.5 py-1 align-middle">
                          <input
                            type="text"
                            value={row[col.key] ?? ''}
                            onChange={(e) =>
                              updateCell(rowIndex, col.key, e.target.value)
                            }
                            className="w-full min-w-[120px] rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-gray-900 hover:border-gray-200 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder={col.label}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-center align-middle">
                        <button
                          type="button"
                          onClick={() => deleteRow(rowIndex)}
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="この行を削除"
                          aria-label="この行を削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={template.columns.length + 2}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ行がありません。「行を追加」から記録を始めましょう。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-400">
                {rows.length} 行 / {template.columns.length} 列
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={addRow}
                className="gap-1.5 text-primary"
              >
                <Plus className="h-4 w-4" />
                行を追加
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
