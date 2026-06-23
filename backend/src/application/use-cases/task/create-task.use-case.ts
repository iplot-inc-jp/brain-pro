import { Inject, Injectable } from '@nestjs/common';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskIssueType,
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
} from '../../../domain';
import { TaskOutput, toTaskOutput } from './task.output';
import { rollupAncestorDates } from './rollup-parent-dates';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { TaskWebhookService } from '../../../infrastructure/services/task-webhook.service';

export interface CreateTaskInput {
  userId: string;
  projectId: string;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  /** イシュー種別（省略時は 'TASK'）。 */
  issueType?: TaskIssueType;
  /** 所属 Epic の TaskId（任意）。null は未紐付け。 */
  epicId?: string | null;
  /** ストーリーポイント（任意）。null は未設定。 */
  storyPoints?: number | null;
  /** スプリント識別子（任意）。null は未設定。 */
  sprint?: string | null;
  assigneeName?: string | null;
  assigneeRoleId?: string | null;
  issueNodeId?: string | null;
  /** 達成条件（自由記述）。 */
  acceptanceCriteria?: string | null;
  /** 領域（SubProject）への紐付け。 */
  subProjectId?: string | null;
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

/**
 * タスク作成ユースケース
 */
@Injectable()
export class CreateTaskUseCase {
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
    private readonly projectAccess: ProjectAccessService,
    private readonly taskWebhook: TaskWebhookService,
  ) {}

  async execute(input: CreateTaskInput): Promise<TaskOutput> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: タスク作成は書込のため edit 強制
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'edit',
    );

    // 親タスクが指定されている場合、同一プロジェクトに属することを確認
    if (input.parentId) {
      const parent = await this.taskRepository.findById(input.parentId);
      if (!parent || parent.projectId !== input.projectId) {
        throw new EntityNotFoundError('Task', input.parentId);
      }
    }

    // 紐付けノードが指定されている場合、同一プロジェクトのツリーに属することを確認
    if (input.issueNodeId) {
      await this.assertIssueNodeInProject(input.issueNodeId, input.projectId);
    }

    const id = this.taskRepository.generateId();
    const task = Task.create(
      {
        projectId: input.projectId,
        parentId: input.parentId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        issueType: input.issueType,
        epicId: input.epicId,
        storyPoints: input.storyPoints,
        sprint: input.sprint,
        assigneeName: input.assigneeName,
        assigneeRoleId: input.assigneeRoleId,
        issueNodeId: input.issueNodeId,
        acceptanceCriteria: input.acceptanceCriteria,
        subProjectId: input.subProjectId,
        riskId: input.riskId,
        startDate: input.startDate,
        dueDate: input.dueDate,
        progress: input.progress,
        estimatedHours: input.estimatedHours,
        actualHours: input.actualHours,
        milestone: input.milestone,
        category: input.category,
        order: input.order,
      },
      id,
    );

    await this.taskRepository.save(task);

    // 親タスクの期間ロールアップ（親は子の最小開始日・最大期日に合わせる）
    if (task.parentId) {
      await rollupAncestorDates(this.taskRepository, task.parentId);
    }

    // 紐付けノードのラベル/種別を出力に含めるため再読込（join 済み）
    const saved = await this.taskRepository.findById(id);
    const output = toTaskOutput(saved ?? task);

    // Webhook 配信（task.created）。best-effort で本処理を巻き込まない。
    await this.taskWebhook.enqueueForEvent(
      input.projectId,
      'task.created',
      output,
      input.userId,
    );

    return output;
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
}
