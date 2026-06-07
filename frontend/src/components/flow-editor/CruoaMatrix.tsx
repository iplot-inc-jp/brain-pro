'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Plus,
  Trash2,
  Save,
  Loader2,
  Check,
  AlertTriangle,
  UserX,
} from 'lucide-react';
import type { Role } from './flow-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

/**
 * 情報の地図（CRUOA マトリクス）エディタ。
 * 行=情報項目 × 列=ロール（プロジェクトのロール／無ければ自由列）。
 * 各セルに C=作成 / R=参照 / U=更新 / O=出力 / A=承認 を複数選択でマッピングする。
 *
 * 永続化は既存の RecordSheet API（rows=任意オブジェクト配列）を再利用する。
 *   1 行 = { __info: 情報項目名, __cols: JSON(列定義), <colId>: "C/U" ... }
 * 列定義（ロールIDまたは自由列）は各行に __cols として冗長に持たせ、行が空でも
 * 復元できるよう先頭行に保持する（行が無い場合は roles から既定列を生成）。
 *
 * 診断（uiHint）:
 *  - 同一情報を複数ロールが C または U → 二重管理（転記リスク）として警告
 *  - 作成者(C)が1ロールのみ → 属人化として警告
 */

const CRUOA_TAGS = ['C', 'R', 'U', 'O', 'A'] as const;
type CruoaTag = (typeof CRUOA_TAGS)[number];

const TAG_LABEL: Record<CruoaTag, string> = {
  C: '作成',
  R: '参照',
  U: '更新',
  O: '出力',
  A: '承認',
};

const TAG_COLOR: Record<CruoaTag, string> = {
  C: 'bg-blue-100 text-blue-700 border-blue-300',
  R: 'bg-gray-100 text-gray-700 border-gray-300',
  U: 'bg-amber-100 text-amber-700 border-amber-300',
  O: 'bg-violet-100 text-violet-700 border-violet-300',
  A: 'bg-emerald-100 text-emerald-700 border-emerald-300',
};

type MatrixCol = { id: string; label: string; roleId?: string };
type MatrixRow = {
  info: string;
  cells: Record<string, string>; // colId -> "C/U" 形式（スラッシュ区切り）
};

const INFO_KEY = '__info';
const COLS_KEY = '__cols';

function parseTags(value: string | undefined): CruoaTag[] {
  if (!value) return [];
  return value
    .split('/')
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is CruoaTag => (CRUOA_TAGS as readonly string[]).includes(s));
}

function serializeTags(tags: CruoaTag[]): string {
  // 表示・保存順を CRUOA の正規順に揃える
  return CRUOA_TAGS.filter((t) => tags.includes(t)).join('/');
}

export function CruoaMatrix({
  projectId,
  templateKey,
  roles,
}: {
  projectId: string;
  templateKey: string;
  roles: Role[];
}) {
  const [cols, setCols] = useState<MatrixCol[]>([]);
  const [rows, setRows] = useState<MatrixRow[]>([]);
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

  // 既定列（プロジェクトのロール、無ければ汎用列）
  const defaultCols = useCallback((): MatrixCol[] => {
    if (roles.length > 0) {
      return roles.map((r) => ({ id: `role:${r.id}`, label: r.name, roleId: r.id }));
    }
    return [
      { id: 'c1', label: '担当者' },
      { id: 'c2', label: '部長' },
      { id: 'c3', label: 'ERP' },
      { id: 'c4', label: 'Excel' },
      { id: 'c5', label: 'メール' },
      { id: 'c6', label: '仕入先' },
    ];
  }, [roles]);

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
        const fetched = Array.isArray(data?.rows) ? data.rows : [];
        // 列定義は先頭行の __cols から復元
        let restoredCols: MatrixCol[] | null = null;
        const first = fetched[0] as Record<string, unknown> | undefined;
        if (first && typeof first[COLS_KEY] === 'string') {
          try {
            const parsed = JSON.parse(first[COLS_KEY] as string);
            if (Array.isArray(parsed)) restoredCols = parsed as MatrixCol[];
          } catch {
            /* noop */
          }
        }
        const effectiveCols = restoredCols && restoredCols.length > 0 ? restoredCols : defaultCols();
        setCols(effectiveCols);
        const restoredRows: MatrixRow[] = fetched.map((raw: unknown) => {
          const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
          const cells: Record<string, string> = {};
          for (const col of effectiveCols) {
            const v = r[col.id];
            cells[col.id] = v == null ? '' : String(v);
          }
          return { info: r[INFO_KEY] == null ? '' : String(r[INFO_KEY]), cells };
        });
        setRows(restoredRows);
      } else if (res.status === 404) {
        setCols(defaultCols());
        setRows([]);
      } else {
        setError('情報の地図の読み込みに失敗しました');
        setCols(defaultCols());
      }
    } catch (err) {
      console.error('Failed to fetch CRUOA matrix:', err);
      setError('情報の地図の読み込み中にエラーが発生しました');
      setCols(defaultCols());
    } finally {
      setLoading(false);
    }
  }, [projectId, templateKey, getHeaders, defaultCols]);

  useEffect(() => {
    fetchSheet();
  }, [fetchSheet]);

  const dirty = () => setSavedAt(null);

  const addRow = () => {
    setRows((prev) => [...prev, { info: '', cells: {} }]);
    dirty();
  };

  const deleteRow = (index: number) => {
    setRows((prev) => prev.filter((_, i) => i !== index));
    dirty();
  };

  const updateInfo = (index: number, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, info: value } : r)));
    dirty();
  };

  const toggleTag = (rowIndex: number, colId: string, tag: CruoaTag) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== rowIndex) return r;
        const current = parseTags(r.cells[colId]);
        const next = current.includes(tag)
          ? current.filter((t) => t !== tag)
          : [...current, tag];
        return { ...r, cells: { ...r.cells, [colId]: serializeTags(next) } };
      })
    );
    dirty();
  };

  const addCol = () => {
    setCols((prev) => [
      ...prev,
      { id: `c${Date.now().toString(36)}`, label: '新しい列' },
    ]);
    dirty();
  };

  const updateColLabel = (colId: string, label: string) => {
    setCols((prev) => prev.map((c) => (c.id === colId ? { ...c, label } : c)));
    dirty();
  };

  const deleteCol = (colId: string) => {
    setCols((prev) => prev.filter((c) => c.id !== colId));
    setRows((prev) =>
      prev.map((r) => {
        const cells = { ...r.cells };
        delete cells[colId];
        return { ...r, cells };
      })
    );
    dirty();
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const colsJson = JSON.stringify(cols);
      // RecordSheet 形式（{colKey:value} の配列）にシリアライズ。
      // 列定義は各行の __cols に冗長保存（行が空でも先頭行で復元できるように）。
      const serialized = rows.map((r) => {
        const out: Record<string, string> = { [INFO_KEY]: r.info, [COLS_KEY]: colsJson };
        for (const col of cols) out[col.id] = r.cells[col.id] ?? '';
        return out;
      });
      // 行が無くても列定義を残すためのプレースホルダ行
      const payloadRows =
        serialized.length > 0 ? serialized : [{ [INFO_KEY]: '', [COLS_KEY]: colsJson }];
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/record-sheets/${templateKey}`,
        {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ rows: payloadRows }),
        }
      );
      if (res.ok) {
        setSavedAt(Date.now());
      } else {
        setError('保存に失敗しました');
      }
    } catch (err) {
      console.error('Failed to save CRUOA matrix:', err);
      setError('保存中にエラーが発生しました');
    } finally {
      setSaving(false);
    }
  };

  // ===== 診断（二重管理 / 属人化）=====
  const diagnostics = useMemo(() => {
    const dupManage: string[] = []; // 二重管理（C/U が複数ロール）
    const personDependent: string[] = []; // 属人化（C が1ロールのみ）
    for (const row of rows) {
      const info = row.info.trim();
      if (!info) continue;
      const creators: string[] = [];
      const writers: string[] = []; // C または U
      for (const col of cols) {
        const tags = parseTags(row.cells[col.id]);
        if (tags.includes('C')) creators.push(col.label);
        if (tags.includes('C') || tags.includes('U')) writers.push(col.label);
      }
      if (writers.length >= 2) {
        dupManage.push(`${info}（${writers.join(' / ')} が作成・更新）`);
      }
      if (creators.length === 1) {
        personDependent.push(`${info}（作成: ${creators[0]} のみ）`);
      }
    }
    return { dupManage, personDependent };
  }, [rows, cols]);

  // 行の C/U 重複セル（ハイライト用）
  const dupRowSet = useMemo(() => {
    const set = new Set<number>();
    rows.forEach((row, i) => {
      let writers = 0;
      for (const col of cols) {
        const tags = parseTags(row.cells[col.id]);
        if (tags.includes('C') || tags.includes('U')) writers++;
      }
      if (writers >= 2) set.add(i);
    });
    return set;
  }, [rows, cols]);

  return (
    <div className="space-y-3">
      {/* 凡例 + ツールバー */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-600">
          <span className="font-medium text-gray-500">凡例:</span>
          {CRUOA_TAGS.map((t) => (
            <span
              key={t}
              className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${TAG_COLOR[t]}`}
            >
              <strong>{t}</strong>
              {TAG_LABEL[t]}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={addCol} className="gap-1.5">
            <Plus className="h-4 w-4" />
            列（ロール）を追加
          </Button>
          <Button variant="outline" size="sm" onClick={addRow} className="gap-1.5">
            <Plus className="h-4 w-4" />
            情報項目を追加
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
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 診断（二重管理 / 属人化）*/}
      {(diagnostics.dupManage.length > 0 || diagnostics.personDependent.length > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {diagnostics.dupManage.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                二重管理・転記リスク（複数ロールが C/U）
              </div>
              <ul className="mt-1.5 list-disc list-inside space-y-0.5 text-xs text-amber-700">
                {diagnostics.dupManage.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
          {diagnostics.personDependent.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <div className="flex items-center gap-1.5 text-sm font-medium text-rose-800">
                <UserX className="h-4 w-4" />
                属人化リスク（作成者が1ロールのみ）
              </div>
              <ul className="mt-1.5 list-disc list-inside space-y-0.5 text-xs text-rose-700">
                {diagnostics.personDependent.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-[240px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-600 min-w-[180px]">
                      情報項目
                    </th>
                    {cols.map((col) => (
                      <th
                        key={col.id}
                        className="px-2 py-2 text-left text-xs font-semibold text-gray-600 min-w-[150px]"
                      >
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={col.label}
                            onChange={(e) => updateColLabel(col.id, e.target.value)}
                            className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold text-gray-700 hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none"
                            title={col.roleId ? 'ロール列' : '自由列'}
                          />
                          <button
                            type="button"
                            onClick={() => deleteCol(col.id)}
                            className="shrink-0 rounded p-0.5 text-gray-300 hover:text-red-600 hover:bg-red-50"
                            title="この列を削除"
                            aria-label="この列を削除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </th>
                    ))}
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => {
                    const isDup = dupRowSet.has(rowIndex);
                    return (
                      <tr
                        key={rowIndex}
                        className={`border-b border-gray-100 ${
                          isDup ? 'bg-amber-50/40' : 'hover:bg-gray-50/50'
                        }`}
                      >
                        <td className="sticky left-0 z-10 bg-inherit px-2 py-1 align-middle">
                          <Input
                            value={row.info}
                            onChange={(e) => updateInfo(rowIndex, e.target.value)}
                            placeholder="例: 過去需要データ"
                            className="h-8 border-transparent bg-transparent text-sm hover:border-gray-200 focus:border-blue-400 focus:bg-white"
                          />
                        </td>
                        {cols.map((col) => {
                          const tags = parseTags(row.cells[col.id]);
                          return (
                            <td key={col.id} className="px-2 py-1 align-middle">
                              <div className="flex flex-wrap gap-0.5">
                                {CRUOA_TAGS.map((tag) => {
                                  const on = tags.includes(tag);
                                  return (
                                    <button
                                      key={tag}
                                      type="button"
                                      onClick={() => toggleTag(rowIndex, col.id, tag)}
                                      title={`${tag}=${TAG_LABEL[tag]}`}
                                      className={`h-6 w-6 rounded border text-xs font-bold transition-colors ${
                                        on
                                          ? TAG_COLOR[tag]
                                          : 'border-gray-200 text-gray-300 hover:border-gray-300 hover:text-gray-500'
                                      }`}
                                    >
                                      {tag}
                                    </button>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        })}
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
                    );
                  })}

                  {rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={cols.length + 2}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ情報項目がありません。「情報項目を追加」から始めましょう（行=情報項目、列=ロール、セルに C/R/U/O/A を付与）。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
              {rows.length} 情報項目 / {cols.length} ロール列 ・ セルのチップで C/R/U/O/A を複数選択
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
