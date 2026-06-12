import { Inject, Injectable } from '@nestjs/common';
import {
  Constraint,
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

export interface CreateConstraintInput {
  userId: string;
  projectId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  kind?: string | null;
  order?: number;
  subProjectId?: string | null;
}

/**
 * 制約条件作成ユースケース
 */
@Injectable()
export class CreateConstraintUseCase {
  constructor(
    @Inject(CONSTRAINT_REPOSITORY)
    private readonly constraintRepository: IConstraintRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateConstraintInput): Promise<ConstraintOutput> {
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

    const id = this.constraintRepository.generateId();
    const constraint = Constraint.create(
      {
        projectId: input.projectId,
        title: input.title,
        description: input.description,
        category: input.category,
        kind: input.kind,
        order: input.order,
        subProjectId: input.subProjectId,
      },
      id,
    );

    await this.constraintRepository.create(constraint);

    return toConstraintOutput(constraint);
  }
}
