'use client';

import { Fragment, useCallback, useEffect, useImperativeHandle, useState, forwardRef } from 'react';
import {
  Loader2,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Cog,
  ChevronDown,
  ChevronRight,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';
import { listJobs, resumeJob, type Job, type JobStatus } from '@/lib/jobs';
import { retryKnowledgeDocumentPage } from '@/lib/knowledge';

// ---- ステータスバッジのメタ（integrations の SyncRun テーブルと同系統の見た目） ----
const statusMeta: Record<JobStatus, { label: string; badge: string }> = {
  QUEUED: { label: 'QUEUED', badge: 'text-gray-600 bg-gray-50 border-gray-300' },
  RUNNING: { label: 'RUNNING', badge: 'text-blue-700 bg-blue-50 border-blue-300' },
  SUCCEEDED: { label: 'SUCCEEDED', badge: 'text-emerald-700 bg-emerald-50 border-emerald-300' },
  FAILED: { label: 'FAILED', badge: 'text-red-700 bg-red-50 border-red-300' },
};

// ---- ジョブ種別の日本語表示 ----
const typeMeta: Record<string, string> = {
  AI_MERMAID_OBJECTMAP: 'Mermaid → オブジェクト関係性マップ',
  AI_MERMAID_FLOW: 'Mermaid → 業務フロー',
  AI_KPI: 'KPI 生成',
  AI_ISSUE_SUGGEST: '課題ノード提案',
  KG_INGEST_FILE: '資料取り込み',
  KG_INGEST_PAGE: 'ページ抽出',
  KG_MERGE_INGEST_FILE: 'ページ結果の統合',
};

function typeLabel(type: string): string {
  return typeMeta[type] ?? type;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// 日時文字列をソート用の数値（エポックms）に変換する。未設定・不正値は null（末尾送り）。
function dateSortValue(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

const JOB_SORT_ACCESSORS: Record<string, (job: Job) => string | number | null | undefined> = {
  status: (job) => (statusMeta[job.status] ?? statusMeta.QUEUED).label,
  type: (job) => typeLabel(job.type),
  progress: (job) => job.progress,
  result: (job) => {
    const text = job.status === 'FAILED' && job.error ? job.error : null;
    return text ?? null;
  },
  createdAt: (job) => dateSortValue(job.createdAt),
  finishedAt: (job) => dateSortValue(job.finishedAt),
};

export interface BackgroundJobsPanelHandle {
  /** 一覧を再取得する（ジョブ起票後などに親から呼ぶ）。 */
  refresh: () => void;
}

function StatusBadge({ job }: { job: Job }) {
  const sm = statusMeta[job.status] ?? statusMeta.QUEUED;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-medium ${sm.badge}`}
    >
      {job.status === 'RUNNING' && <Loader2 className="h-3 w-3 animate-spin" />}
      {job.status === 'SUCCEEDED' && <CheckCircle2 className="h-3 w-3" />}
      {job.status === 'FAILED' && <AlertCircle className="h-3 w-3" />}
      {sm.label}
    </span>
  );
}

function JobsTable({
  jobs,
  busyId,
  onResume,
  onRetryPage,
}: {
  jobs: Job[];
  busyId: string | null;
  onResume: (job: Job) => void;
  onRetryPage: (job: Job) => void;
}) {
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(jobs, JOB_SORT_ACCESSORS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const thClass = 'font-medium border-b border-gray-200';
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-600">
            <SortableTh
              label="状態"
              sortKey="status"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[120px]`}
            >
              <HelpTooltip text="ジョブの状態。QUEUED（待機）→RUNNING（実行中）→SUCCEEDED（成功）またはFAILED（失敗）。FAILED時は結果欄に失敗理由が表示されます。" />
            </SortableTh>
            <SortableTh
              label="種別"
              sortKey="type"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={thClass}
            />
            <SortableTh
              label="進捗"
              sortKey="progress"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[90px]`}
            />
            <SortableTh
              label="結果"
              sortKey="result"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={thClass}
            />
            <SortableTh
              label="起票"
              sortKey="createdAt"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[150px]`}
            />
            <SortableTh
              label="完了"
              sortKey="finishedAt"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[150px]`}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((job) => {
            const children = job.children ?? [];
            const pageChildren = children.filter((child) => child.knowledgePage);
            const succeeded = pageChildren.filter(
              (child) => child.knowledgePage?.status === 'SUCCEEDED',
            ).length;
            const isOpen = expanded.has(job.id);
            const canResume =
              job.type === 'KG_INGEST_FILE' &&
              (job.status === 'FAILED' ||
                pageChildren.some(
                  (child) => child.knowledgePage?.status !== 'SUCCEEDED',
                ));
            return (
              <Fragment key={job.id}>
                <tr
                  data-testid="root-job"
                  className="border-b border-gray-100 hover:bg-gray-50/60 align-top"
                >
                  <td className="px-3 py-2"><StatusBadge job={job} /></td>
                  <td className="px-3 py-2 text-gray-700">
                    <div className="flex items-center gap-2">
                      {children.length > 0 && (
                        <button
                          type="button"
                          className="rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                          aria-label={`${typeLabel(job.type)}の子ジョブを${isOpen ? '非表示' : '表示'}`}
                          aria-expanded={isOpen}
                          aria-controls={`job-children-${job.id}`}
                          onClick={() =>
                            setExpanded((current) => {
                              const next = new Set(current);
                              if (next.has(job.id)) next.delete(job.id);
                              else next.add(job.id);
                              return next;
                            })
                          }
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      )}
                      <span>{typeLabel(job.type)}</span>
                    </div>
                    {pageChildren.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        {succeeded} / {pageChildren.length} ページ成功
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-500">{job.progress}%</td>
                  <td className="px-3 py-2 text-gray-700">
                    <div className="space-y-1.5">
                      {job.status === 'FAILED' && job.error ? (
                        <span className="inline-flex items-start gap-1 text-red-600">
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <span className="break-all">{job.error}</span>
                        </span>
                      ) : job.status === 'SUCCEEDED' ? (
                        <span className="text-emerald-700">完了</span>
                      ) : (
                        <span>—</span>
                      )}
                      {canResume && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={busyId !== null}
                          aria-label="未完了ページを再開"
                          onClick={() => onResume(job)}
                        >
                          {busyId === job.id ? (
                            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCw className="mr-1 h-3 w-3" />
                          )}
                          再開
                        </Button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {formatDateTime(job.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {formatDateTime(job.finishedAt)}
                  </td>
                </tr>
                {children.length > 0 && isOpen && (
                  <tr className="border-b border-gray-100 bg-slate-50/60">
                    <td colSpan={6} className="px-3 py-2">
                      <ol id={`job-children-${job.id}`} className="ml-4 border-l border-slate-200 pl-3">
                        {children.map((child) => {
                          const page = child.knowledgePage;
                          const label = page
                            ? `${page.pageKind === 'PPTX_SLIDE' ? 'スライド' : 'ページ'} ${page.pageNumber}`
                            : typeLabel(child.type);
                          return (
                            <li
                              key={child.id}
                              className="grid gap-1 border-b border-slate-200/70 py-2 last:border-0 sm:grid-cols-[minmax(100px,1fr)_auto_auto] sm:items-center sm:gap-3"
                            >
                              <div>
                                <span className="text-sm font-medium text-gray-800">{label}</span>
                                {child.error && (
                                  <p className="mt-0.5 break-words text-xs text-red-600">
                                    {child.error}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                                <StatusBadge job={child} />
                                <span>{child.progress}%</span>
                                <span>{child.attempts} / {child.maxAttempts ?? '—'} 回</span>
                              </div>
                              {page?.status === 'FAILED' && child.status === 'FAILED' && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 justify-self-start px-2 text-xs sm:justify-self-end"
                                  disabled={busyId !== null}
                                  aria-label={`${label}を再試行`}
                                  onClick={() => onRetryPage(child)}
                                >
                                  <RotateCw className="mr-1 h-3 w-3" />
                                  再試行
                                </Button>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface BackgroundJobsPanelProps {
  projectId: string;
  /** 取得件数の上限（既定 20）。 */
  limit?: number;
}

/**
 * 「バックグラウンド処理」一覧パネル。
 *
 * GET /api/projects/:projectId/jobs を取得し、状態バッジ・種別・進捗・失敗理由・時刻を表示する。
 * 起票は行わない（読み取り専用）ため VIEW ユーザーでもそのまま表示できる
 * （起票ボタンの抑止は起票元ダイアログ側で canEdit により制御する）。
 *
 * ref.refresh() で親（ジョブ起票直後）から再取得をトリガーできる。
 */
export const BackgroundJobsPanel = forwardRef<BackgroundJobsPanelHandle, BackgroundJobsPanelProps>(
  function BackgroundJobsPanel({ projectId, limit = 20 }, ref) {
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const fetchJobs = useCallback(
      async (withSpinner: boolean) => {
        if (withSpinner) setLoading(true);
        setError(null);
        try {
          const data = await listJobs(projectId, limit);
          setJobs(Array.isArray(data) ? data : []);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'ジョブ一覧の取得に失敗しました');
        } finally {
          if (withSpinner) setLoading(false);
        }
      },
      [projectId, limit],
    );

    useEffect(() => {
      void fetchJobs(true);
    }, [fetchJobs]);

    useImperativeHandle(ref, () => ({ refresh: () => void fetchJobs(false) }), [fetchJobs]);

    const runAction = async (id: string, action: () => Promise<unknown>) => {
      setBusyId(id);
      setError(null);
      try {
        await action();
        await fetchJobs(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'ジョブの再開に失敗しました');
      } finally {
        setBusyId(null);
      }
    };

    return (
      <Card className="bg-white border-gray-200">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
              <Cog className="h-5 w-5 text-gray-500" />
              バックグラウンド処理
              <HelpTooltip text="AIによるMermaid解析やKPI生成などの重い処理は、バックグラウンドジョブとして非同期で実行されます。ここで各ジョブの状態・進捗・失敗理由を確認できます。" />
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchJobs(false)}
              className="border-gray-300 text-gray-700"
              title="一覧を再取得"
            >
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              読み込み中...
            </div>
          ) : error ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void fetchJobs(true)}>
                再読み込み
              </Button>
            </div>
          ) : jobs.length === 0 ? (
            <p className="flex items-center gap-2 py-6 text-sm text-gray-400">
              <Clock className="h-4 w-4" />
              バックグラウンド処理の履歴はまだありません。
            </p>
          ) : (
            <JobsTable
              jobs={jobs}
              busyId={busyId}
              onResume={(job) =>
                void runAction(job.id, () => resumeJob(projectId, job.id))
              }
              onRetryPage={(job) => {
                const pageId = job.knowledgePage?.id;
                if (pageId) {
                  void runAction(job.id, () => retryKnowledgeDocumentPage(pageId));
                }
              }}
            />
          )}
        </CardContent>
      </Card>
    );
  },
);
