'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { useReadOnly } from '@/components/read-only-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  GanttChartSquare,
  Network,
  ListTodo,
  Link2,
  X,
  Plus,
  Maximize2,
  Minimize2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import {
  tasksApi,
  buildTaskTree,
  computeWbsNumbers,
  flattenTaskTree,
  collectDescendantIds,
  TASK_STATUSES,
  TASK_PRIORITIES,
  taskStatusLabels,
  taskPriorityLabels,
  type Task,
  type TaskDependency,
  type TaskStatus,
  type TaskPriority,
  type TaskTreeNode,
  type IssueNodeRef,
} from '@/lib/tasks';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';
import { listStakeholders, type Stakeholder } from '@/lib/stakeholders';
import { StakeholderPicker } from '@/components/ui/stakeholder-picker';
import { UserAvatar } from '@/components/ui/user-avatar';
import { authApi } from '@/lib/api';
import {
  mapTasksToFrappe,
  dateToYmd,
} from '@/components/gantt/frappe-mapping';
import type {
  FrappeGanttProps,
} from '@/components/gantt/FrappeGantt';
import type { FrappeViewMode } from 'frappe-gantt';

// frappe-gantt は DOM 依存のクライアント専用ライブラリのため、SSR を切って動的読み込み。
const FrappeGantt = dynamic<FrappeGanttProps>(
  () => import('@/components/gantt/FrappeGantt'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </div>
    ),
  }
);

type ZoomMode = 'day' | 'week' | 'month';

const VIEW_MODE_MAP: Record<ZoomMode, FrappeViewMode> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

const ZOOM_OPTIONS: { mode: ZoomMode; label: string; title: string }[] = [
  { mode: 'day', label: '日', title: '日表示（拡大）' },
  { mode: 'week', label: '週', title: '週表示' },
  { mode: 'month', label: '月', title: '月表示（縮小）' },
];

// 右側の編集サイドバーのフォーム状態（tasks ページの編集ダイアログ FormState の簡易版）。
type SidebarForm = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string;
  startDate: string;
  dueDate: string;
  progress: number;
  estimatedHours: string;
  /** 論点（課題/調査ツリーのノードへの紐付け）。'' は未設定。 */
  issueNodeId: string;
  /** 達成条件（自由記述）。 */
  acceptanceCriteria: string;
  /** 領域（SubProject）。'' は未設定。 */
  subProjectId: string;
};

const emptySidebarForm: SidebarForm = {
  title: '',
  description: '',
  status: 'OPEN',
  priority: 'MEDIUM',
  assigneeName: '',
  startDate: '',
  dueDate: '',
  progress: 0,
  estimatedHours: '',
  issueNodeId: '',
  acceptanceCriteria: '',
  subProjectId: '',
};

export default function GanttPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  // 論点ピッカー用: プロジェクト配下の課題/調査ツリーの全ノード（ツリー横断・フラット）。
  const [issueNodes, setIssueNodes] = useState<IssueNodeRef[]>([]);
  // イシューツリーから自動生成: ドロップダウン開閉・生成中フラグ。
  const [genTreeOpen, setGenTreeOpen] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  // 領域（SubProject）一覧と、ガントを領域で絞り込むフィルタ（'' = すべて）。
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  // 担当者ピッカー用: プロジェクトのステークホルダー一覧。
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  // 現在ログイン中ユーザー（自分が担当のときプロフィール画像を出すため）。
  const [me, setMe] = useState<{ name: string | null; avatarUrl: string | null } | null>(null);
  const [areaFilter, setAreaFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomMode>('day');

  // 依存関係パネルで編集対象に選ぶタスク。
  const [depTaskId, setDepTaskId] = useState<string>('');
  // 「先行に追加」プルダウンの選択値。
  const [pickPredId, setPickPredId] = useState<string>('');

  // WBS 左タスクツリーパネル: パネル自体の開閉と、折りたたみ中の親タスク id 集合。
  const [wbsPanelOpen, setWbsPanelOpen] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  // 「表示階層」セレクタの表示値（'' は未選択）。
  const [depthValue, setDepthValue] = useState('');

  // ガントカードの全画面表示トグル（他ページの全画面と同じ作法）。
  const [isFullscreen, setIsFullscreen] = useState(false);

  // バークリックで開く右側の編集サイドバー（ページ遷移はしない）。
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [sidebarForm, setSidebarForm] = useState<SidebarForm>(emptySidebarForm);
  const [sidebarSaving, setSidebarSaving] = useState(false);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  // バックドロップの即閉じ（バーをダブルクリックした 2 打目で閉じる等）対策:
  // 開いた直後 300ms は閉じない＋mousedown がバックドロップ上で始まったときだけ閉じる。
  const sidebarOpenedAtRef = useRef(0);
  const backdropMouseDownRef = useRef(false);

  // ツリーの開閉状態は localStorage にプロジェクト毎キーで保持する。
  const wbsCollapseStorageKey = `gantt-wbs-collapsed:${projectId}`;
  const wbsPanelStorageKey = `gantt-wbs-panel:${projectId}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(wbsCollapseStorageKey);
      if (raw) setCollapsedIds(new Set(JSON.parse(raw) as string[]));
      const panel = localStorage.getItem(wbsPanelStorageKey);
      if (panel != null) setWbsPanelOpen(panel !== 'closed');
    } catch {
      // localStorage 不可（プライベートモード等）は既定値のまま。
    }
  }, [wbsCollapseStorageKey, wbsPanelStorageKey]);

  const updateCollapsed = useCallback(
    (next: Set<string>) => {
      setCollapsedIds(next);
      try {
        localStorage.setItem(
          wbsCollapseStorageKey,
          JSON.stringify(Array.from(next))
        );
      } catch {
        // 保存失敗は無視（表示状態は維持される）。
      }
    },
    [wbsCollapseStorageKey]
  );

  const toggleWbsPanel = useCallback(() => {
    setWbsPanelOpen((open) => {
      try {
        localStorage.setItem(wbsPanelStorageKey, open ? 'closed' : 'open');
      } catch {
        // 保存失敗は無視。
      }
      return !open;
    });
  }, [wbsPanelStorageKey]);

  // ---------------------------------------------------------------------
  // データ取得
  // ---------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    try {
      const data = await tasksApi.list(projectId);
      setTasks(data.tasks ?? []);
      setDependencies(data.dependencies ?? []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // 論点ピッカー用に、課題/調査ツリーの全ノードをツリー横断で取得（kind 指定なし＝全件）。
  useEffect(() => {
    tasksApi
      .listIssueNodes(projectId)
      .then(setIssueNodes)
      .catch(() => setIssueNodes([]));
  }, [projectId]);

  // 領域（SubProject）一覧を取得（領域ピッカー・領域フィルタの選択肢）。
  useEffect(() => {
    subProjectApi
      .list(projectId)
      .then(setSubProjects)
      .catch(() => setSubProjects([]));
  }, [projectId]);

  // 担当者ピッカー用にステークホルダー一覧を取得。
  useEffect(() => {
    listStakeholders(projectId)
      .then(setStakeholders)
      .catch(() => setStakeholders([]));
  }, [projectId]);

  // 現在ユーザーを取得（担当者名が自分なら自分のアイコン画像を表示する）。
  useEffect(() => {
    authApi
      .me()
      .then((u) => setMe({ name: u?.name ?? null, avatarUrl: u?.avatarUrl ?? null }))
      .catch(() => setMe(null));
  }, []);

  // 担当者名に対応するアイコン画像URL（自分の担当分のみ解決。他は頭文字にフォールバック）。
  const avatarFor = useCallback(
    (name: string | null | undefined): string | null =>
      me && me.name && name && name === me.name ? me.avatarUrl : null,
    [me],
  );

  // 領域ID → 名前。タスク行の領域表示やフィルタラベルに使う。
  const subProjectName = useCallback(
    (id: string | null | undefined) =>
      id ? subProjects.find((s) => s.id === id)?.name ?? null : null,
    [subProjects],
  );

  // 領域フィルタ適用後のタスク（'' のときは全件）。ガントのバー・ツリー両方の元データ。
  const filteredTasks = useMemo(
    () =>
      areaFilter
        ? tasks.filter((t) => (t.subProjectId ?? '') === areaFilter)
        : tasks,
    [tasks, areaFilter],
  );

  // 論点セレクトの optgroup 用に、ツリー名でグルーピング。
  const issueNodesByTree = useMemo(() => {
    const m = new Map<string, IssueNodeRef[]>();
    for (const n of issueNodes) {
      const list = m.get(n.treeTitle) ?? [];
      list.push(n);
      m.set(n.treeTitle, list);
    }
    return Array.from(m.entries());
  }, [issueNodes]);

  // 自動生成のツリー選択肢（issueNodes から treeId で一意化）。
  const issueTrees = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of issueNodes) if (!m.has(n.treeId)) m.set(n.treeId, n.treeTitle);
    return Array.from(m.entries()).map(([treeId, treeTitle]) => ({
      treeId,
      treeTitle,
    }));
  }, [issueNodes]);

  // イシューツリー1本から打ち手・行動ノードをタスク化（一旦のガント生成）。
  const handleGenerateFromTree = useCallback(
    async (treeId: string, treeTitle: string) => {
      if (!canEdit) return;
      setGenTreeOpen(false);
      if (
        !window.confirm(
          `「${treeTitle}」の打ち手・行動ノードからタスクを生成します。よろしいですか？`,
        )
      ) {
        return;
      }
      setGenBusy(true);
      try {
        const res = await tasksApi.generateFromIssueTree(projectId, treeId);
        await fetchAll();
        window.alert(
          `タスクを ${res.created} 件生成しました${
            res.skipped ? `（既にタスク化済み ${res.skipped} 件はスキップ）` : ''
          }。`,
        );
      } catch {
        window.alert('生成に失敗しました');
      } finally {
        setGenBusy(false);
      }
    },
    [canEdit, projectId, fetchAll],
  );

  // ---------------------------------------------------------------------
  // ドメイン -> frappe-gantt データ（WBS 表示順）
  // ---------------------------------------------------------------------
  const frappeTasks = useMemo(
    () => mapTasksToFrappe(filteredTasks, dependencies),
    [filteredTasks, dependencies]
  );

  // WBS 番号・表示順（依存関係パネルのラベル・並び用）。
  const tree = useMemo(() => buildTaskTree(filteredTasks), [filteredTasks]);
  const wbs = useMemo(() => computeWbsNumbers(tree), [tree]);

  // ---------------------------------------------------------------------
  // WBS 左タスクツリー（折りたたみはツリーとガント両方に効く）
  // ---------------------------------------------------------------------

  // 折りたたまれた親の子孫 id（ツリーからもガントからも非表示にする）。
  const hiddenTaskIds = useMemo(() => {
    const hidden = new Set<string>();
    collapsedIds.forEach((id) => {
      collectDescendantIds(tasks, id).forEach((d) => hidden.add(d));
    });
    return hidden;
  }, [tasks, collapsedIds]);

  // ガントへ渡す表示タスク。非表示タスクは依存（矢印）の参照からも取り除く
  // （vendor はドラッグ時に依存バーの位置を引くため、欠けた id 参照が残ると壊れる）。
  const visibleFrappeTasks = useMemo(() => {
    if (hiddenTaskIds.size === 0) return frappeTasks;
    return frappeTasks
      .filter((t) => !hiddenTaskIds.has(t.id))
      .map((t) => {
        const depsRaw = t.dependencies;
        const deps =
          typeof depsRaw === 'string'
            ? depsRaw.split(',').filter(Boolean)
            : depsRaw ?? [];
        const kept = deps.filter((d) => !hiddenTaskIds.has(d));
        if (kept.length === deps.length) return t;
        return { ...t, dependencies: kept.join(',') };
      });
  }, [frappeTasks, hiddenTaskIds]);

  // ツリーパネルに描画する行（折りたたまれた親の子孫は出さない）。
  const wbsRows = useMemo(() => {
    const rows: TaskTreeNode[] = [];
    const walk = (nodes: TaskTreeNode[]) => {
      for (const n of nodes) {
        rows.push(n);
        if (n.children.length > 0 && !collapsedIds.has(n.id)) walk(n.children);
      }
    };
    walk(tree);
    return rows;
  }, [tree, collapsedIds]);

  // 子を持つタスク id（すべて折りたたみ・表示階層の対象）。
  const parentTaskIds = useMemo(
    () =>
      flattenTaskTree(tree)
        .filter((n) => n.children.length > 0)
        .map((n) => n.id),
    [tree]
  );

  const expandAll = useCallback(() => {
    setDepthValue('all');
    updateCollapsed(new Set());
  }, [updateCollapsed]);

  const collapseAll = useCallback(() => {
    setDepthValue('1');
    updateCollapsed(new Set(parentTaskIds));
  }, [parentTaskIds, updateCollapsed]);

  // 表示階層セレクタ: 選んだ深さ（1/2/3/全部）まで展開し、それ以深は折りたたむ。
  const applyDepth = useCallback(
    (value: string) => {
      setDepthValue(value);
      if (value === 'all') {
        updateCollapsed(new Set());
        return;
      }
      const depth = Number(value);
      if (!Number.isFinite(depth) || depth < 1) return;
      const next = new Set(
        flattenTaskTree(tree)
          .filter((n) => n.children.length > 0 && n.depth >= depth - 1)
          .map((n) => n.id)
      );
      updateCollapsed(next);
    },
    [tree, updateCollapsed]
  );

  const toggleCollapse = useCallback(
    (id: string) => {
      const next = new Set(Array.from(collapsedIds));
      if (next.has(id)) next.delete(id);
      else next.add(id);
      updateCollapsed(next);
    },
    [collapsedIds, updateCollapsed]
  );

  // WBS 表示順に並べた一覧（id / 表示ラベル）。
  const orderedTaskList = useMemo(() => {
    return [...tasks]
      .map((t) => ({
        id: t.id,
        title: t.title,
        wbs: wbs.get(t.id) ?? '',
      }))
      .sort((a, b) => {
        // WBS 文字列を数値ごとに比較（'1.10' > '1.2'）。
        const pa = a.wbs.split('.').map(Number);
        const pb = b.wbs.split('.').map(Number);
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
          const da = pa[i] ?? 0;
          const db = pb[i] ?? 0;
          if (da !== db) return da - db;
        }
        return a.title.localeCompare(b.title);
      });
  }, [tasks, wbs]);

  const taskLabel = useCallback(
    (id: string) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return id;
      const num = wbs.get(id);
      return num ? `${num} ${t.title}` : t.title;
    },
    [tasks, wbs]
  );

  // ---------------------------------------------------------------------
  // ガント操作 -> バックエンド
  // ---------------------------------------------------------------------

  // バー移動 / リサイズ確定。frappe の end は終了日「込み」なのでそのまま期限日にする。
  const handleDateChange = useCallback(
    async (id: string, start: Date, end: Date) => {
      if (!canEdit) return;
      try {
        await tasksApi.update(id, {
          startDate: dateToYmd(start),
          dueDate: dateToYmd(end),
        });
        await fetchAll();
      } catch (err) {
        console.error('Failed to update task dates:', err);
        await fetchAll();
      }
    },
    [fetchAll, canEdit]
  );

  // 進捗ハンドル操作確定。
  const handleProgressChange = useCallback(
    async (id: string, progress: number) => {
      if (!canEdit) return;
      try {
        await tasksApi.update(id, {
          progress: Math.max(0, Math.min(100, Math.round(progress))),
        });
        await fetchAll();
      } catch (err) {
        console.error('Failed to update task progress:', err);
        await fetchAll();
      }
    },
    [fetchAll, canEdit]
  );

  // バークリック（通常モード）: 右側の編集サイドバーを開き、フォームへ現在値を流し込む。
  const openTaskSidebar = useCallback(
    (id: string) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return;
      setSidebarForm({
        title: t.title,
        description: t.description ?? '',
        status: t.status,
        priority: t.priority,
        assigneeName: t.assigneeName ?? '',
        startDate: t.startDate ? t.startDate.slice(0, 10) : '',
        dueDate: t.dueDate ? t.dueDate.slice(0, 10) : '',
        progress: t.progress ?? 0,
        estimatedHours:
          t.estimatedHours != null ? String(t.estimatedHours) : '',
        issueNodeId: t.issueNodeId ?? '',
        acceptanceCriteria: t.acceptanceCriteria ?? '',
        subProjectId: t.subProjectId ?? '',
      });
      setSidebarError(null);
      sidebarOpenedAtRef.current = Date.now();
      setSelectedTaskId(id);
    },
    [tasks]
  );

  const closeSidebar = useCallback(() => setSelectedTaskId(null), []);

  // サイドバーの保存。成功後はタスク一覧を再取得してガントに反映し、サイドバーは開いたまま。
  const handleSidebarSave = useCallback(async () => {
    if (!canEdit) return;
    if (!selectedTaskId) return;
    if (!sidebarForm.title.trim()) {
      setSidebarError('タイトルは必須です');
      return;
    }
    setSidebarSaving(true);
    setSidebarError(null);
    try {
      await tasksApi.update(selectedTaskId, {
        title: sidebarForm.title.trim(),
        description: sidebarForm.description.trim() || null,
        status: sidebarForm.status,
        priority: sidebarForm.priority,
        assigneeName: sidebarForm.assigneeName.trim() || null,
        startDate: sidebarForm.startDate || null,
        dueDate: sidebarForm.dueDate || null,
        progress: Math.max(
          0,
          Math.min(100, Math.round(Number(sidebarForm.progress) || 0))
        ),
        estimatedHours:
          sidebarForm.estimatedHours === ''
            ? null
            : Number(sidebarForm.estimatedHours),
        issueNodeId: sidebarForm.issueNodeId || null,
        acceptanceCriteria: sidebarForm.acceptanceCriteria.trim() || null,
        subProjectId: sidebarForm.subProjectId || null,
      });
      await fetchAll();
    } catch (err) {
      console.error('Failed to update task:', err);
      setSidebarError('保存に失敗しました');
    } finally {
      setSidebarSaving(false);
    }
  }, [selectedTaskId, sidebarForm, fetchAll, canEdit]);

  // サイドバーで編集中のタスク（再取得後も tasks から引き直す）。消えていたら閉じる扱い。
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  // 再取得の結果、編集中のタスク自体が消えていたら選択も解除する
  // （selectedTaskId だけが残って次回の開閉判定を汚さないように）。
  useEffect(() => {
    if (selectedTaskId && !selectedTask) setSelectedTaskId(null);
  }, [selectedTaskId, selectedTask]);

  // 接続ドラッグ成立（バー右端の丸ハンドル→相手バーで離す）:
  // 先行(fromId)→後続(toId) の依存を作成する。
  const handleConnect = useCallback(
    (fromId: string, toId: string) => {
      if (!canEdit) return;
      if (fromId === toId) return;
      // 同一依存が既にあれば何もしない（重複防止）。逆向きの重複も防ぐ。
      const exists = dependencies.some(
        (d) =>
          (d.predecessorId === fromId && d.successorId === toId) ||
          (d.predecessorId === toId && d.successorId === fromId)
      );
      if (exists) return;
      void (async () => {
        try {
          await tasksApi.addDep(toId, fromId);
          await fetchAll();
        } catch (err) {
          console.error('Failed to add dependency:', err);
          await fetchAll();
        }
      })();
    },
    [dependencies, fetchAll, canEdit]
  );

  // 矢印クリック -> その依存を削除（確認あり）。
  const handleArrowClick = useCallback(
    async (fromId: string, toId: string) => {
      if (!canEdit) return;
      const dep = dependencies.find(
        (d) => d.predecessorId === fromId && d.successorId === toId
      );
      if (!dep) return;
      if (!window.confirm('この依存(矢印)を削除しますか？')) return;
      try {
        await tasksApi.removeDep(dep.id);
        await fetchAll();
      } catch (err) {
        console.error('Failed to remove dependency:', err);
        await fetchAll();
      }
    },
    [dependencies, fetchAll, canEdit]
  );

  // 親タスクの変更（GUI）。'' は「なし（トップレベル）」= parentId:null。
  const handleParentChange = useCallback(
    async (value: string) => {
      if (!canEdit) return;
      if (!depTaskId) return;
      try {
        await tasksApi.update(depTaskId, { parentId: value || null });
        await fetchAll();
      } catch (err) {
        console.error('Failed to update parent:', err);
        await fetchAll();
      }
    },
    [depTaskId, fetchAll, canEdit]
  );

  // ESC で全画面を解除（入力欄フォーカス中は無視）。他ページの全画面と同じ作法。
  // 編集サイドバーが開いている間は、ESC はまずサイドバーを閉じる（下の effect）に譲る。
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      // Radix Select 等が処理済みの Esc（ドロップダウンを閉じる）とは衝突させない。
      if (e.defaultPrevented) return;
      if (e.key !== 'Escape') return;
      if (selectedTaskId) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t?.isContentEditable
      ) {
        return;
      }
      setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, selectedTaskId]);

  // ESC で編集サイドバーを閉じる（入力欄フォーカス中は無視）。
  useEffect(() => {
    if (!selectedTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      // Radix Select の Esc（ドロップダウンを閉じる）とは衝突させない。
      if (e.defaultPrevented) return;
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t?.isContentEditable
      ) {
        return;
      }
      setSelectedTaskId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTaskId]);

  // ---------------------------------------------------------------------
  // 依存関係パネル -> バックエンド
  // ---------------------------------------------------------------------

  // 先行を追加: addDep(後続Id=選択中タスク, 先行Id=ピック)。
  const handleAddPredecessor = useCallback(async () => {
    if (!canEdit) return;
    if (!depTaskId || !pickPredId) return;
    try {
      await tasksApi.addDep(depTaskId, pickPredId);
      setPickPredId('');
      await fetchAll();
    } catch (err) {
      console.error('Failed to add dependency:', err);
      await fetchAll();
    }
  }, [depTaskId, pickPredId, fetchAll, canEdit]);

  // 依存を削除: removeDep(dependency.id)。
  const handleRemoveDep = useCallback(
    async (dependencyId: string) => {
      if (!canEdit) return;
      try {
        await tasksApi.removeDep(dependencyId);
        await fetchAll();
      } catch (err) {
        console.error('Failed to remove dependency:', err);
        await fetchAll();
      }
    },
    [fetchAll, canEdit]
  );

  // 選択中タスクを後続とする既存依存（先行リスト）。
  const currentDeps = useMemo(
    () => dependencies.filter((d) => d.successorId === depTaskId),
    [dependencies, depTaskId]
  );

  // 先行候補: 自分・自分の子孫・既に先行になっているものを除外（循環/重複防止）。
  const predecessorCandidates = useMemo(() => {
    if (!depTaskId) return [];
    const descendants = collectDescendantIds(tasks, depTaskId);
    const already = new Set(currentDeps.map((d) => d.predecessorId));
    return orderedTaskList.filter(
      (t) =>
        t.id !== depTaskId && !descendants.has(t.id) && !already.has(t.id)
    );
  }, [depTaskId, tasks, currentDeps, orderedTaskList]);

  // 親タスク候補: 自分・自分の子孫を除外（循環防止）。WBS 表示順。
  const parentCandidates = useMemo(() => {
    if (!depTaskId) return [];
    const descendants = collectDescendantIds(tasks, depTaskId);
    return orderedTaskList.filter(
      (t) => t.id !== depTaskId && !descendants.has(t.id)
    );
  }, [depTaskId, tasks, orderedTaskList]);

  // 選択中タスクの現在の親 id（なしは ''）。Select の value 用。
  const currentParentId = useMemo(
    () => tasks.find((t) => t.id === depTaskId)?.parentId ?? '',
    [tasks, depTaskId]
  );

  // ---------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <GanttChartSquare className="h-5 w-5 text-blue-600" />
            WBS / ガントチャート
          </span>
        }
        description="バーをドラッグで移動・端を掴んでリサイズ・進捗ハンドルで進捗を編集できます（変更は即保存）。バー右端の丸ハンドルをドラッグして相手のバーで離すと依存（矢印）が引け、矢印クリックで削除できます。左のタスクツリーで階層の展開/折りたたみもできます。"
        help="左のタスクツリーと右のタイムラインで構成されます。バーは開始日〜期限、塗りは進捗です。バーをドラッグすると開始日・期限が、端のハンドルで期間が、進捗ハンドルで進捗が更新され、すべて自動でサーバに保存されます。マウスでの依存編集は、(1) バー右端に表示される丸い接続ハンドルをドラッグし、先行→後続の向きで相手のバーの上で離すと矢印（依存）が引ける、(2) 矢印をクリックすると確認のうえ依存を削除、で行えます。バークリックやツリーの行クリックで右側に編集サイドバーが開きます（コメント・添付は「詳細ページへ」リンクから）。親子関係（親タスク）は下のパネルのセレクトで変更できます。"
        backHref={`/dashboard/projects/${projectId}/tasks`}
        backLabel="タスク管理に戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                'バー本体を左右にドラッグすると、開始日と期限がスライドして即保存されます。',
                'バーの左右の端を掴んでドラッグすると、開始日／期限だけを伸縮できます。',
                'バー上の進捗ハンドル（バー右端の小さなつまみ）をドラッグすると進捗％が更新されます。',
                'バー右端の丸い接続ハンドルをドラッグし、後続タスクのバーの上で離すと依存（矢印）が引けます（ESC で中断）。',
                '依存の矢印をクリックすると、確認のうえその依存を削除できます。',
                '左のタスクツリーで親タスクの展開/折りたたみができ、折りたたんだ子孫はガントからも隠れます（行クリックで編集サイドバー）。',
                '親子関係は下のパネルの「親タスク」セレクトで変更できます（依存の追加・削除も同パネルで可能）。',
                'バー本体のクリックで右側に編集サイドバーが開きます（コメント・添付は「詳細ページへ」リンクから）。',
                '右上の「日 / 週 / 月」で目盛りの粒度を切り替えられます。',
              ]}
            />
            <ManualButton feature="tasks-gantt" />
            {canEdit && issueTrees.length > 0 && (
              <div className="relative flex items-center gap-1">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={genBusy}
                  onClick={() => setGenTreeOpen((v) => !v)}
                >
                  {genBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Network className="h-4 w-4" />
                  )}
                  イシューツリーから生成
                </Button>
                <HelpTooltip text="課題 / 調査 / 打ち手ツリーの「打ち手・行動ノード（打ち手・解決候補・アクション）」を、このガントのタスクとして一括生成します。ノード名がタスク名になり、そのノードが各タスクの『論点』に自動で紐づきます。ツリーの親子関係はタスクの親子に引き継がれ、開始日・期限は空のまま（あとから調整してください）。すでにタスク化済みのノードはスキップするので、何度押しても重複しません。" />
                {genTreeOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setGenTreeOpen(false)}
                    />
                    <div className="absolute right-0 z-50 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                      <p className="px-3 py-1 text-[11px] text-gray-400">
                        ツリーを選んで打ち手をタスク化
                      </p>
                      {issueTrees.map((t) => (
                        <button
                          key={t.treeId}
                          type="button"
                          onClick={() =>
                            handleGenerateFromTree(t.treeId, t.treeTitle)
                          }
                          className="block w-full truncate px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-blue-50"
                        >
                          {t.treeTitle}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <Link href={`/dashboard/projects/${projectId}/tasks`}>
              <Button variant="outline" className="gap-1.5">
                <ListTodo className="h-4 w-4" />
                タスク一覧
              </Button>
            </Link>
            {subProjects.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-500">領域</span>
                <select
                  value={areaFilter}
                  onChange={(e) => setAreaFilter(e.target.value)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  title="領域でタスクを絞り込む"
                >
                  <option value="">すべての領域</option>
                  {subProjects.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center rounded-md border border-gray-300 bg-white p-0.5">
              {ZOOM_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setZoom(opt.mode)}
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-sm transition-colors ${
                    zoom === opt.mode
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  title={opt.title}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        }
      />

      {tasks.length === 0 ? (
        <Card className="border-gray-200 bg-white">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <GanttChartSquare className="h-8 w-8 text-gray-400" />
            </div>
            <p className="mb-2 text-gray-500">タスクがありません</p>
            <p className="mb-4 text-sm text-gray-400">
              タスク管理画面で WBS を作成するとガントに反映されます
            </p>
            <Link href={`/dashboard/projects/${projectId}/tasks`}>
              <Button className="bg-blue-600 hover:bg-blue-700">
                タスク管理へ
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/*
            ガントカード。frappe-gantt 自身が内部スクロール（.gantt-container）を
            持つため、外側カードでは overflow-auto を重ねない（二重スクロール＝
            ドラッグで外側が動く不具合の一因になるため）。relative + 全画面ボタン。
          */}
          <Card
            className={
              isFullscreen
                ? 'fixed inset-0 z-50 flex flex-col overflow-hidden rounded-none border-0 bg-white'
                : 'relative border-gray-200 bg-white'
            }
          >
            {/* 全画面トグル（右上オーバーレイ）。 */}
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              title={isFullscreen ? '全画面を解除（Esc）' : '全画面表示'}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
              {isFullscreen ? '縮小' : '全画面'}
            </button>

            {/*
              左: WBS タスクツリーパネル（折りたたみ可） / 右: frappe-gantt。
              全画面時は残り高さいっぱいに広げ、内側の .gantt-container が
              スクロールする。ツリーの行とガントの行は独立リスト（1px 単位の
              行揃えはしない）。
            */}
            <div className={isFullscreen ? 'flex min-h-0 flex-1' : 'flex'}>
              {wbsPanelOpen ? (
                <aside className="flex w-64 shrink-0 flex-col border-r border-gray-200 bg-gray-50/60">
                  {/* パネルヘッダー: タイトル＋パネル折りたたみ */}
                  <div className="flex items-center justify-between gap-1 border-b border-gray-200 px-2 py-1.5">
                    <span className="text-xs font-semibold text-gray-600">
                      タスクツリー
                    </span>
                    <button
                      type="button"
                      onClick={toggleWbsPanel}
                      className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
                      title="ツリーを折りたたむ"
                      aria-label="ツリーを折りたたむ"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </button>
                  </div>
                  {/* 展開/折りたたみ操作＋表示階層 */}
                  <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={expandAll}
                      className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-100"
                    >
                      すべて展開
                    </button>
                    <button
                      type="button"
                      onClick={collapseAll}
                      className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] text-gray-600 transition-colors hover:bg-gray-100"
                    >
                      すべて折りたたみ
                    </button>
                    <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-500">
                      表示階層
                      <select
                        value={depthValue}
                        onChange={(e) => applyDepth(e.target.value)}
                        className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-600"
                        title="選んだ深さまで展開"
                      >
                        <option value="" disabled>
                          --
                        </option>
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="all">全部</option>
                      </select>
                    </label>
                  </div>
                  {/* ツリー本体 */}
                  <div className="min-h-0 flex-1 overflow-y-auto py-1">
                    {wbsRows.map((node) => {
                      const hasChildren = node.children.length > 0;
                      const collapsed = collapsedIds.has(node.id);
                      const doneCount = hasChildren
                        ? node.children.filter((c) => c.status === 'CLOSED')
                            .length
                        : 0;
                      const num = wbs.get(node.id);
                      return (
                        <div
                          key={node.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => openTaskSidebar(node.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') openTaskSidebar(node.id);
                          }}
                          className={`flex cursor-pointer items-center gap-1 py-1 pr-2 text-sm transition-colors hover:bg-blue-50 ${
                            selectedTaskId === node.id ? 'bg-blue-50' : ''
                          }`}
                          style={{ paddingLeft: 8 + node.depth * 14 }}
                          title={node.title}
                        >
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapse(node.id);
                              }}
                              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                              title={collapsed ? '展開' : '折りたたみ'}
                              aria-label={collapsed ? '展開' : '折りたたみ'}
                              aria-expanded={!collapsed}
                            >
                              {collapsed ? (
                                <ChevronRight className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="h-4 w-4 shrink-0" />
                          )}
                          <span className="min-w-0 truncate text-gray-700">
                            {num ? `${num} ` : ''}
                            {node.title}
                          </span>
                          {!areaFilter && subProjectName(node.subProjectId) && (
                            <span
                              className="ml-1 shrink-0 rounded bg-indigo-50 px-1 text-[9px] leading-4 text-indigo-600"
                              title={`領域: ${subProjectName(node.subProjectId)}`}
                            >
                              {subProjectName(node.subProjectId)}
                            </span>
                          )}
                          {node.assigneeName && (
                            <UserAvatar
                              name={node.assigneeName}
                              avatarUrl={avatarFor(node.assigneeName)}
                              size={18}
                              className="ml-1"
                              title={`担当: ${node.assigneeName}`}
                            />
                          )}
                          {hasChildren && (
                            <span
                              className="ml-auto shrink-0 rounded-full bg-gray-200 px-1.5 text-[10px] leading-4 text-gray-600"
                              title={`直下の子タスク 完了 ${doneCount} / ${node.children.length}`}
                            >
                              {doneCount}/{node.children.length}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </aside>
              ) : (
                <div className="flex shrink-0 flex-col border-r border-gray-200 bg-gray-50/60">
                  <button
                    type="button"
                    onClick={toggleWbsPanel}
                    className="flex h-8 w-8 items-center justify-center text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
                    title="タスクツリーを表示"
                    aria-label="タスクツリーを表示"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/*
                frappe-gantt（クライアント専用・SSR 無効）。
                全画面切替・ツリーパネル開閉でコンテナ幅が変わるので key を
                変えて再マウントし、新しい幅で確実に再描画させる。
              */}
              <div
                key={`${isFullscreen ? 'fs' : 'normal'}-${
                  wbsPanelOpen ? 'wbs' : 'nowbs'
                }`}
                className={`gantt-host min-w-0 flex-1 ${
                  isFullscreen ? 'min-h-0 overflow-auto' : ''
                }`}
                style={isFullscreen ? undefined : { minHeight: 420 }}
              >
                <FrappeGantt
                  tasks={visibleFrappeTasks}
                  viewMode={VIEW_MODE_MAP[zoom]}
                  onDateChange={handleDateChange}
                  onProgressChange={handleProgressChange}
                  onClick={openTaskSidebar}
                  onArrowClick={handleArrowClick}
                  onConnect={handleConnect}
                />
              </div>
            </div>
          </Card>

          {/* 親子関係・依存関係パネル（マウス操作のフォールバック兼 親タスク編集） */}
          <Card className="border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-800">
                親子関係・依存関係
              </h2>
              <span className="text-xs text-gray-400">
                タスクを選んで、親タスク（WBSの親子）と「先行」タスク（先行→後続の矢印）を編集します。
              </span>
            </div>

            <div className="mb-4 max-w-md">
              <label className="mb-1 block text-xs font-medium text-gray-500">
                対象タスク（後続）
              </label>
              <Select value={depTaskId} onValueChange={setDepTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="タスクを選択…" />
                </SelectTrigger>
                <SelectContent>
                  {orderedTaskList.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.wbs ? `${t.wbs} ${t.title}` : t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {depTaskId ? (
              <div className="space-y-4">
                {/* 親タスク（WBS の親子関係）の変更 */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    親タスク
                  </p>
                  <div className="max-w-md">
                    <Select
                      // 「なし」は内部的に '__root__'（空文字は Select の placeholder と衝突するため）。
                      value={currentParentId || '__root__'}
                      onValueChange={(v) =>
                        handleParentChange(v === '__root__' ? '' : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="親タスクを選択…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__root__">
                          なし（トップレベル）
                        </SelectItem>
                        {parentCandidates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.wbs ? `${t.wbs} ${t.title}` : t.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 既存の先行リスト */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    現在の先行タスク
                  </p>
                  {currentDeps.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      先行タスクはありません
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {currentDeps.map((d) => (
                        <li
                          key={d.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1 pl-3 pr-1.5 text-sm text-blue-700"
                        >
                          <span>{taskLabel(d.predecessorId)}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDep(d.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-700"
                            title="この依存を削除"
                            aria-label="この依存を削除"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 先行を追加 */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    先行タスクを追加
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[16rem] flex-1">
                      <Select
                        value={pickPredId}
                        onValueChange={setPickPredId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="先行にするタスクを選択…" />
                        </SelectTrigger>
                        <SelectContent>
                          {predecessorCandidates.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-400">
                              追加できるタスクがありません
                            </div>
                          ) : (
                            predecessorCandidates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.wbs ? `${t.wbs} ${t.title}` : t.title}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      onClick={handleAddPredecessor}
                      disabled={!pickPredId}
                      className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      追加
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                まずは上で対象タスクを選択してください。
              </p>
            )}
          </Card>
        </>
      )}

      {/*
        右側のタスク編集サイドバー（バークリックで開く）。
        全画面コンテナが fixed inset-0 z-50 なので、サイドバーは z-[55]/z-[60] で
        その上に重ね、全画面中でも使えるようにする（Select のドロップダウンは z-[70]）。
        背景クリック / ✕ / Esc で閉じる。
      */}
      {selectedTask && (
        <>
          {/*
            背景クリックで閉じる薄いオーバーレイ。
            - mousedown がオーバーレイ上で始まったクリックだけを閉じる対象にする
              （サイドバー内で押してドラッグし外で離した等では閉じない）。
            - バーをダブルクリックしたときの 2 打目が開いた直後のオーバーレイに
              落ちて即閉じしないよう、開後 300ms のクリックは無視する。
          */}
          <div
            className="fixed inset-0 z-[55] bg-black/20"
            onMouseDown={() => {
              backdropMouseDownRef.current = true;
            }}
            onClick={() => {
              const started = backdropMouseDownRef.current;
              backdropMouseDownRef.current = false;
              if (!started) return;
              if (Date.now() - sidebarOpenedAtRef.current < 300) return;
              closeSidebar();
            }}
            aria-hidden="true"
          />
          <aside
            className="fixed inset-y-0 right-0 z-[60] flex w-96 max-w-[90vw] flex-col border-l border-gray-200 bg-white shadow-xl"
            role="dialog"
            aria-label="タスクを編集"
          >
            {/* ヘッダ: タイトル・詳細ページへのリンク・閉じる */}
            <div className="flex items-start justify-between gap-2 border-b border-gray-200 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-gray-800">
                  {selectedTask.title}
                </h2>
                <Link
                  href={`/dashboard/projects/${projectId}/tasks/${selectedTask.id}`}
                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  詳細ページへ（コメント・添付はこちら）
                </Link>
              </div>
              <button
                type="button"
                onClick={closeSidebar}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                title="閉じる（Esc）"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 編集フォーム */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  タイトル <span className="text-red-500">*</span>
                </label>
                <Input
                  value={sidebarForm.title}
                  onChange={(e) =>
                    setSidebarForm((f) => ({ ...f, title: e.target.value }))
                  }
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  説明
                </label>
                <Textarea
                  rows={4}
                  value={sidebarForm.description}
                  onChange={(e) =>
                    setSidebarForm((f) => ({
                      ...f,
                      description: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    ステータス
                  </label>
                  <Select
                    value={sidebarForm.status}
                    onValueChange={(v) =>
                      setSidebarForm((f) => ({
                        ...f,
                        status: v as TaskStatus,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[70]">
                      {TASK_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {taskStatusLabels[s].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    優先度
                  </label>
                  <Select
                    value={sidebarForm.priority}
                    onValueChange={(v) =>
                      setSidebarForm((f) => ({
                        ...f,
                        priority: v as TaskPriority,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[70]">
                      {TASK_PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {taskPriorityLabels[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  担当者
                </label>
                <StakeholderPicker
                  stakeholders={stakeholders}
                  value={sidebarForm.assigneeName}
                  onChange={(name) =>
                    setSidebarForm((f) => ({ ...f, assigneeName: name }))
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    開始日
                  </label>
                  <Input
                    type="date"
                    value={sidebarForm.startDate}
                    onChange={(e) =>
                      setSidebarForm((f) => ({
                        ...f,
                        startDate: e.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    期限
                  </label>
                  <Input
                    type="date"
                    value={sidebarForm.dueDate}
                    onChange={(e) =>
                      setSidebarForm((f) => ({
                        ...f,
                        dueDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    進捗（%）
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={sidebarForm.progress}
                    onChange={(e) =>
                      setSidebarForm((f) => ({
                        ...f,
                        progress: Number(e.target.value),
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">
                    見積時間（h）
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step="0.5"
                    value={sidebarForm.estimatedHours}
                    onChange={(e) =>
                      setSidebarForm((f) => ({
                        ...f,
                        estimatedHours: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  領域
                </label>
                <select
                  value={sidebarForm.subProjectId}
                  onChange={(e) =>
                    setSidebarForm((f) => ({
                      ...f,
                      subProjectId: e.target.value,
                    }))
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">未設定</option>
                  {subProjects.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
                {subProjects.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    領域（共通マスタ）が登録されていません
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  論点（課題・調査ツリーから選択）
                </label>
                <select
                  value={sidebarForm.issueNodeId}
                  onChange={(e) =>
                    setSidebarForm((f) => ({ ...f, issueNodeId: e.target.value }))
                  }
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                >
                  <option value="">未設定</option>
                  {issueNodesByTree.map(([treeTitle, nodes]) => (
                    <optgroup key={treeTitle} label={treeTitle}>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {issueNodes.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    課題ツリー / 調査ツリーのノードがありません
                  </p>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  達成条件
                </label>
                <Textarea
                  rows={3}
                  placeholder="このタスクが完了したと言える条件（例: 発注書をFAX送信し台帳へ記入済み）"
                  value={sidebarForm.acceptanceCriteria}
                  onChange={(e) =>
                    setSidebarForm((f) => ({
                      ...f,
                      acceptanceCriteria: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {/* フッタ: 保存（成功後も開いたまま、ガントへ即反映） */}
            <div className="border-t border-gray-200 px-4 py-3">
              {sidebarError && (
                <p className="mb-2 text-sm text-red-600">{sidebarError}</p>
              )}
              <Button
                type="button"
                onClick={handleSidebarSave}
                disabled={sidebarSaving}
                className="w-full gap-1.5 bg-blue-600 hover:bg-blue-700"
              >
                {sidebarSaving && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                保存
              </Button>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
