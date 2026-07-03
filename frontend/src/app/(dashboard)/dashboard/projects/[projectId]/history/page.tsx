'use client';

/**
 * 変更履歴ページ。
 *
 * GET /api/projects/:projectId/change-logs（自動記録された書き込み操作の履歴）を
 * 新しい順に一覧表示する。
 * - 列: 時刻 / 操作者(email) / 対象（entity の和名）/ アクションバッジ / 内容(summary)
 * - 失敗（4xx/5xx）の行はグレー・打消し気味に表示する
 * - フィルタ: 対象種別 select ＋ アクション select。「更新」で再取得。
 * - ヘッダークリックで列ソート（昇順 → 降順 → 解除で新しい順に戻る）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  History,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

/** 変更履歴1件（backend ChangeLog テーブルのレコード）。 */
interface ChangeLogRow {
  id: string;
  projectId: string | null;
  userId: string | null;
  userEmail: string | null;
  method: string;
  path: string;
  entity: string | null;
  action: string | null; // CREATE / UPDATE / DELETE
  summary: string | null;
  /** リクエストボディ（秘匿情報は [REDACTED]・JSON文字列。null のことも） */
  body: string | null;
  statusCode: number | null;
  createdAt: string;
}

/** 閲覧権限なし（管理者限定）を表すフラグ付きエラー。 */
class ForbiddenHistoryError extends Error {}

async function listChangeLogs(projectId: string): Promise<ChangeLogRow[]> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/change-logs?limit=300`, {
    headers: headers(),
  });
  if (res.status === 403) {
    throw new ForbiddenHistoryError(
      '操作履歴の閲覧は会社管理者・すべての管理者のみ可能です。',
    );
  }
  if (!res.ok) throw new Error('変更履歴の取得に失敗しました');
  return res.json();
}

/** JSON 文字列を読みやすく整形（失敗時はそのまま返す）。 */
function prettyJson(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// 表示用メタ（entity 和名 / アクションバッジ）
// ---------------------------------------------------------------------------

/** entity（URL のリソース名）→ 和名。未知の entity はそのまま表示する。 */
const ENTITY_LABELS: Record<string, string> = {
  'business-flows': '業務フロー',
  tasks: 'タスク',
  risks: 'リスク',
  meetings: '会議',
  'gap-items': 'GAP',
  stakeholders: 'ステークホルダー',
  'sub-projects': '領域',
  'information-types': 'INPUT/OUTPUT',
  roles: 'ロール',
  systems: 'システム',
  constraints: '制約条件',
  'tobe-visions': 'あるべき姿',
  'tobe-roadmaps': '段階設計',
  'roadmap-phases': '段階設計フェーズ',
  'issue-trees': '課題ツリー',
  'issue-nodes': '課題ツリー',
  annotations: '付箋',
  charter: '背景・目的',
  requirements: '要求定義',
  attachments: '添付ファイル',
  'risk-categories': 'リスク種別',
  'report-calendars': '会議・報告',
  'interest-rows': '関心ごと',
  projects: 'プロジェクト',
  // 参考マスタ
  suppliers: 'サプライヤー',
  products: '製品',
  'demand-data': '需要データ',
  // 現状把握・計画
  'asis-memos': '現状メモ',
  phases: 'フェーズ',
  'flow-folders': 'フローフォルダ',
  'stakeholder-assignments': '担当割当',
  'gap-ledgers': 'GAP管理簿',
  // タスクのサブリソース（/api/tasks/:id/comments 等）
  'task-comments': 'タスクコメント',
  comments: 'タスクコメント',
  dependencies: 'タスク依存',
  // 業務フローのサブリソース（/api/business-flows/:flowId/... 等）
  definition: '業務定義',
  cruoa: 'CRUOA表',
  nodes: 'ノード',
  edges: '接続線',
  positions: 'ノード配置',
  snapshots: 'スナップショット',
  restore: 'フロー復元',
  'import-mermaid': 'フロー取込',
  'child-flow': '子フロー',
  links: '入出力リンク',
  'node-links': '入出力リンク',
  'information-links': '入出力リンク',
  // DFD
  dfd: 'DFD',
  'dfd-diagrams': 'DFD',
  'dfd-nodes': 'DFDノード',
  'dfd-flows': 'DFDフロー',
  // 分析（パレート / 感度 / GAP / 漏れ）
  'analysis-pareto': '分析(パレート)',
  'analysis-sensitivity': '分析(感度)',
  'analysis-gap': '分析(GAP)',
  'analysis-leak': '分析(漏れ)',
  // テーブル定義
  tables: 'テーブル',
  columns: 'カラム',
  'crud-mappings': 'CRUD紐づけ',
};

function entityLabel(entity: string | null): string {
  if (!entity) return '—';
  return ENTITY_LABELS[entity] ?? entity;
}

/** 1ページあたりの表示件数。 */
const PAGE_SIZE = 50;

/** アクションバッジ（作成=emerald / 更新=blue / 削除=rose）。 */
const ACTION_META: Record<string, { label: string; badge: string }> = {
  CREATE: { label: '作成', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  UPDATE: { label: '更新', badge: 'border-blue-200 bg-blue-50 text-blue-700' },
  DELETE: { label: '削除', badge: 'border-rose-200 bg-rose-50 text-rose-700' },
};

/** ISO 日時を YYYY/MM/DD HH:mm 表示にする（不正値・null は '—'）。 */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 4xx/5xx は失敗扱い（グレー・打消し気味に表示）。 */
function isFailed(statusCode: number | null): boolean {
  return statusCode != null && statusCode >= 400;
}

// ヘッダーソート用 accessor（表示値ベースで比較。未設定値は末尾）。
// ソート解除時は従来の並び（サーバー返却の新しい順）に戻る。
const SORT_ACCESSORS: Record<
  string,
  (log: ChangeLogRow) => string | number | null | undefined
> = {
  createdAt: (log) => {
    const t = new Date(log.createdAt).getTime();
    return Number.isNaN(t) ? null : t;
  },
  userEmail: (log) => log.userEmail ?? null,
  entity: (log) => (log.entity ? entityLabel(log.entity) : null),
  action: (log) => (log.action ? (ACTION_META[log.action]?.label ?? log.action) : null),
  summary: (log) => log.summary ?? null,
};

export default function HistoryPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [logs, setLogs] = useState<ChangeLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フィルタ（対象種別 / アクション）。空文字 = すべて。
  const [entityFilter, setEntityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  // 閲覧権限なし（管理者限定）の判定。
  const [forbidden, setForbidden] = useState(false);
  // body を展開表示している行 id。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setForbidden(false);
    try {
      const rows = await listChangeLogs(projectId);
      setLogs(rows);
    } catch (e) {
      if (e instanceof ForbiddenHistoryError) {
        setForbidden(true);
        setLogs([]);
      } else {
        setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      }
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // 取得済みログに登場する entity の選択肢（和名でソート）。
  const entityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const log of logs) {
      if (log.entity) set.add(log.entity);
    }
    return Array.from(set).sort((a, b) =>
      entityLabel(a).localeCompare(entityLabel(b), 'ja'),
    );
  }, [logs]);

  const filtered = useMemo(
    () =>
      logs.filter(
        (log) =>
          (!entityFilter || log.entity === entityFilter) &&
          (!actionFilter || log.action === actionFilter),
      ),
    [logs, entityFilter, actionFilter],
  );

  // ヘッダークリックソート（昇順 → 降順 → 解除で新しい順に戻る）
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filtered, SORT_ACCESSORS);

  // ページネーション（クライアント側。取得済みの sorted を 50 件ずつ分割）。
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage],
  );
  // フィルタ／ソート変更で件数が変わったら 1 ページ目へ戻す。
  useEffect(() => {
    setPage(1);
  }, [entityFilter, actionFilter, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            変更履歴
          </span>
        }
        description="このプロジェクトに対する作成・更新・削除の操作が自動で記録されます。「いつ・誰が・何を・どんな内容で」変更したかを確認できます（会社管理者・すべての管理者のみ閲覧可）。"
        help="各画面での書き込み操作（作成・更新・削除）はサーバー側で自動記録されます（操作者・リクエスト内容を含む。パスワード等の機微情報は[REDACTED]でマスク）。「内容を表示」で送信内容を展開できます。失敗した操作（4xx/5xx）はグレーの打消し表示になります。閲覧は会社管理者・すべての管理者に限定されています。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                'この一覧は自動記録です。各画面で作成・更新・削除を行うと、その操作が自動でここに残ります。',
                '「対象種別」プルダウンで、業務フロー・タスクなど対象を絞り込みます。',
                '「アクション」プルダウンで、作成／更新／削除を絞り込みます。',
                '最新の操作を反映するには「更新」ボタンを押します。',
                'グレーで打ち消し表示されている行は、失敗した（エラーになった）操作です。',
              ]}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="gap-1.5"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              更新
            </Button>
          </>
        }
      />

      {/* フィルタ */}
      <Card className="bg-white border-gray-200">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">対象種別</label>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="min-w-[180px] rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="対象種別で絞り込み"
            >
              <option value="">すべて</option>
              {entityOptions.map((e) => (
                <option key={e} value={e}>
                  {entityLabel(e)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">アクション</label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="min-w-[120px] rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              aria-label="アクションで絞り込み"
            >
              <option value="">すべて</option>
              <option value="CREATE">作成</option>
              <option value="UPDATE">更新</option>
              <option value="DELETE">削除</option>
            </select>
          </div>
          <p className="ml-auto text-xs text-gray-400">
            {filtered.length} / {logs.length} 件（最新 300 件まで）
          </p>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 一覧 */}
      {forbidden ? (
        <Card className="bg-white border-amber-200">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <History className="h-8 w-8 text-amber-400" />
            <p className="text-sm font-medium text-gray-700">
              操作履歴は会社管理者・すべての管理者のみ閲覧できます
            </p>
            <p className="text-xs text-gray-400">
              閲覧が必要な場合は、会社の管理者にお問い合わせください。
            </p>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <SortableTh
                      label="時刻"
                      sortKey="createdAt"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="w-36 text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="操作者"
                      sortKey="userEmail"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[160px] text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="対象"
                      sortKey="entity"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="w-36 text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="アクション"
                      sortKey="action"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="w-20 text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="内容"
                      sortKey="summary"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[200px] text-left text-xs font-semibold text-gray-600"
                    />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((log) => {
                    const failed = isFailed(log.statusCode);
                    const meta = log.action ? ACTION_META[log.action] : undefined;
                    return (
                      <tr
                        key={log.id}
                        className={`border-b border-gray-100 align-top ${
                          failed ? 'bg-gray-50/60 text-gray-400' : ''
                        }`}
                        title={failed ? `失敗（HTTP ${log.statusCode}）: ${log.path}` : log.path}
                      >
                        <td
                          className={`whitespace-nowrap px-3 py-2 font-mono text-xs ${
                            failed ? 'text-gray-400' : 'text-gray-500'
                          }`}
                        >
                          {fmtDateTime(log.createdAt)}
                        </td>
                        <td
                          className={`px-3 py-2 text-sm ${
                            failed ? 'text-gray-400 line-through' : 'text-gray-700'
                          }`}
                        >
                          {log.userEmail || '—'}
                        </td>
                        <td
                          className={`px-3 py-2 text-sm ${
                            failed ? 'text-gray-400 line-through' : 'text-gray-700'
                          }`}
                        >
                          {entityLabel(log.entity)}
                        </td>
                        <td className="px-3 py-2">
                          {meta ? (
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                                failed
                                  ? 'border-gray-200 bg-gray-100 text-gray-400 line-through'
                                  : meta.badge
                              }`}
                            >
                              {meta.label}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                          {failed && (
                            <span className="ml-1.5 align-middle text-[10px] font-medium text-gray-400">
                              失敗
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-3 py-2 text-sm ${
                            failed ? 'text-gray-400 line-through' : 'text-gray-600'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="line-clamp-2">{log.summary || '—'}</span>
                            {log.body && (
                              <button
                                type="button"
                                onClick={() => toggleExpand(log.id)}
                                className="shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 hover:bg-gray-50"
                                title="リクエスト内容（body）を表示"
                              >
                                {expanded.has(log.id) ? '内容を隠す' : '内容を表示'}
                              </button>
                            )}
                          </div>
                          {expanded.has(log.id) && log.body && (
                            <pre className="mt-1.5 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-[11px] leading-snug text-gray-700">
                              {prettyJson(log.body)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">
                        {logs.length === 0
                          ? 'まだ変更履歴がありません。各画面で作成・更新・削除を行うと自動で記録されます。'
                          : '条件に一致する履歴がありません。フィルタを変更してください。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {sorted.length > PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-3">
                <span className="text-xs text-gray-500">
                  {(safePage - 1) * PAGE_SIZE + 1}–
                  {Math.min(safePage * PAGE_SIZE, sorted.length)} / {sorted.length} 件
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                    className="gap-1"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    前へ
                  </Button>
                  <span className="px-2 text-xs text-gray-600">
                    {safePage} / {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= pageCount}
                    onClick={() => setPage(safePage + 1)}
                    className="gap-1"
                  >
                    次へ
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
