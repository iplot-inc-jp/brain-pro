'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { FileDropZone } from '@/components/ui/file-drop-zone';
import {
  Loader2,
  Pencil,
  Trash2,
  Flag,
  MessageSquare,
  Paperclip,
  Upload,
  Download,
  Send,
  X,
  Check,
  CornerDownRight,
  Link2,
  FileText,
  GitBranch,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import {
  tasksApi,
  commentsApi,
  attachmentsApi,
  taskStatusLabels,
  taskPriorityLabels,
  issueNodeKindMeta,
  issueNodeKindOptionLabel,
  TASK_STATUSES,
  TASK_PRIORITIES,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskDependency,
  type TaskRole,
  type TaskComment,
  type TaskAttachment,
  type IssueNodeRef,
} from '@/lib/tasks';
import {
  listRisks,
  riskScore,
  scoreBand,
  scoreBandBadgeClasses,
  type Risk,
} from '@/lib/risks';

type EditState = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string;
  startDate: string;
  dueDate: string;
  progress: number;
  issueNodeId: string;
};

const NONE = '__none__'; // Select は空文字を value にできないためのプレースホルダ

export default function TaskDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const taskId = params.taskId as string;

  const [task, setTask] = useState<Task | null>(null);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [roles, setRoles] = useState<TaskRole[]>([]);
  const [issueNodes, setIssueNodes] = useState<IssueNodeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // インライン編集
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // コメント
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');

  // 添付
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // データ取得
  // -------------------------------------------------------------------------
  const fetchTask = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const data = await tasksApi.list(projectId);
      const tasks = data.tasks ?? [];
      setAllTasks(tasks);
      setDependencies(data.dependencies ?? []);
      const found = tasks.find((t) => t.id === taskId) ?? null;
      setTask(found);
      if (!found) setNotFound(true);
    } catch (err) {
      console.error('Failed to fetch task:', err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [projectId, taskId]);

  const fetchRoles = useCallback(async () => {
    try {
      const list = await tasksApi.listRoles(projectId);
      setRoles(list ?? []);
    } catch {
      setRoles([]);
    }
  }, [projectId]);

  const fetchIssueNodes = useCallback(async () => {
    try {
      const list = await tasksApi.listIssueNodes(projectId);
      setIssueNodes(list ?? []);
    } catch {
      setIssueNodes([]);
    }
  }, [projectId]);

  const fetchComments = useCallback(async () => {
    try {
      const list = await commentsApi.list(taskId);
      setComments(list ?? []);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    }
  }, [taskId]);

  const fetchAttachments = useCallback(async () => {
    try {
      const list = await attachmentsApi.list(taskId);
      setAttachments(list ?? []);
    } catch (err) {
      console.error('Failed to fetch attachments:', err);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
    fetchRoles();
    fetchIssueNodes();
    fetchComments();
    fetchAttachments();
  }, [fetchTask, fetchRoles, fetchIssueNodes, fetchComments, fetchAttachments]);

  // -------------------------------------------------------------------------
  // 派生データ
  // -------------------------------------------------------------------------
  const taskById = useMemo(() => {
    const m = new Map<string, Task>();
    allTasks.forEach((t) => m.set(t.id, t));
    return m;
  }, [allTasks]);

  const roleNameById = useMemo(() => {
    const m = new Map<string, string>();
    roles.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [roles]);

  const issueNodeById = useMemo(() => {
    const m = new Map<string, IssueNodeRef>();
    issueNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [issueNodes]);

  // 紐付いた課題ノード（列挙 API を優先し、無ければ TaskOutput のフィールドから合成）
  const linkedNode = useMemo<IssueNodeRef | null>(() => {
    if (!task?.issueNodeId) return null;
    const ref = issueNodeById.get(task.issueNodeId);
    if (ref) return ref;
    if (task.issueNodeLabel && task.issueNodeKind) {
      return {
        id: task.issueNodeId,
        label: task.issueNodeLabel,
        kind: task.issueNodeKind,
        treeId: '',
        treeTitle: '',
      };
    }
    return null;
  }, [task, issueNodeById]);

  // 由来リスク（riskId が付いたリスク対応タスクのみ取得・表示）
  const [originRisk, setOriginRisk] = useState<Risk | null>(null);
  useEffect(() => {
    let cancelled = false;
    const riskId = task?.riskId;
    if (!riskId) {
      setOriginRisk(null);
      return;
    }
    (async () => {
      try {
        const risks = await listRisks(projectId);
        if (!cancelled) {
          setOriginRisk(risks.find((r) => r.id === riskId) ?? null);
        }
      } catch {
        // 由来リスクの表示は補助情報なので、取得失敗は黙って無視する
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task?.riskId, projectId]);

  const parent = task?.parentId ? taskById.get(task.parentId) ?? null : null;

  const children = useMemo(
    () => allTasks.filter((t) => t.parentId === taskId),
    [allTasks, taskId]
  );

  // このタスクの先行タスク（依存）
  const predecessors = useMemo(
    () =>
      dependencies
        .filter((d) => d.successorId === taskId)
        .map((d) => taskById.get(d.predecessorId))
        .filter((t): t is Task => !!t),
    [dependencies, taskId, taskById]
  );

  // このタスクを先行とする後続タスク
  const successors = useMemo(
    () =>
      dependencies
        .filter((d) => d.predecessorId === taskId)
        .map((d) => taskById.get(d.successorId))
        .filter((t): t is Task => !!t),
    [dependencies, taskId, taskById]
  );

  // -------------------------------------------------------------------------
  // インライン編集
  // -------------------------------------------------------------------------
  const startEdit = () => {
    if (!task) return;
    setEdit({
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      assigneeName: task.assigneeName ?? '',
      startDate: task.startDate ? task.startDate.slice(0, 10) : '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      progress: clampProgress(task.progress),
      issueNodeId: task.issueNodeId ?? '',
    });
    setSaveError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setEdit(null);
    setSaveError(null);
  };

  const saveEdit = async () => {
    if (!edit) return;
    if (!edit.title.trim()) {
      setSaveError('タイトルは必須です');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await tasksApi.update(taskId, {
        title: edit.title.trim(),
        description: edit.description.trim() || null,
        status: edit.status,
        priority: edit.priority,
        assigneeName: edit.assigneeName.trim() || null,
        startDate: edit.startDate || null,
        dueDate: edit.dueDate || null,
        progress: clampProgress(edit.progress),
        issueNodeId: edit.issueNodeId || null,
      });
      setTask((prev) => (prev ? { ...prev, ...updated } : updated));
      setAllTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, ...updated } : t))
      );
      setEditing(false);
      setEdit(null);
    } catch (err: any) {
      setSaveError(err?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 進捗バーだけのクイック更新（ステータスバッジ）
  const quickStatus = async (status: TaskStatus) => {
    if (!task) return;
    setTask({ ...task, status });
    setAllTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status } : t))
    );
    try {
      await tasksApi.update(taskId, { status });
    } catch (err) {
      console.error('Failed to update status:', err);
      await fetchTask();
    }
  };

  // -------------------------------------------------------------------------
  // コメント操作
  // -------------------------------------------------------------------------
  const postComment = async () => {
    const body = commentBody.trim();
    if (!body) return;
    setPostingComment(true);
    try {
      await commentsApi.create(taskId, body);
      setCommentBody('');
      await fetchComments();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setPostingComment(false);
    }
  };

  const startEditComment = (c: TaskComment) => {
    setEditingCommentId(c.id);
    setEditingCommentBody(c.body);
  };

  const saveEditComment = async () => {
    if (!editingCommentId) return;
    const body = editingCommentBody.trim();
    if (!body) return;
    try {
      await commentsApi.update(editingCommentId, body);
      setEditingCommentId(null);
      setEditingCommentBody('');
      await fetchComments();
    } catch (err) {
      console.error('Failed to update comment:', err);
    }
  };

  const deleteComment = async (id: string) => {
    if (!confirm('このコメントを削除しますか？')) return;
    try {
      await commentsApi.delete(id);
      await fetchComments();
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  // -------------------------------------------------------------------------
  // 添付操作
  // -------------------------------------------------------------------------
  const handleUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const failed: string[] = [];
    // 逐次アップロード。失敗したものはまとめてインライン表示。
    for (const file of files) {
      try {
        await attachmentsApi.upload(taskId, file);
      } catch {
        failed.push(file.name);
      }
    }
    await fetchAttachments();
    if (failed.length > 0) {
      setUploadError(`アップロードに失敗しました: ${failed.join('、')}`);
    }
    setUploading(false);
  };

  const deleteAttachment = async (id: string) => {
    if (!confirm('この添付ファイルを削除しますか？')) return;
    try {
      await attachmentsApi.delete(id);
      await fetchAttachments();
    } catch (err) {
      console.error('Failed to delete attachment:', err);
    }
  };

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (notFound || !task) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="タスクが見つかりません"
          backHref="../tasks"
          backLabel="タスク一覧へ戻る"
        />
        <Card className="bg-white border-gray-200">
          <CardContent className="py-12 text-center text-gray-500">
            指定されたタスクは存在しないか、削除された可能性があります。
            <div className="mt-4">
              <Link href="../tasks">
                <Button variant="outline">タスク一覧へ</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = taskStatusLabels[task.status];
  const priority = taskPriorityLabels[task.priority];
  const assignee =
    task.assigneeName ||
    (task.assigneeRoleId ? roleNameById.get(task.assigneeRoleId) : '') ||
    '';
  const progress = clampProgress(task.progress);
  const period = formatPeriod(task.startDate, task.dueDate);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {task.milestone && <Flag className="h-5 w-5 text-amber-500" />}
            {task.title}
          </span>
        }
        description="タスクの詳細・コメント・添付ファイルを管理します"
        help="このタスクの内容をインラインで編集できます。下部の「コメント」でやり取りを残し、「添付ファイル」で資料や画像を共有できます。"
        backHref="../tasks"
        backLabel="タスク一覧へ戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                '上部のステータスバッジから状態をワンクリックで変更できます。',
                '「編集」を押すとタイトル・説明・担当・期間・進捗などをまとめて編集できます。',
                '「コメント」にメッセージを書いて「投稿」するとスレッドに追加されます（自分のコメントは編集・削除可）。',
                '「添付ファイル」でファイルを選ぶとアップロードされ、ダウンロード・削除ができます。画像はサムネイル表示されます。',
              ]}
            />
            {!editing && (
              <Button
                onClick={startEdit}
                className="bg-blue-600 hover:bg-blue-700 gap-1.5"
              >
                <Pencil className="h-4 w-4" />
                編集
              </Button>
            )}
          </>
        }
      />

      {/* ====================== タスク本体 ====================== */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-5 space-y-5">
          {editing && edit ? (
            // ---------- 編集モード ----------
            <div className="space-y-4">
              <DetailField label="タイトル">
                <Input
                  value={edit.title}
                  onChange={(e) => setEdit({ ...edit, title: e.target.value })}
                  className="bg-white border-gray-300"
                />
              </DetailField>

              <DetailField label="説明">
                <Textarea
                  value={edit.description}
                  onChange={(e) =>
                    setEdit({ ...edit, description: e.target.value })
                  }
                  className="bg-white border-gray-300 min-h-[90px]"
                />
              </DetailField>

              <div className="grid grid-cols-2 gap-4">
                <DetailField label="状態">
                  <Select
                    value={edit.status}
                    onValueChange={(v) =>
                      setEdit({ ...edit, status: v as TaskStatus })
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {TASK_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {taskStatusLabels[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DetailField>

                <DetailField label="優先度">
                  <Select
                    value={edit.priority}
                    onValueChange={(v) =>
                      setEdit({ ...edit, priority: v as TaskPriority })
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      {TASK_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {taskPriorityLabels[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </DetailField>
              </div>

              <DetailField label="担当">
                <Input
                  placeholder="例：山田"
                  value={edit.assigneeName}
                  onChange={(e) =>
                    setEdit({ ...edit, assigneeName: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </DetailField>

              <div className="grid grid-cols-2 gap-4">
                <DetailField label="開始日">
                  <Input
                    type="date"
                    value={edit.startDate}
                    onChange={(e) =>
                      setEdit({ ...edit, startDate: e.target.value })
                    }
                    className="bg-white border-gray-300"
                  />
                </DetailField>
                <DetailField label="期限">
                  <Input
                    type="date"
                    value={edit.dueDate}
                    onChange={(e) =>
                      setEdit({ ...edit, dueDate: e.target.value })
                    }
                    className="bg-white border-gray-300"
                  />
                </DetailField>
              </div>

              <DetailField label={`進捗（${clampProgress(edit.progress)}%）`}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={clampProgress(edit.progress)}
                  onChange={(e) =>
                    setEdit({ ...edit, progress: Number(e.target.value) })
                  }
                  className="w-full accent-blue-600"
                />
              </DetailField>

              <DetailField
                label="関連ノード（打ち手/調査）"
                help="課題ツリーの「打ち手」や「なぜ/調査」ノードに紐付けると、このタスクの由来として表示されます。"
              >
                {issueNodes.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    紐付けできる課題ノードがありません（課題ツリーで打ち手・調査を作成してください）
                  </p>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select
                      value={edit.issueNodeId || NONE}
                      onValueChange={(v) =>
                        setEdit({
                          ...edit,
                          issueNodeId: v === NONE ? '' : v,
                        })
                      }
                    >
                      <SelectTrigger className="bg-white border-gray-300">
                        <SelectValue placeholder="（紐付けなし）" />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        <SelectItem value={NONE}>（紐付けなし）</SelectItem>
                        {issueNodes.map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            [{issueNodeKindOptionLabel(n.kind)}] {n.label}
                            {n.treeTitle ? `（${n.treeTitle}）` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {edit.issueNodeId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEdit({ ...edit, issueNodeId: '' })}
                        className="shrink-0 gap-1 text-gray-500"
                      >
                        <X className="h-3.5 w-3.5" />
                        クリア
                      </Button>
                    )}
                  </div>
                )}
              </DetailField>

              {saveError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {saveError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={cancelEdit}>
                  キャンセル
                </Button>
                <Button
                  onClick={saveEdit}
                  disabled={saving || !edit.title.trim()}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      保存中...
                    </>
                  ) : (
                    '保存'
                  )}
                </Button>
              </div>
            </div>
          ) : (
            // ---------- 表示モード ----------
            <div className="space-y-5">
              {/* 状態・優先度・担当・進捗のヘッダ行 */}
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={task.status}
                  onValueChange={(v) => quickStatus(v as TaskStatus)}
                >
                  <SelectTrigger
                    className={`h-8 px-3 text-xs border w-auto ${status.color}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${status.dot}`}
                      />
                      {status.label}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {TASK_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {taskStatusLabels[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span
                  className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${priority.color}`}
                >
                  優先度: {priority.label}
                </span>

                {task.category && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                    {task.category}
                  </span>
                )}

                {task.milestone && (
                  <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-600">
                    <Flag className="h-3 w-3" />
                    マイルストーン
                  </span>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <DetailRow label="担当">
                  {assignee || <span className="text-gray-400">未割当</span>}
                </DetailRow>
                <DetailRow label="期間">
                  <span className="tabular-nums">{period}</span>
                </DetailRow>
              </div>

              {/* 進捗バー */}
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-700">進捗</span>
                  <span className="tabular-nums text-gray-500">
                    {progress}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-gray-100">
                  <div
                    className="h-2 rounded-full bg-blue-500 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* 説明 */}
              <DetailRow label="説明">
                {task.description ? (
                  <p className="whitespace-pre-wrap text-gray-700">
                    {task.description}
                  </p>
                ) : (
                  <span className="text-gray-400">（説明なし）</span>
                )}
              </DetailRow>

              {/* 由来（紐付いた課題ノード） */}
              <DetailRow label="由来（打ち手/調査）">
                {linkedNode ? (
                  (() => {
                    const meta = issueNodeKindMeta(linkedNode.kind);
                    const chip = (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${meta.chip}`}
                        >
                          {meta.label}
                        </span>
                        <span>{linkedNode.label}</span>
                      </span>
                    );
                    return linkedNode.treeId ? (
                      <Link
                        href={`/dashboard/projects/${projectId}/issue-trees/${linkedNode.treeId}`}
                        className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                      >
                        <GitBranch className="h-3.5 w-3.5" />
                        {chip}
                        {linkedNode.treeTitle && (
                          <span className="text-xs text-gray-400">
                            （{linkedNode.treeTitle}）
                          </span>
                        )}
                      </Link>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-gray-700">
                        <GitBranch className="h-3.5 w-3.5 text-gray-400" />
                        {chip}
                      </span>
                    );
                  })()
                ) : (
                  <span className="text-gray-400">なし</span>
                )}
              </DetailRow>

              {/* 由来リスク（リスク対応タスク） */}
              {task.riskId && (
                <DetailRow label="由来リスク">
                  <Link
                    href={`/dashboard/projects/${projectId}/risk-management`}
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
                    title="リスクマネジメントで開く"
                  >
                    <ShieldAlert className="h-3.5 w-3.5" />
                    <span>
                      {originRisk
                        ? (originRisk.event ?? '').trim() ||
                          (originRisk.code ?? '').trim() ||
                          '（無題のリスク）'
                        : 'リスクマネジメントで確認'}
                    </span>
                    {originRisk &&
                      (() => {
                        const score = riskScore(
                          originRisk.probabilityScore,
                          originRisk.impactScore,
                        );
                        return score != null ? (
                          <span
                            className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${scoreBandBadgeClasses[scoreBand(score)]}`}
                            title="スコア（確率×影響）"
                          >
                            {score}
                          </span>
                        ) : null;
                      })()}
                  </Link>
                </DetailRow>
              )}

              {/* 親タスク */}
              <DetailRow label="親タスク">
                {parent ? (
                  <Link
                    href={`./${parent.id}`}
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    <CornerDownRight className="h-3.5 w-3.5" />
                    {parent.title}
                  </Link>
                ) : (
                  <span className="text-gray-400">（トップレベル）</span>
                )}
              </DetailRow>

              {/* サブタスク */}
              <DetailRow label="サブタスク">
                {children.length === 0 ? (
                  <span className="text-gray-400">なし</span>
                ) : (
                  <ul className="space-y-1">
                    {children.map((c) => {
                      const cs = taskStatusLabels[c.status];
                      return (
                        <li key={c.id} className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${cs.dot}`} />
                          <Link
                            href={`./${c.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {c.title}
                          </Link>
                          <span className="text-xs text-gray-400">
                            {cs.label} / {clampProgress(c.progress)}%
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DetailRow>

              {/* 依存（先行・後続） */}
              <DetailRow label="依存（先行タスク）">
                {predecessors.length === 0 ? (
                  <span className="text-gray-400">なし</span>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {predecessors.map((p) => (
                      <Link
                        key={p.id}
                        href={`./${p.id}`}
                        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-blue-600 hover:bg-gray-100"
                      >
                        <Link2 className="h-3 w-3" />
                        {p.title}
                      </Link>
                    ))}
                  </div>
                )}
              </DetailRow>

              {successors.length > 0 && (
                <DetailRow label="後続タスク">
                  <div className="flex flex-wrap gap-2">
                    {successors.map((s) => (
                      <Link
                        key={s.id}
                        href={`./${s.id}`}
                        className="inline-flex items-center gap-1 rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-blue-600 hover:bg-gray-100"
                      >
                        <Link2 className="h-3 w-3" />
                        {s.title}
                      </Link>
                    ))}
                  </div>
                </DetailRow>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ====================== コメント ====================== */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900">コメント</h2>
            <span className="text-sm text-gray-400">({comments.length})</span>
          </div>

          {/* スレッド */}
          {comments.length === 0 ? (
            <p className="text-sm text-gray-400">
              まだコメントはありません。最初のコメントを投稿しましょう。
            </p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => (
                <li
                  key={c.id}
                  className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[11px] font-medium text-blue-700">
                        {initials(c.authorName)}
                      </span>
                      <span className="font-medium text-gray-800">
                        {c.authorName || '名無し'}
                      </span>
                      <span
                        className="text-xs text-gray-400"
                        title={new Date(c.createdAt).toLocaleString('ja-JP')}
                      >
                        {relativeTime(c.createdAt)}
                        {c.updatedAt && c.updatedAt !== c.createdAt
                          ? '（編集済み）'
                          : ''}
                      </span>
                    </div>
                    {editingCommentId !== c.id && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="編集"
                          onClick={() => startEditComment(c)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                          title="削除"
                          onClick={() => deleteComment(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {editingCommentId === c.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea
                        value={editingCommentBody}
                        onChange={(e) => setEditingCommentBody(e.target.value)}
                        className="bg-white border-gray-300 min-h-[70px]"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingCommentId(null);
                            setEditingCommentBody('');
                          }}
                          className="gap-1"
                        >
                          <X className="h-3.5 w-3.5" />
                          キャンセル
                        </Button>
                        <Button
                          size="sm"
                          onClick={saveEditComment}
                          disabled={!editingCommentBody.trim()}
                          className="bg-blue-600 hover:bg-blue-700 gap-1"
                        >
                          <Check className="h-3.5 w-3.5" />
                          更新
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">
                      {c.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* コメント投稿 */}
          <div className="space-y-2 border-t border-gray-100 pt-4">
            <Textarea
              placeholder="コメントを入力..."
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              className="bg-white border-gray-300 min-h-[80px]"
            />
            <div className="flex justify-end">
              <Button
                onClick={postComment}
                disabled={postingComment || !commentBody.trim()}
                className="bg-blue-600 hover:bg-blue-700 gap-1.5"
              >
                {postingComment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                投稿
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ====================== 添付ファイル ====================== */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Paperclip className="h-5 w-5 text-gray-500" />
              <h2 className="text-base font-semibold text-gray-900">
                添付ファイル
              </h2>
              <span className="text-sm text-gray-400">
                ({attachments.length})
              </span>
            </div>
          </div>

          {/* ドラッグ&ドロップ（クリックでファイル選択も可）。複数可・逐次アップロード */}
          <FileDropZone onFiles={(files) => void handleUpload(files)} busy={uploading}>
            <span className="inline-flex items-center gap-1.5 text-sm">
              <Upload className="h-4 w-4 text-gray-400" />
              ファイルをドラッグ＆ドロップ、またはクリックして選択
            </span>
          </FileDropZone>

          {uploadError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {uploadError}
            </div>
          )}

          {attachments.length === 0 ? (
            <p className="text-sm text-gray-400">
              添付ファイルはありません。資料や画像をアップロードできます。
            </p>
          ) : (
            <ul className="space-y-2">
              {attachments.map((a) => {
                const isImage = a.mimeType?.startsWith('image/');
                const fileHref = attachmentsApi.fileUrl(a.id);
                return (
                  <li
                    key={a.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-100 p-2"
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={fileHref}
                        alt={a.filename}
                        className="h-12 w-12 shrink-0 rounded border border-gray-200 object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400">
                        {a.mimeType === 'application/pdf' ? (
                          <FileText className="h-5 w-5" />
                        ) : isImage ? (
                          <ImageIcon className="h-5 w-5" />
                        ) : (
                          <Paperclip className="h-5 w-5" />
                        )}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-800">
                        {a.filename}
                      </div>
                      <div className="text-xs text-gray-400">
                        {formatSize(a.size)}
                        {a.createdAt
                          ? ` · ${relativeTime(a.createdAt)}`
                          : ''}
                      </div>
                    </div>
                    <a href={fileHref} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm" className="gap-1">
                        <Download className="h-4 w-4" />
                        ダウンロード
                      </Button>
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                      title="削除"
                      onClick={() => deleteAttachment(a.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 小コンポーネント / ヘルパー
// ---------------------------------------------------------------------------

function clampProgress(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function DetailField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-gray-700">{label}</Label>
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

function formatPeriod(start: string | null, due: string | null): string {
  const s = start ? start.slice(0, 10) : '';
  const d = due ? due.slice(0, 10) : '';
  if (!s && !d) return '-';
  if (s && d) return `${s} 〜 ${d}`;
  if (s) return `${s} 〜`;
  return `〜 ${d}`;
}

function formatSize(bytes: number): string {
  if (bytes == null || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function initials(name: string | null): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'たった今';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}日前`;
  const week = Math.floor(day / 7);
  if (week < 5) return `${week}週間前`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}ヶ月前`;
  const year = Math.floor(day / 365);
  return `${year}年前`;
}
