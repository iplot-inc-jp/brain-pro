import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';
import { IssueNodeKind } from './issue-node.entity';

/**
 * タスクステータス（Prisma enum TaskStatus と一致）
 */
export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/**
 * イシュー種別（Prisma enum TaskIssueType と一致）。
 * アジャイル階層（Epic > Story > Task/Sub-task）と Bug を表現する。
 */
export type TaskIssueType =
  | 'EPIC'
  | 'STORY'
  | 'TASK'
  | 'SUBTASK'
  | 'BUG'
  | 'OTHER';

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
  /** 外部トラッカー由来キー（例 "BACKLOG:IPLOT-12"）。手動作成は null/undefined。 */
  sourceKey?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  /** イシュー種別（EPIC/STORY/TASK/SUBTASK/BUG/OTHER）。省略時は 'TASK'。 */
  issueType?: TaskIssueType;
  /** 所属 Epic の TaskId（issueType=EPIC の Task を指す）。未紐付けは null。 */
  epicId?: string | null;
  /** ストーリーポイント（見積もり）。未設定は null。 */
  storyPoints?: number | null;
  /** スプリント識別子（任意文字列）。未設定は null。 */
  sprint?: string | null;
  assigneeName?: string | null;
  assigneeRoleId?: string | null;
  issueNodeId?: string | null;
  /** リスク対応タスクの紐付け（任意）。null は未紐付け。 */
  riskId?: string | null;
  /** GAP（課題）への紐付け（任意）。null は未紐付け。 */
  gapItemId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  progress?: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  milestone?: string | null;
  category?: string | null;
  order?: number;
  /** 達成条件（自由記述）。null は未設定。 */
  acceptanceCriteria?: string | null;
  /** 領域（SubProject）への紐付け。null は未設定。 */
  subProjectId?: string | null;
}

export interface ReconstructTaskProps {
  id: string;
  projectId: string;
  parentId: string | null;
  /** 外部トラッカー由来キー（手動作成は null）。 */
  sourceKey?: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** イシュー種別。 */
  issueType: TaskIssueType;
  /** 所属 Epic の TaskId（未紐付けは null）。 */
  epicId: string | null;
  /** ストーリーポイント（未設定は null）。 */
  storyPoints: number | null;
  /** スプリント識別子（未設定は null）。 */
  sprint: string | null;
  assigneeName: string | null;
  assigneeRoleId: string | null;
  issueNodeId: string | null;
  /** 紐付くノードの最小情報（join 済みの場合のみ）。 */
  linkedIssueNode?: LinkedIssueNode | null;
  /** リスク対応タスクの紐付け（任意）。null は未紐付け。 */
  riskId: string | null;
  /** GAP（課題）への紐付け（任意）。null は未紐付け。 */
  gapItemId: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  progress: number;
  estimatedHours: number | null;
  actualHours: number | null;
  milestone: string | null;
  category: string | null;
  order: number;
  /** 達成条件（自由記述）。null は未設定。 */
  acceptanceCriteria: string | null;
  /** 領域（SubProject）への紐付け。null は未設定。 */
  subProjectId: string | null;
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
  /** イシュー種別（省略で変更なし）。 */
  issueType?: TaskIssueType;
  /** 所属 Epic の TaskId。指定で差し替え / null で解除 / 省略で変更なし。 */
  epicId?: string | null;
  /** ストーリーポイント。指定で更新 / null で解除 / 省略で変更なし。 */
  storyPoints?: number | null;
  /** スプリント識別子。指定で更新 / null で解除 / 省略で変更なし。 */
  sprint?: string | null;
  assigneeName?: string | null;
  assigneeRoleId?: string | null;
  issueNodeId?: string | null;
  /** リスク対応タスクの紐付け。指定で差し替え / null で解除 / 省略で変更なし。 */
  riskId?: string | null;
  /** GAP（課題）への紐付け。指定で差し替え / null で解除 / 省略で変更なし。 */
  gapItemId?: string | null;
  startDate?: Date | null;
  dueDate?: Date | null;
  progress?: number;
  estimatedHours?: number | null;
  actualHours?: number | null;
  milestone?: string | null;
  category?: string | null;
  order?: number;
  /** 達成条件（自由記述）。指定で更新 / null で解除 / 省略で変更なし。 */
  acceptanceCriteria?: string | null;
  /** 領域（SubProject）。指定で更新 / null で解除 / 省略で変更なし。 */
  subProjectId?: string | null;
}

const VALID_STATUSES: TaskStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
];
const VALID_PRIORITIES: TaskPriority[] = ['HIGH', 'MEDIUM', 'LOW'];
const VALID_ISSUE_TYPES: TaskIssueType[] = [
  'EPIC',
  'STORY',
  'TASK',
  'SUBTASK',
  'BUG',
  'OTHER',
];

/**
 * Task エンティティ（Backlog 相当のタスク）
 * 親子（subtask）・依存関係・進捗・期日・担当を表現する
 */
export class Task extends BaseEntity {
  private readonly _projectId: string;
  private _parentId: string | null;
  private _sourceKey: string | null;
  private _title: string;
  private _description: string | null;
  private _status: TaskStatus;
  private _priority: TaskPriority;
  private _issueType: TaskIssueType;
  private _epicId: string | null;
  private _storyPoints: number | null;
  private _sprint: string | null;
  private _assigneeName: string | null;
  private _assigneeRoleId: string | null;
  private _issueNodeId: string | null;
  private _riskId: string | null;
  private _gapItemId: string | null;
  private _startDate: Date | null;
  private _dueDate: Date | null;
  private _progress: number;
  private _estimatedHours: number | null;
  private _actualHours: number | null;
  private _milestone: string | null;
  private _category: string | null;
  private _order: number;
  private _acceptanceCriteria: string | null;
  private _subProjectId: string | null;
  // read 時に join された紐付けノードの最小情報（書き込みには使わない）
  private _linkedIssueNode: LinkedIssueNode | null;

  private constructor(
    id: string,
    projectId: string,
    parentId: string | null,
    sourceKey: string | null,
    title: string,
    description: string | null,
    status: TaskStatus,
    priority: TaskPriority,
    issueType: TaskIssueType,
    epicId: string | null,
    storyPoints: number | null,
    sprint: string | null,
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
    acceptanceCriteria: string | null = null,
    subProjectId: string | null = null,
    gapItemId: string | null = null,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._parentId = parentId;
    this._sourceKey = sourceKey;
    this._title = title;
    this._description = description;
    this._status = status;
    this._priority = priority;
    this._issueType = issueType;
    this._epicId = epicId;
    this._storyPoints = storyPoints;
    this._sprint = sprint;
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
    this._acceptanceCriteria = acceptanceCriteria;
    this._subProjectId = subProjectId;
    this._gapItemId = gapItemId;
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

  private static validateIssueType(issueType: TaskIssueType): TaskIssueType {
    if (!VALID_ISSUE_TYPES.includes(issueType)) {
      throw new ValidationError(`Invalid task issue type: ${issueType}`);
    }
    return issueType;
  }

  /** ストーリーポイント（非負の有限数 / null）を検証する。 */
  private static normalizeStoryPoints(
    points: number | null | undefined,
  ): number | null {
    if (points === null || points === undefined) {
      return null;
    }
    if (!Number.isFinite(points) || points < 0) {
      throw new ValidationError('Story points must be a non-negative number');
    }
    return points;
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
    const issueType = Task.validateIssueType(props.issueType ?? 'TASK');
    const storyPoints = Task.normalizeStoryPoints(props.storyPoints);
    const progress = Task.normalizeProgress(props.progress ?? 0);

    if (props.parentId && props.parentId === id) {
      throw new ValidationError('A task cannot be its own parent');
    }

    const now = new Date();
    return new Task(
      id,
      props.projectId,
      props.parentId ?? null,
      props.sourceKey?.trim() || null,
      title,
      props.description?.trim() || null,
      status,
      priority,
      issueType,
      props.epicId ?? null,
      storyPoints,
      props.sprint?.trim() || null,
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
      null, // linkedIssueNode（作成時は join 情報なし）
      props.acceptanceCriteria?.trim() || null,
      props.subProjectId ?? null,
      props.gapItemId ?? null,
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
      props.sourceKey ?? null,
      props.title,
      props.description,
      props.status,
      props.priority,
      props.issueType,
      props.epicId,
      props.storyPoints,
      props.sprint,
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
      props.acceptanceCriteria ?? null,
      props.subProjectId ?? null,
      props.gapItemId ?? null,
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
    if (props.issueType !== undefined) {
      this._issueType = Task.validateIssueType(props.issueType);
    }
    if (props.epicId !== undefined) {
      this._epicId = props.epicId ?? null;
    }
    if (props.storyPoints !== undefined) {
      this._storyPoints = Task.normalizeStoryPoints(props.storyPoints);
    }
    if (props.sprint !== undefined) {
      this._sprint = props.sprint?.trim() || null;
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
    if (props.acceptanceCriteria !== undefined) {
      this._acceptanceCriteria = props.acceptanceCriteria?.trim() || null;
    }
    if (props.subProjectId !== undefined) {
      this._subProjectId = props.subProjectId ?? null;
    }
    if (props.riskId !== undefined) {
      this._riskId = props.riskId ?? null;
    }
    if (props.gapItemId !== undefined) {
      this._gapItemId = props.gapItemId ?? null;
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

  /** 外部トラッカー由来キー（手動作成タスクは null）。 */
  get sourceKey(): string | null {
    return this._sourceKey;
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

  /** イシュー種別（EPIC/STORY/TASK/SUBTASK/BUG/OTHER）。 */
  get issueType(): TaskIssueType {
    return this._issueType;
  }

  /** 所属 Epic の TaskId（未紐付けは null）。 */
  get epicId(): string | null {
    return this._epicId;
  }

  /** ストーリーポイント（未設定は null）。 */
  get storyPoints(): number | null {
    return this._storyPoints;
  }

  /** スプリント識別子（未設定は null）。 */
  get sprint(): string | null {
    return this._sprint;
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

  /** GAP（課題）への紐付け先 GapItemID（未紐付けは null）。 */
  get gapItemId(): string | null {
    return this._gapItemId;
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

  get acceptanceCriteria(): string | null {
    return this._acceptanceCriteria;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }
}
