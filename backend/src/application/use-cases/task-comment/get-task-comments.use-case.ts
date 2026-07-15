import { Inject, Injectable } from '@nestjs/common';
import {
  ITaskCommentRepository,
  TASK_COMMENT_REPOSITORY,
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { TaskCommentOutput, toTaskCommentOutput } from './task-comment.output';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface GetTaskCommentsInput {
  userId: string;
  principal: AccessPrincipal;
  taskId: string;
}

/**
 * タスクのコメント一覧取得ユースケース（古い順）。
 */
@Injectable()
export class GetTaskCommentsUseCase {
  constructor(
    @Inject(TASK_COMMENT_REPOSITORY)
    private readonly taskCommentRepository: ITaskCommentRepository,
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: GetTaskCommentsInput): Promise<TaskCommentOutput[]> {
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

    // プロジェクト単位 RBAC: 会社スコープ越境を防ぐため view 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      task.projectId,
      'view',
    );

    const comments = await this.taskCommentRepository.findByTaskId(
      input.taskId,
    );

    return comments.map((c) => toTaskCommentOutput(c));
  }
}
