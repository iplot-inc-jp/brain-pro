import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskIssueType,
  IssueNodeKind,
} from '../../../domain';
import { TaskDependencyRecord } from '../../../domain';

export interface TaskOutput {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** イシュー種別（EPIC/STORY/TASK/SUBTASK/BUG/OTHER）。 */
  issueType: TaskIssueType;
  /** 所属 Epic の TaskId。未紐付けは null。 */
  epicId: string | null;
  /** ストーリーポイント（見積もり）。未設定は null。 */
  storyPoints: number | null;
  /** スプリント識別子。未設定は null。 */
  sprint: string | null;
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
  /** 紐付く GAP（課題）ID。未紐付けは null。 */
  gapItemId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  milestone: string | null;
  category: string | null;
  order: number;
  /** 達成条件（自由記述）。未設定は null。 */
  acceptanceCriteria: string | null;
  /** 領域（SubProject）ID。未設定は null。 */
  subProjectId: string | null;
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
    issueType: task.issueType,
    epicId: task.epicId,
    storyPoints: task.storyPoints,
    sprint: task.sprint,
    assigneeName: task.assigneeName,
    assigneeRoleId: task.assigneeRoleId,
    issueNodeId: task.issueNodeId,
    issueNodeLabel: node ? node.label : null,
    issueNodeKind: node ? node.kind : null,
    riskId: task.riskId,
    gapItemId: task.gapItemId,
    startDate: task.startDate,
    dueDate: task.dueDate,
    progress: task.progress,
    estimatedHours: task.estimatedHours,
    actualHours: task.actualHours,
    milestone: task.milestone,
    category: task.category,
    order: task.order,
    acceptanceCriteria: task.acceptanceCriteria,
    subProjectId: task.subProjectId,
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
