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
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface RemoveTaskDependencyInput {
  userId: string;
  principal: AccessPrincipal;
  dependencyId: string;
}

/**
 * タスク依存関係削除ユースケース（依存IDで削除）。
 * 関係する後続タスクのプロジェクト所属で認可する。
 */
@Injectable()
export class RemoveTaskDependencyUseCase {
  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: RemoveTaskDependencyInput): Promise<void> {
    const dep = await this.taskRepository.findDependencyById(
      input.dependencyId,
    );
    if (!dep) {
      throw new EntityNotFoundError('TaskDependency', input.dependencyId);
    }

    const successor = await this.taskRepository.findById(dep.successorId);
    if (!successor) {
      throw new EntityNotFoundError('Task', dep.successorId);
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

    // プロジェクト単位 RBAC: 依存削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      successor.projectId,
      'edit',
    );

    await this.taskRepository.deleteDependency(input.dependencyId);
  }
}
