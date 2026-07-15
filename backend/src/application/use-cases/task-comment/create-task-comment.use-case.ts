import { Inject, Injectable } from '@nestjs/common';
import {
  TaskComment,
  ITaskCommentRepository,
  TASK_COMMENT_REPOSITORY,
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  UserRepository,
  USER_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { TaskCommentOutput, toTaskCommentOutput } from './task-comment.output';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface CreateTaskCommentInput {
  userId: string;
  principal: AccessPrincipal;
  taskId: string;
  body: string;
}

/**
 * タスクコメント作成ユースケース。
 * authz: タスク -> プロジェクト -> 組織メンバー（super-admin バイパスは isMember 側）。
 * authorUserId は現在のユーザーIDをセットし、
 * authorName は userRepository で解決できれば name / email を、できなければ undefined。
 */
@Injectable()
export class CreateTaskCommentUseCase {
  constructor(
    @Inject(TASK_COMMENT_REPOSITORY)
    private readonly taskCommentRepository: ITaskCommentRepository,
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: CreateTaskCommentInput): Promise<TaskCommentOutput> {
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

    // プロジェクト単位 RBAC: コメント投稿は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      task.projectId,
      'edit',
    );

    // 投稿者名を解決（解決できなければ undefined のまま）
    let authorName: string | undefined;
    const user = await this.userRepository.findById(input.userId);
    if (user) {
      authorName = user.name ?? user.email;
    }

    const id = this.taskCommentRepository.generateId();
    const comment = TaskComment.create(
      {
        taskId: input.taskId,
        authorUserId: input.userId,
        authorName,
        body: input.body,
      },
      id,
    );

    await this.taskCommentRepository.save(comment);

    return toTaskCommentOutput(comment);
  }
}
