import { Task, TaskStatus, TaskPriority, IssueNodeKind } from '../../../domain';
import { TaskDependencyRecord } from '../../../domain';

export interface TaskOutput {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string | null;
  assigneeRoleId: string | null;
  /** 紐付くイシューノードID（ISSUE/CAUSE/COUNTERMEASURE）。未紐付けは null。 */
  issueNodeId: string | null;
  /** 紐付くノードのラベル（フロントが「由来」を追加フェッチなしで表示するため）。 */
  issueNodeLabel: string | null;
  /** 紐付くノードの種別。未紐付けは null。 */
  issueNodeKind: IssueNodeKind | null;
  /** リスク対応タスクの紐付け先リスクID。未紐付けは null。 */
  riskId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  milestone: string | null;
  category: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 紐付け先イシューノードの最小情報。
 * リポジトリが Task に同梱して返し、toTaskOutput が由来表示用フィールドに展開する。
 */
export interface LinkedIssueNodeInfo {
  id: string;
  label: string;
  kind: IssueNodeKind;
}

export interface TaskDependencyOutput {
  id: string;
  predecessorId: string;
  successorId: string;
}

/**
 * 一覧レスポンス。フロントはこの tasks[] からツリーを組み、
 * dependencies[] で先行/後続の矢印を描画する。
 */
export interface TaskListOutput {
  tasks: TaskOutput[];
  dependencies: TaskDependencyOutput[];
}

export function toTaskOutput(task: Task): TaskOutput {
  const node = task.linkedIssueNode;
  return {
    id: task.id,
    projectId: task.projectId,
    parentId: task.parentId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assigneeName: task.assigneeName,
    assigneeRoleId: task.assigneeRoleId,
    issueNodeId: task.issueNodeId,
    issueNodeLabel: node ? node.label : null,
    issueNodeKind: node ? node.kind : null,
    riskId: task.riskId,
    startDate: task.startDate,
    dueDate: task.dueDate,
    progress: task.progress,
    estimatedHours: task.estimatedHours,
    actualHours: task.actualHours,
    milestone: task.milestone,
    category: task.category,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toTaskDependencyOutput(
  dep: TaskDependencyRecord,
): TaskDependencyOutput {
  return {
    id: dep.id,
    predecessorId: dep.predecessorId,
    successorId: dep.successorId,
  };
}
