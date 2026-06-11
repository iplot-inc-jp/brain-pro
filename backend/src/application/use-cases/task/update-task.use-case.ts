import { Inject, Injectable } from '@nestjs/common';
import {
  TaskStatus,
  TaskPriority,
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  IIssueNodeRepository,
  ISSUE_NODE_REPOSITORY,
  IIssueTreeRepository,
  ISSUE_TREE_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../../domain';
import { TaskOutput, toTaskOutput } from './task.output';
import { rollupAncestorDates, isSameDate } from './rollup-parent-dates';

export interface UpdateTaskInput {
  userId: string;
  taskId: string;
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

/**
 * タスク更新ユースケース。
 * 親付け替え（reparent）・ステータス・進捗・期日・担当・並び順など
 * 任意のフィールドをまとめて更新できる。
 */
@Injectable()
export class UpdateTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(ISSUE_NODE_REPOSITORY)
    private readonly issueNodeRepository: IIssueNodeRepository,
    @Inject(ISSUE_TREE_REPOSITORY)
    private readonly issueTreeRepository: IIssueTreeRepository,
  ) {}

  async execute(input: UpdateTaskInput): Promise<TaskOutput> {
    const task = await this.taskRepository.findById(input.taskId);
    if (!task) {
      throw new EntityNotFoundError('Task', input.taskId);
    }

    const project = await this.projectRepository.findById(task.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', task.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 親付け替え（reparent）の検証
    if (input.parentId !== undefined && input.parentId !== null) {
      const parent = await this.taskRepository.findById(input.parentId);
      if (!parent || parent.projectId !== task.projectId) {
        throw new EntityNotFoundError('Task', input.parentId);
      }
      if (await this.wouldCreateCycle(task.id, input.parentId)) {
        throw new ValidationError(
          'Cannot move a task into its own descendant',
        );
      }
    }

    // 紐付けノードの差し替え（null は解除）。非nullなら同一プロジェクト所属を検証
    if (input.issueNodeId !== undefined && input.issueNodeId !== null) {
      await this.assertIssueNodeInProject(input.issueNodeId, task.projectId);
    }

    // ロールアップ判定用に更新前の親・日付を保持
    const oldParentId = task.parentId;
    const oldStartDate = task.startDate;
    const oldDueDate = task.dueDate;

    task.update({
      parentId: input.parentId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      assigneeName: input.assigneeName,
      assigneeRoleId: input.assigneeRoleId,
      issueNodeId: input.issueNodeId,
      riskId: input.riskId,
      startDate: input.startDate,
      dueDate: input.dueDate,
      progress: input.progress,
      estimatedHours: input.estimatedHours,
      actualHours: input.actualHours,
      milestone: input.milestone,
      category: input.category,
      order: input.order,
    });

    await this.taskRepository.save(task);

    // 親タスクの期間ロールアップ（親は子の最小開始日・最大期日に合わせる）。
    // 方針: 「子を変えた時だけ」親を自動更新する。親自身を直接動かした場合は
    // その編集をそのまま反映し、子範囲へ揃え直さない（ユーザ要望）。
    const datesChanged =
      !isSameDate(oldStartDate, task.startDate) ||
      !isSameDate(oldDueDate, task.dueDate);
    const parentChanged = oldParentId !== task.parentId;
    if (datesChanged || parentChanged) {
      // 親付け替え時は旧親側も再計算
      if (parentChanged) {
        await rollupAncestorDates(this.taskRepository, oldParentId);
      }
      // このタスクを「子」として、その親（変わっていなければ現在の親）を再計算
      await rollupAncestorDates(this.taskRepository, task.parentId);
    }

    // 紐付けノードのラベル/種別を出力に含めるため再読込
    // （join 済み + ロールアップで自身の日付が揃え直された場合も反映）
    const saved = await this.taskRepository.findById(task.id);
    return toTaskOutput(saved ?? task);
  }

  /** 指定ノードが当該プロジェクトのイシューツリーに属することを検証 */
  private async assertIssueNodeInProject(
    issueNodeId: string,
    projectId: string,
  ): Promise<void> {
    const node = await this.issueNodeRepository.findById(issueNodeId);
    if (!node) {
      throw new EntityNotFoundError('IssueNode', issueNodeId);
    }
    const tree = await this.issueTreeRepository.findById(node.treeId);
    if (!tree || tree.projectId !== projectId) {
      throw new EntityNotFoundError('IssueNode', issueNodeId);
    }
  }

  /** 新しい親が自身またはその子孫であるかを判定 */
  private async wouldCreateCycle(
    taskId: string,
    newParentId: string,
  ): Promise<boolean> {
    let current: string | null = newParentId;
    const visited = new Set<string>();
    while (current) {
      if (current === taskId) return true;
      if (visited.has(current)) break;
      visited.add(current);
      const node = await this.taskRepository.findById(current);
      current = node?.parentId ?? null;
    }
    return false;
  }
}
