'use client';

// 汎用の編集可能テーブルボード。
//
// Risk スライス（risk-table-board.tsx）の UX を踏襲した、行クリックで全項目を
// 編集できるモーダル付きの実テーブル。ASIS/TOBE のメモ系（AsisMemo /
// TobeVision / TobeRoadmap）のように「列定義 + 専用 CRUD API」を渡すだけで
// 動く軽量版。
//
// 使い方:
//   <EditableMemoBoard
//     projectId={projectId}
//     api={asisMemoApi}
//     columns={[{ key: 'topic', label: '項目' }, ...]}
//     entityLabel="現状メモ"
//   />

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, Trash2, Plus, X, Save } from 'lucide-react';

/** ボードが扱う行の最低限の形（id + order）。 */
export interface MemoRow {
  id: string;
  order: number;
}

/** select 列の選択肢（value は保存される ID、空文字は「未選択」）。 */
export interface MemoSelectOption {
  value: string;
  label: string;
}

/**
 * 列定義。kind を省略すると 'text'（複数行は 'multiline'）。
 * kind='select' のときは options（ID→ラベル）を渡す。空文字 value で「未選択」を表す。
 */
export interface MemoColumn<T> {
  key: keyof T & string;
  label: string;
  kind?: 'text' | 'multiline' | 'select';
  /** kind='select' の選択肢。先頭に「未選択(空文字)」相当を含めず、本体が自動で付与する。 */
  options?: MemoSelectOption[];
  /** select の「未選択」表示ラベル（既定: 「未選択」）。 */
  emptyLabel?: string;
}

/** 渡される CRUD クライアント（asis-tobe.ts の各 api と互換）。 */
export interface MemoApi<T, TInput> {
  list(projectId: string): Promise<T[]>;
  create(projectId: string, input: TInput): Promise<T>;
  update(id: string, input: TInput): Promise<T>;
  remove(id: string): Promise<void>;
}

type Draft = Record<string, string>;

function rowToDraft<T extends MemoRow>(
  row: T | null,
  columns: MemoColumn<T>[],
): Draft {
  const d: Draft = {};
  const rec = row as Record<string, unknown> | null;
  for (const c of columns) {
    const v = rec ? rec[c.key] : '';
    d[c.key] = v == null ? '' : String(v);
  }
  return d;
}

function draftToInput<T extends MemoRow, TInput>(
  d: Draft,
  columns: MemoColumn<T>[],
): TInput {
  const input: Record<string, string | null> = {};
  for (const c of columns) {
    const v = (d[c.key] ?? '').trim();
    input[c.key] = v === '' ? null : v;
  }
  return input as TInput;
}

export function EditableMemoBoard<T extends MemoRow, TInput>({
  projectId,
  api,
  columns,
  entityLabel,
}: {
  projectId: string;
  api: MemoApi<T, TInput>;
  columns: MemoColumn<T>[];
  /** 「○○を追加」「○○を削除しますか？」等に使う名称。 */
  entityLabel: string;
}) {
  const { rows, loading, error, reload, setRows } = useMemoData(
    projectId,
    api,
  );

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 編集モーダル（編集 or 新規追加）。editId=null かつ open=true で新規。
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const openEdit = (id: string) => {
    setEditId(id);
    setDraft(rowToDraft(byId.get(id) ?? null, columns));
    setActionError(null);
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditId(null);
    setDraft(rowToDraft(null, columns));
    setActionError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditId(null);
  };

  const setDraftField = (key: string, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSaveModal = async () => {
    const input = draftToInput<T, TInput>(draft, columns);
    setSaving(true);
    setActionError(null);
    try {
      if (editId) {
        await api.update(editId, input);
      } else {
        await api.create(projectId, { ...input, order: rows.length } as TInput);
      }
      await reload();
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`この${entityLabel}を削除しますか？`)) return;
    setActionError(null);
    // 楽観削除（失敗時はreload）。
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      await api.remove(id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '削除に失敗しました');
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          1行ずつ管理します。行をクリックすると全項目を編集できます。
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          行を追加
        </button>
      </div>

      {(error || actionError) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error || actionError}
        </div>
      )}

      {/* 一覧テーブル */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                    #
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="min-w-[110px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-600"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="w-12 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr
                    key={r.id}
                    onClick={() => openEdit(r.id)}
                    className="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
                    title="クリックして編集"
                  >
                    <td className="px-2 py-2 align-middle text-xs text-gray-400">
                      {i + 1}
                    </td>
                    {columns.map((col) => {
                      const raw =
                        ((r as Record<string, unknown>)[col.key] as
                          | string
                          | null) ?? '';
                      // select 列は ID ではなく対応するラベルを表示する。
                      const display =
                        col.kind === 'select'
                          ? (col.options?.find((o) => o.value === raw)?.label ??
                            '')
                          : raw;
                      return (
                        <td
                          key={col.key}
                          className="max-w-[260px] px-3 py-2 align-middle text-gray-900"
                        >
                          {display ? (
                            <span className="line-clamp-2 whitespace-pre-wrap break-words">
                              {display}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td
                      className="px-2 py-2 text-center align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id)}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title={`この${entityLabel}を削除`}
                        aria-label={`この${entityLabel}を削除`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + 2}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      まだ{entityLabel}がありません。「行を追加」から登録を始めましょう。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 編集／追加モーダル（全項目） */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeModal}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-[#050f3e]">
                {editId ? `${entityLabel}を編集` : `${entityLabel}を追加`}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[60vh] space-y-3 overflow-auto px-5 py-4">
              {columns.map((col) => {
                const value = draft[col.key] ?? '';
                return (
                  <div key={col.key} className="space-y-1">
                    <label className="flex items-center justify-between text-[11px] font-medium text-gray-500">
                      <span>{col.label}</span>
                    </label>
                    {col.kind === 'select' ? (
                      <select
                        value={value}
                        onChange={(e) => setDraftField(col.key, e.target.value)}
                        className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">{col.emptyLabel ?? '未選択'}</option>
                        {(col.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : col.kind === 'text' ? (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => setDraftField(col.key, e.target.value)}
                        placeholder={col.label}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <textarea
                        value={value}
                        onChange={(e) => setDraftField(col.key, e.target.value)}
                        rows={2}
                        placeholder={col.label}
                        className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>
                );
              })}
              {actionError && (
                <p className="text-xs text-rose-600">{actionError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-[#050f3e] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// データ読み込みフック
// ---------------------------------------------------------------------------

function useMemoData<T extends MemoRow, TInput>(
  projectId: string,
  api: MemoApi<T, TInput>,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await api.list(projectId);
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [projectId, api]);

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

  return { rows, loading, error, reload, setRows };
}
