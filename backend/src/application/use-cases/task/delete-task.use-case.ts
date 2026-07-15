import { Inject, Injectable } from '@nestjs/common';
import {
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { rollupAncestorDates } from './rollup-parent-dates';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import { TaskWebhookService } from '../../../infrastructure/services/task-webhook.service';

export interface DeleteTaskInput {
  userId: string;
  principal: AccessPrincipal;
  taskId: string;
}

/**
 * タスク削除ユースケース。
 * 子タスク（subtask）はスキーマの onDelete: Cascade で連鎖削除される。
 * 関連する依存関係（TaskDependency）も onDelete: Cascade で削除される。
 */
@Injectable()
export class DeleteTaskUseCase {
  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly taskWebhook: TaskWebhookService,
  ) {}

  async execute(input: DeleteTaskInput): Promise<void> {
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

    // プロジェクト単位 RBAC: タスク削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      task.projectId,
      'edit',
    );

    // 削除前に旧親を保持し、削除後にその期間を再計算する
    const oldParentId = task.parentId;
    // Webhook 配信用に削除前のスナップショットを保持（削除後は参照できない）
    const snapshot = {
      id: task.id,
      projectId: task.projectId,
      parentId: task.parentId,
      title: task.title,
      status: task.status,
      priority: task.priority,
    };

    await this.taskRepository.delete(input.taskId);

    // 親タスクの期間ロールアップ（親は子の最小開始日・最大期日に合わせる）
    if (oldParentId) {
      await rollupAncestorDates(this.taskRepository, oldParentId);
    }

    // Webhook 配信（task.deleted）。best-effort で本処理を巻き込まない。
    await this.taskWebhook.enqueueForEvent(
      snapshot.projectId,
      'task.deleted',
      snapshot,
      input.userId,
    );
  }
}
