'use client';

/**
 * 変更管理（変更要求）ページ。
 *
 * PMBOK の統合変更管理に対応する変更要求の一覧・作成・編集・削除を行う。
 * - 一覧: タイトル / 理由 / 影響（スコープ・スケジュール・コスト）/ 状態バッジ /
 *   承認者 / 決定日。状態は行内 select でも変更できる。
 * - 行クリックで編集モーダル（全フィールド）。
 * - 承認済み（APPROVED）の変更は「タスク化」で POST tasks {title:'[変更] '+title}。
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { GitPullRequest, ListPlus, Loader2, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  changeRequestApi,
  normalizeChangeRequestStatus,
  changeRequestStatusMeta,
  CHANGE_REQUEST_STATUSES,
  type ChangeRequest,
  type ChangeRequestInput,
  type ChangeRequestStatus,
} from '@/lib/pmbok';
import { listStakeholders, type Stakeholder } from '@/lib/stakeholders';
import { tasksApi } from '@/lib/tasks';

/** ISO 日付文字列を YYYY/MM/DD 表示にする（不正値・null は '—'）。 */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

export default function ChangeRequestsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [changeRequests, setChangeRequests] = useState<ChangeRequest[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // 作成フォーム（タイトルのみ。詳細はモーダルで）。
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  // 編集モーダル対象。
  const [editing, setEditing] = useState<ChangeRequest | null>(null);

  const stakeholderName = useMemo(() => {
    const map = new Map(stakeholders.map((s) => [s.id, s.name]));
    return (id: string | null) => (id ? map.get(id) ?? '—' : '—');
  }, [stakeholders]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [crs, shs] = await Promise.all([
        changeRequestApi.list(projectId),
        listStakeholders(projectId),
      ]);
      setChangeRequests(crs);
      setStakeholders(shs);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
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

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      await changeRequestApi.create(projectId, { title });
      setNewTitle('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }, [newTitle, projectId, load]);

  // 行内 select での状態変更（即保存）。
  const handleStatusChange = useCallback(
    async (cr: ChangeRequest, status: ChangeRequestStatus) => {
      if (status === normalizeChangeRequestStatus(cr.status)) return;
      setError(null);
      try {
        await changeRequestApi.update(cr.id, { status });
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '保存に失敗しました');
      }
    },
    [load],
  );

  const handleDelete = useCallback(
    async (cr: ChangeRequest) => {
      if (!confirm(`変更要求「${cr.title}」を削除しますか？`)) return;
      setError(null);
      try {
        await changeRequestApi.delete(cr.id);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : '削除に失敗しました');
      }
    },
    [load],
  );

  // 承認済みの変更をタスク化（POST tasks {title: '[変更] ' + title}）。
  const handleCreateTask = useCallback(
    async (cr: ChangeRequest) => {
      setError(null);
      setInfo(null);
      try {
        const task = await tasksApi.create(projectId, {
          title: `[変更] ${cr.title}`,
        });
        setInfo(`タスク「${task.title}」を作成しました。`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'タスク化に失敗しました');
      }
    },
    [projectId],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GitPullRequest className="h-5 w-5 text-primary" />
            変更管理
          </span>
        }
        description="スコープ・スケジュール・コストへの影響を見える化して、変更要求を申請→承認→適用で管理します。"
        help="変更要求を一覧で管理します。状態は 申請→承認/却下→適用 と進め、承認/却下にした時点で決定日が記録されます。承認済みの変更は「タスク化」で実行タスクに落とせます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '上のフォームに変更のタイトルを入力して「追加」します（状態は「申請」で作成されます）。',
              '行をクリックすると編集モーダルが開き、理由・影響・承認者・備考などを編集できます。',
              '状態は行内のプルダウンでも変更できます。承認/却下にすると決定日が記録されます。',
              '承認済みの行は「タスク化」ボタンで「[変更] タイトル」のタスクを作成できます。',
              '不要になった変更要求はゴミ箱ボタンで削除します。',
            ]}
          />
        }
      />

      {/* 作成フォーム */}
      <Card className="bg-white border-gray-200">
        <CardContent className="flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[240px] space-y-1">
            <label className="block text-[11px] font-medium text-gray-500">
              変更要求のタイトル<span className="ml-1 text-rose-500">*</span>
            </label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate();
              }}
              placeholder="例：帳票レイアウト変更"
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button
            size="sm"
            onClick={() => void handleCreate()}
            disabled={creating || !newTitle.trim()}
          >
            {creating ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-1 h-4 w-4" />
            )}
            追加
          </Button>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {info && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {info}
        </div>
      )}

      {/* 一覧 */}
      {loading ? (
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
                    <th className="min-w-[180px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      タイトル
                    </th>
                    <th className="min-w-[160px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      理由
                    </th>
                    <th className="min-w-[200px] px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      影響（スコープ・スケジュール・コスト）
                    </th>
                    <th className="w-32 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      状態
                    </th>
                    <th className="w-32 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      承認者
                    </th>
                    <th className="w-28 px-3 py-2 text-left text-xs font-semibold text-gray-600">
                      決定日
                    </th>
                    <th className="w-32 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {changeRequests.map((cr) => {
                    const status = normalizeChangeRequestStatus(cr.status);
                    const meta = changeRequestStatusMeta[status];
                    return (
                      <tr
                        key={cr.id}
                        onClick={() => setEditing(cr)}
                        className="cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50/30"
                      >
                        <td className="px-3 py-2">
                          <span className="text-sm font-medium text-[#050f3e]">
                            {cr.title}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <span className="line-clamp-2 text-sm text-gray-600">
                            {cr.reason || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-0.5 text-xs text-gray-600">
                            <ImpactLine label="スコープ" value={cr.impactScope} />
                            <ImpactLine label="スケジュール" value={cr.impactSchedule} />
                            <ImpactLine label="コスト" value={cr.impactCost} />
                            {!cr.impactScope && !cr.impactSchedule && !cr.impactCost && (
                              <span className="text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="space-y-1">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.badge}`}
                            >
                              {meta.label}
                            </span>
                            <select
                              value={status}
                              onChange={(e) =>
                                void handleStatusChange(
                                  cr,
                                  e.target.value as ChangeRequestStatus,
                                )
                              }
                              className="block w-full rounded-md border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-600 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                              aria-label="状態を変更"
                            >
                              {CHANGE_REQUEST_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {changeRequestStatusMeta[s].label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-sm text-gray-600">
                          {stakeholderName(cr.approverStakeholderId)}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-500">
                          {fmtDate(cr.decidedAt)}
                        </td>
                        <td
                          className="px-2 py-2 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-end gap-1">
                            {status === 'APPROVED' && (
                              <button
                                type="button"
                                onClick={() => void handleCreateTask(cr)}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                                title="承認済みの変更をタスクとして登録"
                              >
                                <ListPlus className="h-3.5 w-3.5" />
                                タスク化
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleDelete(cr)}
                              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="この変更要求を削除"
                              aria-label="この変更要求を削除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {changeRequests.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ変更要求がありません。上のフォームから追加してください。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 編集モーダル */}
      {editing && (
        <ChangeRequestEditDialog
          changeRequest={editing}
          stakeholders={stakeholders}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

/** 影響1行（値があるときだけラベル付きで出す）。 */
function ImpactLine({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <p className="line-clamp-1">
      <span className="font-medium text-gray-400">{label}：</span>
      {value}
    </p>
  );
}

// ---------------------------------------------------------------------------
// 編集モーダル（全フィールド + 保存）
// ---------------------------------------------------------------------------

function ChangeRequestEditDialog({
  changeRequest,
  stakeholders,
  onClose,
  onSaved,
  onError,
}: {
  changeRequest: ChangeRequest;
  stakeholders: Stakeholder[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  onError: (msg: string | null) => void;
}) {
  const [title, setTitle] = useState(changeRequest.title);
  const [reason, setReason] = useState(changeRequest.reason ?? '');
  const [impactScope, setImpactScope] = useState(changeRequest.impactScope ?? '');
  const [impactSchedule, setImpactSchedule] = useState(changeRequest.impactSchedule ?? '');
  const [impactCost, setImpactCost] = useState(changeRequest.impactCost ?? '');
  const [status, setStatus] = useState<ChangeRequestStatus>(
    normalizeChangeRequestStatus(changeRequest.status),
  );
  const [approverId, setApproverId] = useState(changeRequest.approverStakeholderId ?? '');
  const [note, setNote] = useState(changeRequest.note ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    onError(null);
    try {
      const patch: ChangeRequestInput = {
        title: t,
        reason: reason.trim() || null,
        impactScope: impactScope.trim() || null,
        impactSchedule: impactSchedule.trim() || null,
        impactCost: impactCost.trim() || null,
        status,
        approverStakeholderId: approverId || null,
        note: note.trim() || null,
      };
      await changeRequestApi.update(changeRequest.id, patch);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }, [
    changeRequest.id,
    title,
    reason,
    impactScope,
    impactSchedule,
    impactCost,
    status,
    approverId,
    note,
    onSaved,
    onError,
  ]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg bg-white text-gray-900">
        <DialogHeader>
          <DialogTitle>変更要求を編集</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          <Field label="タイトル" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <Field label="変更理由">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <Field label="スコープへの影響">
            <textarea
              value={impactScope}
              onChange={(e) => setImpactScope(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="スケジュールへの影響">
              <input
                value={impactSchedule}
                onChange={(e) => setImpactSchedule(e.target.value)}
                placeholder="例：+2週間"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
            <Field label="コストへの影響">
              <input
                value={impactCost}
                onChange={(e) => setImpactCost(e.target.value)}
                placeholder="例：+50万円"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="状態">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ChangeRequestStatus)}
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {CHANGE_REQUEST_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {changeRequestStatusMeta[s].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="承認者">
              <select
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">（未選択）</option>
                {stakeholders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="備考">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            キャンセル
          </Button>
          <Button size="sm" onClick={() => void handleSave()} disabled={saving || !title.trim()}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-gray-500">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}
