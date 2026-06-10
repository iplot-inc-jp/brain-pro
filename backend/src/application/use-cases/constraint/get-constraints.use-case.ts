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
import { ConstraintOutput, toConstraintOutput } from './constraint.output';

export interface GetConstraintsInput {
  userId: string;
  projectId: string;
}

/**
 * プロジェクトの制約条件一覧取得ユースケース
 */
@Injectable()
export class GetConstraintsUseCase {
  constructor(
    @Inject(CONSTRAINT_REPOSITORY)
    private readonly constraintRepository: IConstraintRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetConstraintsInput): Promise<ConstraintOutput[]> {
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

    const constraints = await this.constraintRepository.findByProjectId(
      input.projectId,
    );

    return constraints.map((c) => toConstraintOutput(c));
  }
}
