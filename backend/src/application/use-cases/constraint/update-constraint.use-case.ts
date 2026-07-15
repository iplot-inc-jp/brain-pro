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
import { ConstraintOutput, toConstraintOutput } from './constraint.output';

export interface UpdateConstraintInput {
  userId: string;
  principal: AccessPrincipal;
  constraintId: string;
  title?: string;
  description?: string | null;
  category?: string | null;
  kind?: string | null;
  order?: number;
  subProjectId?: string | null;
}

/**
 * 制約条件更新ユースケース
 */
@Injectable()
export class UpdateConstraintUseCase {
  constructor(
    @Inject(CONSTRAINT_REPOSITORY)
    private readonly constraintRepository: IConstraintRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateConstraintInput): Promise<ConstraintOutput> {
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

    constraint.update({
      title: input.title,
      description: input.description,
      category: input.category,
      kind: input.kind,
      order: input.order,
      subProjectId: input.subProjectId,
    });
    await this.constraintRepository.update(constraint);

    return toConstraintOutput(constraint);
  }
}
