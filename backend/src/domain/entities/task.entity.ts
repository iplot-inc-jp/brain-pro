import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';
import { IssueNodeKind } from './issue-node.entity';

/**
 * タスクステータス（Prisma enum TaskStatus と一致）
 */
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/**
 * 紐付くイシューノードの最小情報（由来表示用）。
 * リポジトリが read 時に IssueNode リレーションを join して同梱する。
 */
export interface LinkedIssueNode {
  id: string;
  label: string;
  kind: IssueNodeKind;
}

/**
 * タスク優先度（Prisma enum TaskPriority と一致）
 */
export type TaskPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CreateTaskProps {
  projectId: string;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeName?: string | null;
  assigneeRoleId?: string | null;
  issueNodeId?: string | null;
  /** リスク対応タスクの紐付け（任意）。null は未紐付け。 */
  riskId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  progress?: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  milestone?: string | null;
  category?: string | null;
  order?: number;
}

export interface ReconstructTaskProps {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeName: string | null;
  assigneeRoleId: string | null;
  issueNodeId: string | null;
  /** 紐付くノードの最小情報（join 済みの場合のみ）。 */
  linkedIssueNode?: LinkedIssueNode | null;
  /** リスク対応タスクの紐付け（任意）。null は未紐付け。 */
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
 * UpdateTask で指定可能なフィールド（undefined は「変更しない」）
 */
export interface UpdateTaskProps {
  parentId?: string | null;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeName?: string | null;
  assigneeRoleId?: string | null;
  issueNodeId?: string | null;
  /** リスク対応タスクの紐付け。指定で差し替え / null で解除 / 省略で変更なし。 */
  riskId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  progress?: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  milestone?: string | null;
  category?: string | null;
  order?: number;
}

const VALID_STATUSES: TaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
];
const VALID_PRIORITIES: TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

/**
 * Task エンティティ（Backlog 相当のタスク）
 * 親子（subtask）・依存関係・進捗・期日・担当を表現する
 */
export class Task extends BaseEntity {
  private readonly _projectId: string;
  private _parentId: string | null;
  private _title: string;
  private _description: string | null;
  private _status: TaskStatus;
  private _priority: TaskPriority;
  private _assigneeName: string | null;
  private _assigneeRoleId: string | null;
  private _issueNodeId: string | null;
  private _riskId: string | null;
  private _startDate: Date | null;
  private _dueDate: Date | null;
  private _progress: number;
  private _estimatedHours: number | null;
  private _actualHours: number | null;
  private _milestone: string | null;
  private _category: string | null;
  private _order: number;
  // read 時に join された紐付けノードの最小情報（書き込みには使わない）
  private _linkedIssueNode: LinkedIssueNode | null;

  private constructor(
    id: string,
    projectId: string,
    parentId: string | null,
    title: string,
    description: string | null,
    status: TaskStatus,
    priority: TaskPriority,
    assigneeName: string | null,
    assigneeRoleId: string | null,
    issueNodeId: string | null,
    riskId: string | null,
    startDate: Date | null,
    dueDate: Date | null,
    progress: number,
    estimatedHours: number | null,
    actualHours: number | null,
    milestone: string | null,
    category: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
    linkedIssueNode: LinkedIssueNode | null = null,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._parentId = parentId;
    this._title = title;
    this._description = description;
    this._status = status;
    this._priority = priority;
    this._assigneeName = assigneeName;
    this._assigneeRoleId = assigneeRoleId;
    this._issueNodeId = issueNodeId;
    this._riskId = riskId;
    this._startDate = startDate;
    this._dueDate = dueDate;
    this._progress = progress;
    this._estimatedHours = estimatedHours;
    this._actualHours = actualHours;
    this._milestone = milestone;
    this._category = category;
    this._order = order;
    this._linkedIssueNode = linkedIssueNode;
  }

  // ========== バリデーションヘルパー ==========

  private static normalizeTitle(title: string | undefined): string {
    const trimmed = title?.trim();
    if (!trimmed || trimmed.length < 1) {
      throw new ValidationError('Task title is required');
    }
    if (trimmed.length > 500) {
      throw new ValidationError('Task title must be at most 500 characters');
    }
    return trimmed;
  }

  private static normalizeProgress(progress: number): number {
    if (!Number.isFinite(progress)) {
      throw new ValidationError('Progress must be a number');
    }
    const rounded = Math.round(progress);
    if (rounded < 0 || rounded > 100) {
      throw new ValidationError('Progress must be between 0 and 100');
    }
    return rounded;
  }

  private static normalizeHours(
    hours: number | null | undefined,
    field: string,
  ): number | null {
    if (hours === null || hours === undefined) {
      return null;
    }
    if (!Number.isFinite(hours) || hours < 0) {
      throw new ValidationError(`${field} must be a non-negative number`);
    }
    return hours;
  }

  private static validateStatus(status: TaskStatus): TaskStatus {
    if (!VALID_STATUSES.includes(status)) {
      throw new ValidationError(`Invalid task status: ${status}`);
    }
    return status;
  }

  private static validatePriority(priority: TaskPriority): TaskPriority {
    if (!VALID_PRIORITIES.includes(priority)) {
      throw new ValidationError(`Invalid task priority: ${priority}`);
    }
    return priority;
  }

  /**
   * 新規タスク作成
   */
  static create(props: CreateTaskProps, id: string): Task {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const title = Task.normalizeTitle(props.title);
    const status = Task.validateStatus(props.status ?? 'OPEN');
    const priority = Task.validatePriority(props.priority ?? 'MEDIUM');
    const progress = Task.normalizeProgress(props.progress ?? 0);

    if (props.parentId && props.parentId === id) {
      throw new ValidationError('A task cannot be its own parent');
    }

    const now = new Date();
    return new Task(
      id,
      props.projectId,
      props.parentId ?? null,
      title,
      props.description?.trim() || null,
      status,
      priority,
      props.assigneeName?.trim() || null,
      props.assigneeRoleId ?? null,
      props.issueNodeId ?? null,
      props.riskId ?? null,
      props.startDate ?? null,
      props.dueDate ?? null,
      progress,
      Task.normalizeHours(props.estimatedHours, 'Estimated hours'),
      Task.normalizeHours(props.actualHours, 'Actual hours'),
      props.milestone?.trim() || null,
      props.category?.trim() || null,
      props.order ?? 0,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructTaskProps): Task {
    return new Task(
      props.id,
      props.projectId,
      props.parentId,
      props.title,
      props.description,
      props.status,
      props.priority,
      props.assigneeName,
      props.assigneeRoleId,
      props.issueNodeId,
      props.riskId,
      props.startDate,
      props.dueDate,
      props.progress,
      props.estimatedHours,
      props.actualHours,
      props.milestone,
      props.category,
      props.order,
      props.createdAt,
      props.updatedAt,
      props.linkedIssueNode ?? null,
    );
  }

  // ========== ビジネスロジック ==========

  /**
   * 任意のフィールドをまとめて更新する（undefined は変更しない）。
   * 親変更（reparent）・並び順・ステータス・進捗・期日・担当などをすべて含む。
   */
  update(props: UpdateTaskProps): void {
    if (props.title !== undefined) {
      this._title = Task.normalizeTitle(props.title);
    }
    if (props.description !== undefined) {
      this._description = props.description?.trim() || null;
    }
    if (props.status !== undefined) {
      this._status = Task.validateStatus(props.status);
    }
    if (props.priority !== undefined) {
      this._priority = Task.validatePriority(props.priority);
    }
    if (props.assigneeName !== undefined) {
      this._assigneeName = props.assigneeName?.trim() || null;
    }
    if (props.assigneeRoleId !== undefined) {
      this._assigneeRoleId = props.assigneeRoleId ?? null;
    }
    if (props.issueNodeId !== undefined) {
      this.linkIssueNode(props.issueNodeId ?? null);
    }
    if (props.riskId !== undefined) {
      this._riskId = props.riskId ?? null;
    }
    if (props.startDate !== undefined) {
      this._startDate = props.startDate ?? null;
    }
    if (props.dueDate !== undefined) {
      this._dueDate = props.dueDate ?? null;
    }
    if (props.progress !== undefined) {
      this._progress = Task.normalizeProgress(props.progress);
    }
    if (props.estimatedHours !== undefined) {
      this._estimatedHours = Task.normalizeHours(
        props.estimatedHours,
        'Estimated hours',
      );
    }
    if (props.actualHours !== undefined) {
      this._actualHours = Task.normalizeHours(
        props.actualHours,
        'Actual hours',
      );
    }
    if (props.milestone !== undefined) {
      this._milestone = props.milestone?.trim() || null;
    }
    if (props.category !== undefined) {
      this._category = props.category?.trim() || null;
    }
    if (props.parentId !== undefined) {
      this.reparent(props.parentId);
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    this.touch();
  }

  /** 親タスク・並び順を変更（移動 / reparent） */
  reparent(parentId: string | null): void {
    if (parentId === this._id) {
      throw new ValidationError('A task cannot be its own parent');
    }
    this._parentId = parentId ?? null;
    this.touch();
  }

  /**
   * イシューノードへの紐付けを設定/解除（null で解除）。
   * 紐付けが変わると join 済みの最小情報キャッシュは無効化する。
   */
  linkIssueNode(issueNodeId: string | null): void {
    const next = issueNodeId ?? null;
    if (next !== this._issueNodeId) {
      this._linkedIssueNode = null;
    }
    this._issueNodeId = next;
    this.touch();
  }

  changeStatus(status: TaskStatus): void {
    this._status = Task.validateStatus(status);
    this.touch();
  }

  changeProgress(progress: number): void {
    this._progress = Task.normalizeProgress(progress);
    this.touch();
  }

  reorder(order: number): void {
    this._order = order;
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get parentId(): string | null {
    return this._parentId;
  }

  get title(): string {
    return this._title;
  }

  get description(): string | null {
    return this._description;
  }

  get status(): TaskStatus {
    return this._status;
  }

  get priority(): TaskPriority {
    return this._priority;
  }

  get assigneeName(): string | null {
    return this._assigneeName;
  }

  get assigneeRoleId(): string | null {
    return this._assigneeRoleId;
  }

  get issueNodeId(): string | null {
    return this._issueNodeId;
  }

  /** リスク対応タスクの紐付け先リスクID（未紐付けは null）。 */
  get riskId(): string | null {
    return this._riskId;
  }

  /** read 時に join された紐付けノードの最小情報（無ければ null）。 */
  get linkedIssueNode(): LinkedIssueNode | null {
    return this._linkedIssueNode;
  }

  get startDate(): Date | null {
    return this._startDate;
  }

  get dueDate(): Date | null {
    return this._dueDate;
  }

  get progress(): number {
    return this._progress;
  }

  get estimatedHours(): number | null {
    return this._estimatedHours;
  }

  get actualHours(): number | null {
    return this._actualHours;
  }

  get milestone(): string | null {
    return this._milestone;
  }

  get category(): string | null {
    return this._category;
  }

  get order(): number {
    return this._order;
  }
}
