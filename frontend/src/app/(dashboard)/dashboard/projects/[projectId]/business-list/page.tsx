'use client';

/**
 * 業務一覧。
 *
 * ステークホルダーの担当者を ASIS 業務に紐づけ、ASIS 起点で対応する TOBE・GAP を
 * 一覧する。集約エンドポイントは作らず、既存3エンドポイント
 * （業務フロー / GAP / ステークホルダー）をフロントで結合する（@/lib/business-list）。
 *
 * - 担当者: チップ（×で外す）＋「選択」ポップオーバ（全ステークホルダーのチェックボックス）。
 *   トグルは楽観更新 → setFlowStakeholders で保存、失敗時は reload で巻き戻す。
 * - 対応TOBE / GAP: 件数バッジをクリックで行内展開（各 TOBE はフローへ、GAP は GAP一覧へリンク）。
 * - ヘッダークリックで列ソート（担当者・名前・TOBE件数・GAP件数。useTableSort + SortableTh）。
 * - 編集系コントロールは canEdit でゲート（閲覧専用時はチップのみ表示）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, ListChecks, Users, GitCompare } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { SortableTh } from '@/components/ui/sortable-th';
import { useTableSort } from '@/lib/use-table-sort';
import { useReadOnly } from '@/components/read-only-context';
import {
  buildBusinessList,
  listProjectFlows,
  listGapItemsRaw,
  setFlowStakeholders,
  type BusinessListRow,
} from '@/lib/business-list';
import { listStakeholders, type Stakeholder } from '@/lib/stakeholders';

/** GAP 優先度バッジの配色。 */
function priorityBadgeClasses(priority: string | null | undefined): string {
  const p = (priority ?? '').toUpperCase();
  if (p === 'HIGH') return 'bg-rose-100 text-rose-700';
  if (p === 'MEDIUM') return 'bg-amber-100 text-amber-700';
  if (p === 'LOW') return 'bg-emerald-100 text-emerald-700';
  return 'bg-gray-100 text-gray-500';
}

export default function BusinessListPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [rows, setRows] = useState<BusinessListRow[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 行内のポップオーバ・展開状態（ASIS フローID で管理）。
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [openTobe, setOpenTobe] = useState<Record<string, boolean>>({});
  const [openGap, setOpenGap] = useState<Record<string, boolean>>({});
  // 担当者保存中の行（連打レース防止＝保存完了まで同じ行の操作を無効化）。
  const [savingId, setSavingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [flows, gaps, sh] = await Promise.all([
        listProjectFlows(projectId),
        listGapItemsRaw(projectId),
        listStakeholders(projectId),
      ]);
      setRows(buildBusinessList(flows, gaps));
      setStakeholders(sh);
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

  const stakeholderById = useMemo(
    () => new Map(stakeholders.map((s) => [s.id, s])),
    [stakeholders],
  );
  const hasStakeholders = stakeholders.length > 0;

  // ソート accessor（未割当の担当者は null で常に末尾＝昇順/降順とも、件数は数値比較）。
  const sortAccessors = useMemo(
    () => ({
      assignee: (r: BusinessListRow) => r.asis.assignees?.[0]?.name ?? null,
      name: (r: BusinessListRow) => r.asis.name,
      tobeCount: (r: BusinessListRow) => r.tobes.length,
      gapCount: (r: BusinessListRow) => r.gaps.length,
    }),
    [],
  );

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(
    rows,
    sortAccessors,
  );

  // 担当者トグル（楽観更新 → 保存、失敗時は reload で巻き戻す）。
  const toggleAssignee = async (row: BusinessListRow, stakeholderId: string) => {
    // 同じ行の保存中は連打を無視（replace-all の取りこぼし防止）。
    if (savingId === row.asis.id) return;
    setSavingId(row.asis.id);
    const cur = (row.asis.assignees ?? []).map((a) => a.stakeholderId);
    const nextIds = cur.includes(stakeholderId)
      ? cur.filter((x) => x !== stakeholderId)
      : [...cur, stakeholderId];
    setRows((prev) =>
      prev.map((r) =>
        r.asis.id === row.asis.id
          ? {
              ...r,
              asis: {
                ...r.asis,
                assignees: nextIds.map((id, i) => ({
                  stakeholderId: id,
                  name: stakeholderById.get(id)?.name ?? '',
                  order: i,
                })),
              },
            }
          : r,
      ),
    );
    try {
      const { assignees } = await setFlowStakeholders(row.asis.id, nextIds);
      setRows((prev) =>
        prev.map((r) =>
          r.asis.id === row.asis.id
            ? { ...r, asis: { ...r.asis, assignees } }
            : r,
        ),
      );
    } catch {
      setError('担当者の保存に失敗しました');
      await reload();
    } finally {
      setSavingId((cur) => (cur === row.asis.id ? null : cur));
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
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <ListChecks className="h-5 w-5 text-blue-600" />
            業務一覧
          </span>
        }
        description="ステークホルダーの担当者を業務に紐づけ、ASIS起点で対応するTOBE・GAPを一覧します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
      />

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="px-4 py-12 text-center">
            <p className="text-sm text-gray-500">
              ASIS業務フローがまだありません。
            </p>
            <Link
              href={`/dashboard/projects/${projectId}/asis`}
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              <ClipboardLinkIcon />
              ASIS管理でフローを作成
            </Link>
          </CardContent>
        </Card>
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
                    <SortableTh
                      label="担当者"
                      sortKey="assignee"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[220px] bg-blue-50 text-left text-xs font-semibold text-blue-700"
                    />
                    <SortableTh
                      label="ASIS業務フロー名"
                      sortKey="name"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[220px] text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="対応TOBE"
                      sortKey="tobeCount"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[160px] text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="GAP"
                      sortKey="gapCount"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[160px] text-left text-xs font-semibold text-gray-600"
                    />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const assignees = r.asis.assignees ?? [];
                    const tobeExpanded = !!openTobe[r.asis.id];
                    const gapExpanded = !!openGap[r.asis.id];
                    return (
                      <tr
                        key={r.asis.id}
                        className="border-b border-gray-100 align-top hover:bg-gray-50/50"
                      >
                        <td className="px-2 py-2 align-middle text-xs text-gray-400">
                          {i + 1}
                        </td>

                        {/* 担当者（チップ + 複数選択ポップオーバ） */}
                        <td className="bg-blue-50/40 px-2 py-2 align-top">
                          <div className="flex flex-wrap gap-1">
                            {assignees.length === 0 && (
                              <span className="text-xs text-gray-400">
                                未割当
                              </span>
                            )}
                            {assignees.map((a) => (
                              <span
                                key={a.stakeholderId}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
                              >
                                {a.name ||
                                  stakeholderById.get(a.stakeholderId)?.name ||
                                  '（不明）'}
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleAssignee(r, a.stakeholderId)
                                    }
                                    className="text-blue-500 hover:text-blue-800"
                                    aria-label="外す"
                                  >
                                    ×
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                          {canEdit && (
                            <div className="relative mt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenPicker(
                                    openPicker === r.asis.id ? null : r.asis.id,
                                  )
                                }
                                disabled={!hasStakeholders || savingId === r.asis.id}
                                className="flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-[11px] text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Users className="h-3 w-3" />
                                選択
                              </button>
                              {openPicker === r.asis.id && hasStakeholders && (
                                <>
                                  <button
                                    type="button"
                                    aria-label="閉じる"
                                    onClick={() => setOpenPicker(null)}
                                    className="fixed inset-0 z-10 cursor-default"
                                  />
                                  <div className="absolute z-20 mt-1 max-h-56 w-60 overflow-y-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
                                    {stakeholders.map((s) => {
                                      const checked = assignees.some(
                                        (a) => a.stakeholderId === s.id,
                                      );
                                      return (
                                        <label
                                          key={s.id}
                                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={savingId === r.asis.id}
                                            onChange={() =>
                                              toggleAssignee(r, s.id)
                                            }
                                            className="h-3.5 w-3.5"
                                          />
                                          <span className="flex-1 text-gray-800">
                                            {s.name}
                                          </span>
                                          {s.role && (
                                            <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-500">
                                              {s.role}
                                            </span>
                                          )}
                                        </label>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                              {!hasStakeholders && (
                                <p className="mt-1 text-[10px] text-gray-400">
                                  ステークホルダー未登録
                                </p>
                              )}
                            </div>
                          )}
                        </td>

                        {/* ASIS業務フロー名（フローへリンク） */}
                        <td className="px-3 py-2 align-top">
                          <Link
                            href={`/dashboard/projects/${projectId}/flows/${r.asis.id}`}
                            className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            {r.asis.name}
                          </Link>
                        </td>

                        {/* 対応TOBE（件数バッジ → 行内展開） */}
                        <td className="px-3 py-2 align-top">
                          {r.tobes.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenTobe((prev) => ({
                                    ...prev,
                                    [r.asis.id]: !prev[r.asis.id],
                                  }))
                                }
                                className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-200"
                              >
                                {r.tobes.length} 件
                              </button>
                              {tobeExpanded && (
                                <ul className="space-y-0.5">
                                  {r.tobes.map((t) => (
                                    <li key={t.id}>
                                      <Link
                                        href={`/dashboard/projects/${projectId}/flows/${t.id}`}
                                        className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                                      >
                                        {t.name}
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </td>

                        {/* GAP（件数バッジ → 行内展開） */}
                        <td className="px-3 py-2 align-top">
                          {r.gaps.length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenGap((prev) => ({
                                    ...prev,
                                    [r.asis.id]: !prev[r.asis.id],
                                  }))
                                }
                                className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700 hover:bg-rose-200"
                              >
                                <GitCompare className="h-3 w-3" />
                                {r.gaps.length} 件
                              </button>
                              {gapExpanded && (
                                <div className="space-y-1">
                                  <ul className="space-y-1">
                                    {r.gaps.map((g) => (
                                      <li
                                        key={g.id}
                                        className="flex items-start gap-1.5 text-xs text-gray-700"
                                      >
                                        <span
                                          className={`mt-0.5 shrink-0 rounded px-1 text-[10px] font-medium ${priorityBadgeClasses(
                                            g.priority,
                                          )}`}
                                        >
                                          {(g.priority ?? '—').toUpperCase()}
                                        </span>
                                        <span className="flex-1">
                                          {g.gapDescription || '（内容未記入）'}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                  <Link
                                    href={`/dashboard/projects/${projectId}/gap-items`}
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                  >
                                    GAP一覧へ
                                  </Link>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-400">{rows.length} 業務（ASIS）</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** 空状態リンク用の小アイコン（lucide ClipboardList を流用）。 */
function ClipboardLinkIcon() {
  return <ListChecks className="h-4 w-4" />;
}
