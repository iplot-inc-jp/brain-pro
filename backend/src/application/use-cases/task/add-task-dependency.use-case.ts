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
  ValidationError,
} from '../../../domain';
import {
  TaskDependencyOutput,
  toTaskDependencyOutput,
} from './task.output';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface AddTaskDependencyInput {
  userId: string;
  principal: AccessPrincipal;
  /** 後続タスク（このタスクが predecessor を待つ） */
  successorId: string;
  /** 先行タスク */
  predecessorId: string;
}

/**
 * タスク依存関係追加ユースケース（predecessor -> successor）。
 * 自己依存・直接循環（A->B かつ B->A）を防止する。
 */
@Injectable()
export class AddTaskDependencyUseCase {
  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: AddTaskDependencyInput,
  ): Promise<TaskDependencyOutput> {
    if (input.predecessorId === input.successorId) {
      throw new ValidationError('A task cannot depend on itself');
    }

    const successor = await this.taskRepository.findById(input.successorId);
    if (!successor) {
      throw new EntityNotFoundError('Task', input.successorId);
    }

    const project = await this.projectRepository.findById(successor.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', successor.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 依存追加は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      successor.projectId,
      'edit',
    );

    const predecessor = await this.taskRepository.findById(
      input.predecessorId,
    );
    if (!predecessor || predecessor.projectId !== successor.projectId) {
      throw new EntityNotFoundError('Task', input.predecessorId);
    }

    // 直接の逆向き依存があれば循環になるので拒否
    const existing = await this.taskRepository.findDependenciesByTaskId(
      input.successorId,
    );
    const reverse = existing.find(
      (d) =>
        d.predecessorId === input.successorId &&
        d.successorId === input.predecessorId,
    );
    if (reverse) {
      throw new ValidationError(
        'This dependency would create a direct cycle',
      );
    }

    const dep = await this.taskRepository.addDependency(
      input.predecessorId,
      input.successorId,
    );

    return toTaskDependencyOutput(dep);
  }
}
