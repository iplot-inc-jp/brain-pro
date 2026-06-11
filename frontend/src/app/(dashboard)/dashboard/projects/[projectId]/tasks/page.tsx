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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ManualButton } from '@/components/ui/manual-dialog';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Plus,
  Loader2,
  ListTodo,
  Trash2,
  Pencil,
  Flag,
  GanttChartSquare,
  Search,
  X,
  ListChecks,
  Columns3,
  User,
  CalendarDays,
  GitBranch,
} from 'lucide-react';
import {
  tasksApi,
  buildTaskTree,
  computeWbsNumbers,
  flattenTaskTree,
  collectDescendantIds,
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
  type TaskTreeNode,
  type IssueNodeRef,
} from '@/lib/tasks';

type FormState = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  parentId: string;
  assigneeName: string;
  assigneeRoleId: string;
  startDate: string;
  dueDate: string;
  progress: number;
  estimatedHours: string;
  actualHours: string;
  milestone: boolean;
  category: string;
  predecessorIds: string[];
  issueNodeId: string;
};

const emptyForm: FormState = {
  title: '',
  description: '',
  status: 'OPEN',
  priority: 'MEDIUM',
  parentId: '',
  assigneeName: '',
  assigneeRoleId: '',
  startDate: '',
  dueDate: '',
  progress: 0,
  estimatedHours: '',
  actualHours: '',
  milestone: false,
  category: '',
  predecessorIds: [],
  issueNodeId: '',
};

const NONE = '__none__'; // Select は空文字を value にできないためのプレースホルダ

export default function TasksPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [roles, setRoles] = useState<TaskRole[]>([]);
  const [issueNodes, setIssueNodes] = useState<IssueNodeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 表示モード（一覧 / ボード）
  const [view, setView] = useState<'list' | 'board'>('list');

  // フィルタ
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterAssignee, setFilterAssignee] = useState<string>('ALL');
  const [filterMilestone, setFilterMilestone] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  // ダイアログ
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------
  // データ取得
  // ---------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [data, roleList, nodeList] = await Promise.all([
        tasksApi.list(projectId),
        tasksApi.listRoles(projectId).catch(() => [] as TaskRole[]),
        tasksApi.listIssueNodes(projectId).catch(() => [] as IssueNodeRef[]),
      ]);
      setTasks(data.tasks ?? []);
      setDependencies(data.dependencies ?? []);
      setRoles(roleList ?? []);
      setIssueNodes(nodeList ?? []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ---------------------------------------------------------------------
  // 派生データ
  // ---------------------------------------------------------------------
  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const wbs = useMemo(() => computeWbsNumbers(tree), [tree]);
  const orderedNodes = useMemo(() => flattenTaskTree(tree), [tree]);

  const roleNameById = useMemo(() => {
    const m = new Map<string, string>();
    roles.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [roles]);

  const taskTitleById = useMemo(() => {
    const m = new Map<string, string>();
    tasks.forEach((t) => m.set(t.id, t.title));
    return m;
  }, [tasks]);

  const issueNodeById = useMemo(() => {
    const m = new Map<string, IssueNodeRef>();
    issueNodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [issueNodes]);

  // 後続→先行の対応（特定タスクの先行タスク・依存IDを引く）
  const depsBySuccessor = useMemo(() => {
    const m = new Map<string, TaskDependency[]>();
    dependencies.forEach((d) => {
      const arr = m.get(d.successorId) ?? [];
      arr.push(d);
      m.set(d.successorId, arr);
    });
    return m;
  }, [dependencies]);

  const assigneeOptions = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.assigneeName) set.add(t.assigneeName);
    });
    return Array.from(set).sort();
  }, [tasks]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return Array.from(set).sort();
  }, [tasks]);

  // フィルタにマッチする id 集合。子だけがマッチした場合は祖先も表示できるよう
  // ツリー構造（インデント）を保つため、マッチした行とその祖先を残す。
  const visibleIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (t: Task) => {
      if (filterStatus !== 'ALL' && t.status !== filterStatus) return false;
      if (filterAssignee !== 'ALL' && (t.assigneeName ?? '') !== filterAssignee)
        return false;
      if (filterMilestone === 'YES' && !t.milestone) return false;
      if (filterMilestone === 'NO' && t.milestone) return false;
      if (filterCategory !== 'ALL' && (t.category ?? '') !== filterCategory)
        return false;
      if (q) {
        const hay = `${t.title} ${t.description ?? ''} ${
          t.assigneeName ?? ''
        } ${t.category ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    };

    const anyFilter =
      filterStatus !== 'ALL' ||
      filterAssignee !== 'ALL' ||
      filterMilestone !== 'ALL' ||
      filterCategory !== 'ALL' ||
      q.length > 0;

    if (!anyFilter) return null; // null = 全件表示

    const parentById = new Map<string, string | null>();
    tasks.forEach((t) => parentById.set(t.id, t.parentId));

    const keep = new Set<string>();
    for (const t of tasks) {
      if (matches(t)) {
        keep.add(t.id);
        // 祖先も保持してインデントを崩さない
        let p = t.parentId;
        while (p && parentById.has(p) && !keep.has(p)) {
          keep.add(p);
          p = parentById.get(p) ?? null;
        }
      }
    }
    return keep;
  }, [
    tasks,
    filterStatus,
    filterAssignee,
    filterMilestone,
    filterCategory,
    query,
  ]);

  const rows = useMemo(
    () =>
      orderedNodes.filter((n) => visibleIds === null || visibleIds.has(n.id)),
    [orderedNodes, visibleIds]
  );

  // ボード用：表示中タスク（フィルタ後）を状態ごとにグルーピング。
  // サブタスクも含めフラットに、それぞれの状態カラムへ並べる。
  const tasksByStatus = useMemo(() => {
    const map: Record<TaskStatus, TaskTreeNode[]> = {
      OPEN: [],
      IN_PROGRESS: [],
      RESOLVED: [],
      CLOSED: [],
    };
    for (const node of rows) {
      map[node.status]?.push(node);
    }
    return map;
  }, [rows]);

  const hasActiveFilters =
    filterStatus !== 'ALL' ||
    filterAssignee !== 'ALL' ||
    filterMilestone !== 'ALL' ||
    filterCategory !== 'ALL' ||
    query.trim().length > 0;

  const resetFilters = () => {
    setFilterStatus('ALL');
    setFilterAssignee('ALL');
    setFilterMilestone('ALL');
    setFilterCategory('ALL');
    setQuery('');
  };

  // ---------------------------------------------------------------------
  // ダイアログ操作
  // ---------------------------------------------------------------------
  const openCreate = (parentId?: string) => {
    setEditingId(null);
    setForm({ ...emptyForm, parentId: parentId ?? '' });
    setError(null);
    setDialogOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditingId(task.id);
    const preds = (depsBySuccessor.get(task.id) ?? []).map(
      (d) => d.predecessorId
    );
    setForm({
      title: task.title,
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      parentId: task.parentId ?? '',
      assigneeName: task.assigneeName ?? '',
      assigneeRoleId: task.assigneeRoleId ?? '',
      startDate: task.startDate ? task.startDate.slice(0, 10) : '',
      dueDate: task.dueDate ? task.dueDate.slice(0, 10) : '',
      progress: task.progress ?? 0,
      estimatedHours:
        task.estimatedHours != null ? String(task.estimatedHours) : '',
      actualHours: task.actualHours != null ? String(task.actualHours) : '',
      milestone: task.milestone,
      category: task.category ?? '',
      predecessorIds: preds,
      issueNodeId: task.issueNodeId ?? '',
    });
    setError(null);
    setDialogOpen(true);
  };

  // 親セレクトの選択肢：編集中タスク自身とその子孫を除外（循環防止）
  const parentOptions = useMemo(() => {
    const excluded = editingId
      ? (() => {
          const d = collectDescendantIds(tasks, editingId);
          d.add(editingId);
          return d;
        })()
      : new Set<string>();
    return orderedNodes
      .filter((n) => !excluded.has(n.id))
      .map((n) => ({ id: n.id, label: `${wbs.get(n.id) ?? ''} ${n.title}` }));
  }, [orderedNodes, editingId, tasks, wbs]);

  // 先行タスク候補：自分自身・子孫を除外
  const predecessorOptions = useMemo(() => {
    const excluded = editingId
      ? (() => {
          const d = collectDescendantIds(tasks, editingId);
          d.add(editingId);
          return d;
        })()
      : new Set<string>();
    return orderedNodes
      .filter((n) => !excluded.has(n.id))
      .map((n) => ({ id: n.id, label: `${wbs.get(n.id) ?? ''} ${n.title}` }));
  }, [orderedNodes, editingId, tasks, wbs]);

  const buildPayload = () => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    status: form.status,
    priority: form.priority,
    parentId: form.parentId || null,
    assigneeName: form.assigneeName.trim() || null,
    assigneeRoleId: form.assigneeRoleId || null,
    startDate: form.startDate || null,
    dueDate: form.dueDate || null,
    progress: clampProgress(form.progress),
    estimatedHours:
      form.estimatedHours === '' ? null : Number(form.estimatedHours),
    actualHours: form.actualHours === '' ? null : Number(form.actualHours),
    milestone: form.milestone,
    category: form.category.trim() || null,
    issueNodeId: form.issueNodeId || null,
  });

  // 依存関係（先行タスク）の差分を反映
  const syncDependencies = async (successorId: string) => {
    const existing = depsBySuccessor.get(successorId) ?? [];
    const existingIds = new Set(existing.map((d) => d.predecessorId));
    const target = new Set(form.predecessorIds);

    const toAdd = Array.from(target).filter((id) => !existingIds.has(id));
    const toRemove = existing.filter((d) => !target.has(d.predecessorId));

    await Promise.all([
      ...toAdd.map((predId) => tasksApi.addDep(successorId, predId)),
      ...toRemove.map((d) => tasksApi.removeDep(d.id)),
    ]);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError('タイトルは必須です');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await tasksApi.update(editingId, buildPayload());
        await syncDependencies(editingId);
      } else {
        const created = await tasksApi.create(projectId, buildPayload());
        if (created?.id && form.predecessorIds.length) {
          await Promise.all(
            form.predecessorIds.map((predId) =>
              tasksApi.addDep(created.id, predId)
            )
          );
        }
      }
      setDialogOpen(false);
      await fetchAll();
    } catch (err: any) {
      setError(err?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (task: Task) => {
    if (
      !confirm(
        `「${task.title}」を削除しますか？\nサブタスクがある場合は併せて削除される可能性があります。`
      )
    )
      return;
    try {
      await tasksApi.delete(task.id);
      await fetchAll();
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  const handleInlineStatus = async (task: Task, status: TaskStatus) => {
    // 楽観的更新
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status } : t))
    );
    try {
      await tasksApi.update(task.id, { status });
    } catch (err) {
      console.error('Failed to update status:', err);
      await fetchAll();
    }
  };

  // ボードでカードを別の状態カラムへドロップしたとき：状態を楽観的更新→失敗時はロールバック
  const handleBoardDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (
      destination.droppableId === source.droppableId &&
      destination.index === source.index
    ) {
      return;
    }
    const newStatus = destination.droppableId as TaskStatus;
    if (!TASK_STATUSES.includes(newStatus)) return;

    const current = tasks.find((t) => t.id === draggableId);
    if (!current || current.status === newStatus) return; // 同一カラム内の並べ替えはローカル状態のみ

    const prevStatus = current.status;
    setTasks((prev) =>
      prev.map((t) => (t.id === draggableId ? { ...t, status: newStatus } : t))
    );
    try {
      await tasksApi.update(draggableId, { status: newStatus });
    } catch (err) {
      console.error('Failed to update status (board):', err);
      // ロールバック
      setTasks((prev) =>
        prev.map((t) =>
          t.id === draggableId ? { ...t, status: prevStatus } : t
        )
      );
    }
  };

  const togglePredecessor = (id: string) => {
    setForm((f) => ({
      ...f,
      predecessorIds: f.predecessorIds.includes(id)
        ? f.predecessorIds.filter((x) => x !== id)
        : [...f.predecessorIds, id],
    }));
  };

  // ---------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="タスク管理"
        description="プロジェクトのタスクを WBS（作業分解）でバックログ的に管理します"
        help="タスクを親子（WBS）構造で整理し、状態・担当・期限・進捗を一覧で管理します。マイルストーンや先行タスク（依存関係）も登録でき、ガントチャートと連動します。"
        backHref={`/dashboard/projects/${projectId}`}
        actions={
          <>
            <HowToPanel
              steps={[
                '「タスクを追加」でタイトル・状態・優先度・担当・期限・進捗などを入力します。',
                '親タスクを選ぶとサブタスクとして WBS 番号（例 1.2.3）付きでインデント表示されます。',
                '先行タスクを指定すると依存関係が登録され、ガント／WBS 画面に反映されます。',
                '各行の状態バッジから直接ステータスを変更でき、鉛筆で編集・ゴミ箱で削除できます。',
                '上部の「一覧／ボード」で表示を切り替えられます。ボードではカードを別の列にドラッグして状態を変更できます。',
                '上部のフィルタ（状態・担当・マイルストーン・カテゴリ・キーワード）で絞り込めます。',
              ]}
            />
            <ManualButton feature="tasks" />
            {/* 表示切替：一覧 / ボード */}
            <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
              <button
                type="button"
                onClick={() => setView('list')}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'list'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                aria-pressed={view === 'list'}
              >
                <ListChecks className="h-4 w-4" />
                一覧
              </button>
              <button
                type="button"
                onClick={() => setView('board')}
                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === 'board'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
                aria-pressed={view === 'board'}
              >
                <Columns3 className="h-4 w-4" />
                ボード
              </button>
            </div>
            <Link href="./tasks/gantt">
              <Button variant="outline" className="gap-1.5">
                <GanttChartSquare className="h-4 w-4" />
                WBS/ガント
              </Button>
            </Link>
            <Button
              onClick={() => openCreate()}
              className="bg-blue-600 hover:bg-blue-700 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              タスクを追加
            </Button>
          </>
        }
      />

      {/* フィルタバー */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="キーワードで検索（タイトル・説明・担当・カテゴリ）"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-8 bg-white border-gray-300"
              />
            </div>

            <FilterSelect
              value={filterStatus}
              onChange={setFilterStatus}
              placeholder="状態"
              width="w-[130px]"
              options={[
                { value: 'ALL', label: 'すべての状態' },
                ...TASK_STATUSES.map((s) => ({
                  value: s,
                  label: taskStatusLabels[s].label,
                })),
              ]}
            />

            <FilterSelect
              value={filterAssignee}
              onChange={setFilterAssignee}
              placeholder="担当"
              width="w-[140px]"
              options={[
                { value: 'ALL', label: 'すべての担当' },
                ...assigneeOptions.map((a) => ({ value: a, label: a })),
              ]}
            />

            <FilterSelect
              value={filterMilestone}
              onChange={setFilterMilestone}
              placeholder="MS"
              width="w-[150px]"
              options={[
                { value: 'ALL', label: 'MS問わず' },
                { value: 'YES', label: 'マイルストーンのみ' },
                { value: 'NO', label: '通常タスクのみ' },
              ]}
            />

            <FilterSelect
              value={filterCategory}
              onChange={setFilterCategory}
              placeholder="カテゴリ"
              width="w-[150px]"
              options={[
                { value: 'ALL', label: 'すべてのカテゴリ' },
                ...categoryOptions.map((c) => ({ value: c, label: c })),
              ]}
            />

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-gray-500 gap-1"
              >
                <X className="h-3.5 w-3.5" />
                クリア
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 一覧 / ボード */}
      {tasks.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <ListTodo className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">タスクがありません</p>
            <p className="text-sm text-gray-400 mb-4">
              最初のタスクを追加して WBS を作りましょう
            </p>
            <Button
              onClick={() => openCreate()}
              className="bg-blue-600 hover:bg-blue-700 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              タスクを追加
            </Button>
          </CardContent>
        </Card>
      ) : view === 'board' ? (
        <KanbanBoard
          tasksByStatus={tasksByStatus}
          wbs={wbs}
          roleNameById={roleNameById}
          onDragEnd={handleBoardDragEnd}
        />
      ) : (
        <Card className="bg-white border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium text-gray-500">
                  <th className="px-3 py-2 w-[120px]">状態</th>
                  <th className="px-3 py-2 w-[90px]">種別/優先</th>
                  <th className="px-3 py-2">タイトル</th>
                  <th className="px-3 py-2 w-[150px]">担当</th>
                  <th className="px-3 py-2 w-[110px]">期限</th>
                  <th className="px-3 py-2 w-[140px]">進捗</th>
                  <th className="px-3 py-2 w-[100px] text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-3 py-8 text-center text-gray-400"
                    >
                      条件に一致するタスクがありません
                    </td>
                  </tr>
                ) : (
                  rows.map((node) => {
                    const status = taskStatusLabels[node.status];
                    const priority = taskPriorityLabels[node.priority];
                    const depth = node.depth;
                    const assignee =
                      node.assigneeName ||
                      (node.assigneeRoleId
                        ? roleNameById.get(node.assigneeRoleId)
                        : '') ||
                      '';
                    return (
                      <tr
                        key={node.id}
                        className="group border-b border-gray-100 hover:bg-gray-50"
                      >
                        {/* 状態（インライン変更） */}
                        <td className="px-3 py-2 align-top">
                          <Select
                            value={node.status}
                            onValueChange={(v) =>
                              handleInlineStatus(node, v as TaskStatus)
                            }
                          >
                            <SelectTrigger
                              className={`h-7 px-2 text-xs border ${status.color}`}
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
                        </td>

                        {/* 種別/優先度 */}
                        <td className="px-3 py-2 align-top">
                          <span
                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${priority.color}`}
                          >
                            {priority.label}
                          </span>
                        </td>

                        {/* タイトル（WBS番号＋インデント） */}
                        <td className="px-3 py-2 align-top">
                          <div
                            className="flex items-start gap-2"
                            style={{ paddingLeft: depth * 18 }}
                          >
                            <span className="mt-0.5 font-mono text-[11px] text-gray-400 tabular-nums">
                              {wbs.get(node.id)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                {node.milestone && (
                                  <Flag className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                )}
                                <Link
                                  href={`./tasks/${node.id}`}
                                  className="font-medium text-gray-900 hover:text-blue-600 hover:underline"
                                >
                                  {node.title}
                                </Link>
                                {node.category && (
                                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                                    {node.category}
                                  </span>
                                )}
                              </div>
                              {(depsBySuccessor.get(node.id)?.length ?? 0) >
                                0 && (
                                <div className="mt-0.5 text-[11px] text-gray-400">
                                  先行:{' '}
                                  {(depsBySuccessor.get(node.id) ?? [])
                                    .map(
                                      (d) =>
                                        taskTitleById.get(d.predecessorId) ??
                                        '?'
                                    )
                                    .join(', ')}
                                </div>
                              )}
                              <IssueOrigin
                                projectId={projectId}
                                task={node}
                                nodeRef={
                                  node.issueNodeId
                                    ? issueNodeById.get(node.issueNodeId)
                                    : undefined
                                }
                              />
                            </div>
                          </div>
                        </td>

                        {/* 担当 */}
                        <td className="px-3 py-2 align-top text-gray-700">
                          {assignee || (
                            <span className="text-gray-300">未割当</span>
                          )}
                        </td>

                        {/* 期限 */}
                        <td className="px-3 py-2 align-top text-gray-600 tabular-nums">
                          {node.dueDate ? node.dueDate.slice(0, 10) : '-'}
                        </td>

                        {/* 進捗 */}
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                              <div
                                className="h-1.5 rounded-full bg-blue-500"
                                style={{
                                  width: `${clampProgress(node.progress)}%`,
                                }}
                              />
                            </div>
                            <span className="w-9 text-right text-[11px] text-gray-500 tabular-nums">
                              {clampProgress(node.progress)}%
                            </span>
                          </div>
                        </td>

                        {/* 操作 */}
                        <td className="px-3 py-2 align-top">
                          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="サブタスクを追加"
                              onClick={() => openCreate(node.id)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="編集"
                              onClick={() => openEdit(node)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                              title="削除"
                              onClick={() => handleDelete(node)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* 作成/編集ダイアログ */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-white border-gray-200 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-gray-900">
              {editingId ? 'タスクを編集' : 'タスクを追加'}
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              タイトル・状態・担当・期限・進捗・依存関係を設定します
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Field label="タイトル">
              <Input
                placeholder="例：在庫マスタの設計"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="bg-white border-gray-300"
              />
            </Field>

            <Field label="説明">
              <Textarea
                placeholder="タスクの詳細..."
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="bg-white border-gray-300 min-h-[70px]"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="状態">
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as TaskStatus })
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
              </Field>

              <Field label="優先度">
                <Select
                  value={form.priority}
                  onValueChange={(v) =>
                    setForm({ ...form, priority: v as TaskPriority })
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
              </Field>
            </div>

            <Field
              label="親タスク"
              help="選ぶとサブタスクになります。自分自身とその子孫は選べません。"
            >
              <Select
                value={form.parentId || NONE}
                onValueChange={(v) =>
                  setForm({ ...form, parentId: v === NONE ? '' : v })
                }
              >
                <SelectTrigger className="bg-white border-gray-300">
                  <SelectValue placeholder="（トップレベル）" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value={NONE}>（トップレベル）</SelectItem>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="担当（氏名）">
                <Input
                  placeholder="例：山田"
                  value={form.assigneeName}
                  onChange={(e) =>
                    setForm({ ...form, assigneeName: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </Field>

              <Field label="担当ロール">
                <Select
                  value={form.assigneeRoleId || NONE}
                  onValueChange={(v) =>
                    setForm({ ...form, assigneeRoleId: v === NONE ? '' : v })
                  }
                >
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue placeholder="（未選択）" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value={NONE}>（未選択）</SelectItem>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="開始日">
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </Field>
              <Field label="期限">
                <Input
                  type="date"
                  value={form.dueDate}
                  onChange={(e) =>
                    setForm({ ...form, dueDate: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </Field>
            </div>

            <Field label={`進捗（${clampProgress(form.progress)}%）`}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={clampProgress(form.progress)}
                onChange={(e) =>
                  setForm({ ...form, progress: Number(e.target.value) })
                }
                className="w-full accent-blue-600"
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field label="予定工数（h）">
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.estimatedHours}
                  onChange={(e) =>
                    setForm({ ...form, estimatedHours: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </Field>
              <Field label="実績工数（h）">
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={form.actualHours}
                  onChange={(e) =>
                    setForm({ ...form, actualHours: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="カテゴリ">
                <Input
                  placeholder="例：設計"
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </Field>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.milestone}
                    onChange={(e) =>
                      setForm({ ...form, milestone: e.target.checked })
                    }
                    className="h-4 w-4 accent-amber-500"
                  />
                  <span className="flex items-center gap-1">
                    <Flag className="h-3.5 w-3.5 text-amber-500" />
                    マイルストーン
                  </span>
                </label>
              </div>
            </div>

            <Field
              label="先行タスク（依存関係）"
              help="このタスクの前に完了している必要があるタスクを選びます。"
            >
              {predecessorOptions.length === 0 ? (
                <p className="text-xs text-gray-400">
                  選択できる他のタスクがありません
                </p>
              ) : (
                <div className="max-h-36 overflow-y-auto rounded-md border border-gray-200 p-2 space-y-1">
                  {predecessorOptions.map((o) => (
                    <label
                      key={o.id}
                      className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={form.predecessorIds.includes(o.id)}
                        onChange={() => togglePredecessor(o.id)}
                        className="h-4 w-4 accent-blue-600"
                      />
                      <span className="truncate">{o.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </Field>

            <Field
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
                    value={form.issueNodeId || NONE}
                    onValueChange={(v) =>
                      setForm({ ...form, issueNodeId: v === NONE ? '' : v })
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
                  {form.issueNodeId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, issueNodeId: '' })}
                      className="shrink-0 gap-1 text-gray-500"
                    >
                      <X className="h-3.5 w-3.5" />
                      クリア
                    </Button>
                  )}
                </div>
              )}
            </Field>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleSave}
              disabled={!form.title.trim() || saving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  保存中...
                </>
              ) : editingId ? (
                '更新'
              ) : (
                '追加'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

/**
 * タスクの「由来」表示。紐付いた課題ノードのラベルと種別チップ
 * （調査=amber / 打ち手=blue）を出し、課題ツリーへリンクする。
 * nodeRef（列挙 API 由来・treeId を持つ）があればそれを優先し、
 * 無ければ TaskOutput の issueNodeLabel/issueNodeKind にフォールバックする。
 */
function IssueOrigin({
  projectId,
  task,
  nodeRef,
}: {
  projectId: string;
  task: Task;
  nodeRef?: IssueNodeRef;
}) {
  const label = nodeRef?.label ?? task.issueNodeLabel ?? null;
  const kind = nodeRef?.kind ?? task.issueNodeKind ?? null;
  if (!task.issueNodeId || !label || !kind) return null;
  const meta = issueNodeKindMeta(kind);
  const treeId = nodeRef?.treeId ?? null;
  const inner = (
    <span className="inline-flex items-center gap-1">
      <GitBranch className="h-3 w-3 text-gray-400" />
      <span
        className={`inline-flex items-center rounded border px-1 py-px text-[10px] ${meta.chip}`}
      >
        {meta.label}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
  return (
    <div className="mt-0.5 text-[11px] text-gray-500">
      <span className="text-gray-400">由来: </span>
      {treeId ? (
        <Link
          href={`/dashboard/projects/${projectId}/issue-trees/${treeId}`}
          className="hover:text-blue-600 hover:underline"
        >
          {inner}
        </Link>
      ) : (
        inner
      )}
    </div>
  );
}

function Field({
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

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
  width: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`${width} bg-white border-gray-300 h-10`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="bg-white">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// KANBAN ボード
// ---------------------------------------------------------------------------

function KanbanBoard({
  tasksByStatus,
  wbs,
  roleNameById,
  onDragEnd,
}: {
  tasksByStatus: Record<TaskStatus, TaskTreeNode[]>;
  wbs: Map<string, string>;
  roleNameById: Map<string, string>;
  onDragEnd: (result: DropResult) => void;
}) {
  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {TASK_STATUSES.map((status) => {
          const meta = taskStatusLabels[status];
          const cards = tasksByStatus[status] ?? [];
          return (
            <Droppable droppableId={status} key={status}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`flex min-h-[160px] flex-col rounded-lg border bg-gray-50/60 transition-colors ${
                    snapshot.isDraggingOver
                      ? 'border-blue-300 bg-blue-50/60'
                      : 'border-gray-200'
                  }`}
                >
                  {/* カラムヘッダ */}
                  <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${meta.color}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                      {meta.label}
                    </span>
                    <span className="text-xs font-medium text-gray-400 tabular-nums">
                      {cards.length}
                    </span>
                  </div>

                  {/* カード一覧 */}
                  <div className="flex-1 space-y-2 p-2">
                    {cards.length === 0 && !snapshot.isDraggingOver && (
                      <p className="px-1 py-6 text-center text-xs text-gray-300">
                        タスクなし
                      </p>
                    )}
                    {cards.map((node, index) => (
                      <KanbanCard
                        key={node.id}
                        node={node}
                        index={index}
                        wbsNo={wbs.get(node.id)}
                        roleNameById={roleNameById}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                </div>
              )}
            </Droppable>
          );
        })}
      </div>
    </DragDropContext>
  );
}

function KanbanCard({
  node,
  index,
  wbsNo,
  roleNameById,
}: {
  node: TaskTreeNode;
  index: number;
  wbsNo?: string;
  roleNameById: Map<string, string>;
}) {
  const priority = taskPriorityLabels[node.priority];
  const assignee =
    node.assigneeName ||
    (node.assigneeRoleId ? roleNameById.get(node.assigneeRoleId) : '') ||
    '';
  const progress = clampProgress(node.progress);

  return (
    <Draggable draggableId={node.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          style={provided.draggableProps.style as React.CSSProperties}
          className={`rounded-md border bg-white p-2.5 shadow-sm transition-shadow ${
            snapshot.isDragging
              ? 'border-blue-300 shadow-md ring-1 ring-blue-200'
              : 'border-gray-200 hover:border-gray-300 hover:shadow'
          }`}
        >
          {/* 上段：優先度・WBS */}
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${priority.color}`}
            >
              優先度 {priority.label}
            </span>
            {wbsNo && (
              <span className="font-mono text-[10px] tabular-nums text-gray-400">
                {wbsNo}
              </span>
            )}
          </div>

          {/* タイトル（クリックで詳細へ） */}
          <div className="flex items-start gap-1.5">
            {node.milestone && (
              <Flag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            <Link
              href={`./tasks/${node.id}`}
              className="block text-sm font-medium leading-snug text-gray-900 hover:text-blue-600 hover:underline"
            >
              {node.title}
            </Link>
          </div>

          {node.category && (
            <span className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
              {node.category}
            </span>
          )}

          {/* メタ：担当・期限 */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3 text-gray-400" />
              {assignee || <span className="text-gray-300">未割当</span>}
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CalendarDays className="h-3 w-3 text-gray-400" />
              {node.dueDate ? node.dueDate.slice(0, 10) : '-'}
            </span>
          </div>

          {/* 進捗 */}
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-gray-100">
              <div
                className="h-1.5 rounded-full bg-blue-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="w-8 text-right text-[10px] tabular-nums text-gray-500">
              {progress}%
            </span>
          </div>
        </div>
      )}
    </Draggable>
  );
}
