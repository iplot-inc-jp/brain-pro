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

export interface UpdateTaskCommentInput {
  userId: string;
  principal: AccessPrincipal;
  commentId: string;
  body: string;
}

/**
 * タスクコメント更新ユースケース。
 * 作者本人、または組織メンバー（super-admin バイパス含む）が編集できる。
 */
@Injectable()
export class UpdateTaskCommentUseCase {
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

  async execute(input: UpdateTaskCommentInput): Promise<TaskCommentOutput> {
    const comment = await this.taskCommentRepository.findById(input.commentId);
    if (!comment) {
      throw new EntityNotFoundError('TaskComment', input.commentId);
    }

    const task = await this.taskRepository.findById(comment.taskId);
    if (!task) {
      throw new EntityNotFoundError('Task', comment.taskId);
    }

    const project = await this.projectRepository.findById(task.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', task.projectId);
    }

    // プロジェクト単位 RBAC: コメント編集は書込のため edit 強制（VIEW のみのユーザーは
    // 自分のコメントでも編集不可）。
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      task.projectId,
      'edit',
    );

    // 作者本人なら無条件で許可、そうでなければ組織メンバーであることを要求
    if (!comment.isAuthor(input.userId)) {
      const isMember = await this.organizationRepository.isMember(
        project.organizationId,
        input.userId,
      );
      if (!isMember) {
        throw new ForbiddenError('You are not allowed to edit this comment');
      }
    }

    comment.editBody(input.body);

    await this.taskCommentRepository.save(comment);

    return toTaskCommentOutput(comment);
  }
}
