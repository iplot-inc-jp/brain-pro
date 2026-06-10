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

export interface DeleteConstraintInput {
  userId: string;
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

    await this.constraintRepository.delete(input.constraintId);
  }
}
