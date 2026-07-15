import { Inject, Injectable } from '@nestjs/common';
import {
  IConstraintRepository,
  CONSTRAINT_REPOSITORY,
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

export interface DeleteConstraintInput {
  userId: string;
  principal: AccessPrincipal;
  constraintId: string;
}

/**
 * 制約条件削除ユースケース
 */
@Injectable()
export class DeleteConstraintUseCase {
  constructor(
    @Inject(CONSTRAINT_REPOSITORY)
    private readonly constraintRepository: IConstraintRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteConstraintInput): Promise<void> {
    const constraint = await this.constraintRepository.findById(
      input.constraintId,
    );
    if (!constraint) {
      throw new EntityNotFoundError('Constraint', input.constraintId);
    }

    const project = await this.projectRepository.findById(constraint.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', constraint.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      constraint.projectId,
      'edit',
    );

    await this.constraintRepository.delete(input.constraintId);
  }
}
