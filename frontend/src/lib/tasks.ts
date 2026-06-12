// タスク管理（WBS / バックログ）のための型・ラベル・APIヘルパー・純粋ユーティリティ。
//
// 純粋関数（buildTaskTree / computeWbsNumbers）は副作用を持たず、テスト可能なように
// エクスポートしています。fetch ヘルパー群は API_URL と localStorage の accessToken を
// 用いた raw fetch で実装しています。

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Task {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string | null;
  assigneeRoleId: string | null;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  milestone: boolean;
  category: string | null;
  order: number;
  /** 由来となる課題ツリーのノード（打ち手 / 調査）への紐付け。未設定なら null。 */
  issueNodeId: string | null;
  /** 由来となるリスク（リスク対応タスク）への紐付け。未設定なら null。 */
  riskId?: string | null;
  /** 紐付いた課題ノードのラベル（TaskOutput でのみ付与される表示用） */
  issueNodeLabel?: string | null;
  /** 紐付いた課題ノードの種別（CAUSE=調査 / COUNTERMEASURE=打ち手） */
  issueNodeKind?: IssueNodeKind | null;
}

/** 課題ツリーのノード種別。タスク紐付けで使うのは CAUSE / COUNTERMEASURE。 */
export type IssueNodeKind = 'ISSUE' | 'CAUSE' | 'COUNTERMEASURE';

/** タスク紐付け用に列挙する課題ノード（GET /issue-nodes の戻り値） */
export interface IssueNodeRef {
  id: string;
  label: string;
  kind: IssueNodeKind;
  treeId: string;
  treeTitle: string;
}

export interface TaskDependency {
  id: string;
  predecessorId: string;
  successorId: string;
}

export interface TasksResponse {
  tasks: Task[];
  dependencies: TaskDependency[];
}

/** 作成/更新時に送る入力（id・projectId はパス側で扱うため除外可能） */
export type TaskInput = Partial<Omit<Task, 'id' | 'projectId'>> & {
  title: string;
};

/** プロジェクトの担当ロール（assigneeRole 選択肢） */
export interface TaskRole {
  id: string;
  name: string;
  type?: string;
  color?: string | null;
}

/** タスクへのコメント（Backlog 風スレッド） */
export interface TaskComment {
  id: string;
  taskId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

/** タスクへの添付ファイル */
export interface TaskAttachment {
  id: string;
  filename: string;
  mimeType: string;
  url: string;
  size: number;
  createdAt: string;
}

/** buildTaskTree が返す入れ子ノード */
export interface TaskTreeNode extends Task {
  depth: number;
  children: TaskTreeNode[];
}

// ---------------------------------------------------------------------------
// ラベル・色マップ
// ---------------------------------------------------------------------------

export const TASK_STATUSES: TaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
];

export const TASK_PRIORITIES: TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

export const taskStatusLabels: Record<
  TaskStatus,
  { label: string; color: string; dot: string }
> = {
  OPEN: {
    label: '未対応',
    color: 'bg-gray-100 text-gray-700 border-gray-200',
    dot: 'bg-gray-400',
  },
  IN_PROGRESS: {
    label: '処理中',
    color: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
  },
  RESOLVED: {
    label: '処理済',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot: 'bg-emerald-500',
  },
  CLOSED: {
    label: '完了',
    color: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
};

export const taskPriorityLabels: Record<
  TaskPriority,
  { label: string; color: string }
> = {
  HIGH: { label: '高', color: 'bg-red-50 text-red-600 border-red-200' },
  MEDIUM: { label: '中', color: 'bg-amber-50 text-amber-600 border-amber-200' },
  LOW: { label: '低', color: 'bg-green-50 text-green-600 border-green-200' },
};

/**
 * タスクに紐付く課題ノードの種別チップ表示。
 * CAUSE=調査（amber）/ COUNTERMEASURE=打ち手（blue）。
 * ISSUE は紐付け対象外だが念のため定義しておく。
 */
// 課題ツリーのノード種別は 11 種（issue-tree-patterns.ts と対応）。タスクは任意の種別の
// ノードに紐づき得るため、全種別を網羅する（未知キーは参照側でフォールバック）。
export const issueNodeKindLabels: Record<
  string,
  { label: string; chip: string }
> = {
  ISSUE: { label: '問い', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
  POINT: { label: '論点', chip: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  HYPOTHESIS: { label: '仮説', chip: 'bg-violet-50 text-violet-700 border-violet-200' },
  VERIFICATION: { label: '検証', chip: 'bg-sky-50 text-sky-700 border-sky-200' },
  RESULT: { label: '検証結果', chip: 'bg-teal-50 text-teal-700 border-teal-200' },
  CAUSE: { label: '調査', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  ELEMENT: { label: '構成要素', chip: 'bg-gray-100 text-gray-700 border-gray-200' },
  OPTION: { label: '打ち手候補', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  ACTION: { label: '行動', chip: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  COUNTERMEASURE: {
    label: '打ち手',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  METRIC: { label: 'KPI', chip: 'bg-green-50 text-green-700 border-green-200' },
};

/** 未知の種別でも落ちないようフォールバック付きで参照する。 */
export function issueNodeKindMeta(kind: string | null | undefined): {
  label: string;
  chip: string;
} {
  if (kind && issueNodeKindLabels[kind]) return issueNodeKindLabels[kind];
  return {
    label: kind ?? '—',
    chip: 'bg-gray-100 text-gray-600 border-gray-200',
  };
}

/** セレクタ表示用：CAUSE は「なぜ/調査」、COUNTERMEASURE は「打ち手」。 */
export function issueNodeKindOptionLabel(kind: IssueNodeKind): string {
  if (kind === 'CAUSE') return 'なぜ/調査';
  if (kind === 'COUNTERMEASURE') return '打ち手';
  return issueNodeKindLabels[kind]?.label ?? kind;
}

export function taskStatusLabel(status: string): string {
  return taskStatusLabels[status as TaskStatus]?.label ?? status;
}

export function taskPriorityLabel(priority: string): string {
  return taskPriorityLabels[priority as TaskPriority]?.label ?? priority;
}

// ---------------------------------------------------------------------------
// fetch ヘルパー
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `API Error: ${res.status}`);
  }
  // DELETE などは本文が無い場合がある
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const tasksApi = {
  /** GET /api/projects/:projectId/tasks */
  list: (projectId: string) =>
    fetch(`${API_URL}/api/projects/${projectId}/tasks`, {
      headers: authHeaders(),
    }).then((r) => handle<TasksResponse>(r)),

  /** POST /api/projects/:projectId/tasks */
  create: (projectId: string, input: TaskInput) =>
    fetch(`${API_URL}/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(input),
    }).then((r) => handle<Task>(r)),

  /** GET /api/tasks/:id */
  get: (id: string) =>
    fetch(`${API_URL}/api/tasks/${id}`, { headers: authHeaders() }).then((r) =>
      handle<Task>(r)
    ),

  /** PUT /api/tasks/:id */
  update: (id: string, input: Partial<TaskInput>) =>
    fetch(`${API_URL}/api/tasks/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(input),
    }).then((r) => handle<Task>(r)),

  /** DELETE /api/tasks/:id */
  delete: (id: string) =>
    fetch(`${API_URL}/api/tasks/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }).then((r) => handle<void>(r)),

  /** POST /api/tasks/:id/dependencies { predecessorId } */
  addDep: (taskId: string, predecessorId: string) =>
    fetch(`${API_URL}/api/tasks/${taskId}/dependencies`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ predecessorId }),
    }).then((r) => handle<TaskDependency>(r)),

  /** DELETE /api/tasks/dependencies/:depId */
  removeDep: (depId: string) =>
    fetch(`${API_URL}/api/tasks/dependencies/${depId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }).then((r) => handle<void>(r)),

  /** GET /api/projects/:projectId/roles */
  listRoles: (projectId: string) =>
    fetch(`${API_URL}/api/projects/${projectId}/roles`, {
      headers: authHeaders(),
    }).then((r) => handle<TaskRole[]>(r)),

  /**
   * GET /api/projects/:projectId/issue-nodes?kind=CAUSE|COUNTERMEASURE
   * 課題ツリーのノード（打ち手 / 調査）をタスク紐付け候補として列挙する。
   * kind 省略時は紐付け可能な全ノードを返す。
   */
  listIssueNodes: (projectId: string, kind?: IssueNodeKind) => {
    const qs = kind ? `?kind=${encodeURIComponent(kind)}` : '';
    return fetch(`${API_URL}/api/projects/${projectId}/issue-nodes${qs}`, {
      headers: authHeaders(),
    }).then((r) => handle<IssueNodeRef[]>(r));
  },
};

/** Authorization のみ（multipart は Content-Type をブラウザに任せる） */
function authOnlyHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// ---------------------------------------------------------------------------
// コメント（タスク詳細スレッド）
// ---------------------------------------------------------------------------

export const commentsApi = {
  /** GET /api/tasks/:taskId/comments */
  list: (taskId: string) =>
    fetch(`${API_URL}/api/tasks/${taskId}/comments`, {
      headers: authHeaders(),
    }).then((r) => handle<TaskComment[]>(r)),

  /** POST /api/tasks/:taskId/comments { body } */
  create: (taskId: string, body: string) =>
    fetch(`${API_URL}/api/tasks/${taskId}/comments`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ body }),
    }).then((r) => handle<TaskComment>(r)),

  /** PUT /api/task-comments/:id { body } */
  update: (id: string, body: string) =>
    fetch(`${API_URL}/api/task-comments/${id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ body }),
    }).then((r) => handle<TaskComment>(r)),

  /** DELETE /api/task-comments/:id */
  delete: (id: string) =>
    fetch(`${API_URL}/api/task-comments/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }).then((r) => handle<void>(r)),
};

// ---------------------------------------------------------------------------
// 添付ファイル
// ---------------------------------------------------------------------------

export const attachmentsApi = {
  /** GET /api/tasks/:taskId/attachments */
  list: (taskId: string) =>
    fetch(`${API_URL}/api/tasks/${taskId}/attachments`, {
      headers: authHeaders(),
    }).then((r) => handle<TaskAttachment[]>(r)),

  /** POST /api/tasks/:taskId/attachments （multipart, field 名 'file'） */
  upload: (taskId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`${API_URL}/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      headers: authOnlyHeaders(),
      body: fd,
    }).then((r) => handle<TaskAttachment>(r));
  },

  /** DELETE /api/attachments/:id */
  delete: (id: string) =>
    fetch(`${API_URL}/api/attachments/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    }).then((r) => handle<void>(r)),

  /** 実体配信 URL（認証不要・公開） */
  fileUrl: (id: string) => `${API_URL}/api/attachments/${id}/file`,
};

// ---------------------------------------------------------------------------
// 純粋ユーティリティ（テスト対象）
// ---------------------------------------------------------------------------

/**
 * parentId に基づいてフラットなタスク配列を入れ子ツリーに変換する。
 *
 * - 各階層は `order` の昇順、同値は `title` の昇順で安定的に並ぶ。
 * - parentId が存在しない（または親が見つからない）タスクはルートとして扱う。
 * - 親子関係に循環があっても無限ループせず、循環したノードはルートに昇格させる。
 */
export function buildTaskTree(tasks: Task[]): TaskTreeNode[] {
  const byId = new Map<string, TaskTreeNode>();
  for (const t of tasks) {
    byId.set(t.id, { ...t, depth: 0, children: [] });
  }

  const roots: TaskTreeNode[] = [];

  for (const node of Array.from(byId.values())) {
    const parentId = node.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && !createsCycle(node.id, parentId!, byId)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: TaskTreeNode[], depth: number) => {
    nodes.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.title.localeCompare(b.title);
    });
    for (const n of nodes) {
      n.depth = depth;
      sortNodes(n.children, depth + 1);
    }
  };
  sortNodes(roots, 0);

  return roots;
}

/** node を parentId の子にしたとき循環が生じるか判定（node が parent の祖先なら循環）。 */
function createsCycle(
  nodeId: string,
  parentId: string,
  byId: Map<string, TaskTreeNode>
): boolean {
  let current: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (current) {
    if (current === nodeId) return true;
    if (seen.has(current)) return true; // 既存データ側の循環
    seen.add(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * ツリーから各タスクの WBS 番号（'1', '1.2', '1.2.3' …）を採番する。
 * 並びは buildTaskTree が確定した順（order → title）に従う。
 */
export function computeWbsNumbers(tree: TaskTreeNode[]): Map<string, string> {
  const map = new Map<string, string>();

  const walk = (nodes: TaskTreeNode[], prefix: string) => {
    nodes.forEach((node, i) => {
      const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      map.set(node.id, wbs);
      walk(node.children, wbs);
    });
  };
  walk(tree, '');

  return map;
}

// ---------------------------------------------------------------------------
// 一覧のカラムソート
// ---------------------------------------------------------------------------

export type TaskSortKey =
  | 'status'
  | 'priority'
  | 'title'
  | 'assignee'
  | 'dueDate'
  | 'progress';

export type TaskSortDir = 'asc' | 'desc';

/**
 * ツリーの**兄弟ノード間**を指定キーでソートした新しいツリーを返す（非破壊）。
 * 階層（インデント）は保ったまま、各階層内の並びだけが変わる。
 * null/未設定値（期限なし・担当なし）は方向に関わらず末尾に寄せる。
 */
export function sortTaskTree(
  tree: TaskTreeNode[],
  key: TaskSortKey,
  dir: TaskSortDir
): TaskTreeNode[] {
  const statusRank = new Map(TASK_STATUSES.map((s, i) => [s, i]));
  const priorityRank = new Map(TASK_PRIORITIES.map((p, i) => [p, i]));
  const sign = dir === 'asc' ? 1 : -1;

  const cmp = (a: TaskTreeNode, b: TaskTreeNode): number => {
    switch (key) {
      case 'status':
        return (
          sign *
          ((statusRank.get(a.status) ?? 0) - (statusRank.get(b.status) ?? 0))
        );
      case 'priority':
        return (
          sign *
          ((priorityRank.get(a.priority) ?? 0) -
            (priorityRank.get(b.priority) ?? 0))
        );
      case 'title':
        return sign * a.title.localeCompare(b.title, 'ja');
      case 'assignee': {
        const av = a.assigneeName ?? '';
        const bv = b.assigneeName ?? '';
        if (!av && !bv) return 0;
        if (!av) return 1; // 未設定は末尾
        if (!bv) return -1;
        return sign * av.localeCompare(bv, 'ja');
      }
      case 'dueDate': {
        const av = a.dueDate ?? '';
        const bv = b.dueDate ?? '';
        if (!av && !bv) return 0;
        if (!av) return 1; // 期限なしは末尾
        if (!bv) return -1;
        return sign * av.localeCompare(bv);
      }
      case 'progress':
        return sign * (a.progress - b.progress);
    }
  };

  const walk = (nodes: TaskTreeNode[]): TaskTreeNode[] =>
    nodes
      .slice()
      .sort(cmp)
      .map((n) => ({ ...n, children: walk(n.children) }));

  return walk(tree);
}

/** ツリーを深さ優先でフラット化（描画用：順序＋depth を保持） */
export function flattenTaskTree(tree: TaskTreeNode[]): TaskTreeNode[] {
  const out: TaskTreeNode[] = [];
  const walk = (nodes: TaskTreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

/**
 * あるタスクの全子孫 id 集合を返す（親セレクトで自分＋子孫を除外するために使用）。
 */
export function collectDescendantIds(
  tasks: Task[],
  rootId: string
): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const arr = childrenByParent.get(t.parentId) ?? [];
    arr.push(t.id);
    childrenByParent.set(t.parentId, arr);
  }
  const result = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const childId of childrenByParent.get(id) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        stack.push(childId);
      }
    }
  }
  return result;
}
