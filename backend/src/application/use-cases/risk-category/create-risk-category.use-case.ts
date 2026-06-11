import { Inject, Injectable } from '@nestjs/common';
import {
  RiskCategory,
  IRiskCategoryRepository,
  RISK_CATEGORY_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  RiskCategoryOutput,
  toRiskCategoryOutput,
} from './risk-category.output';

export interface CreateRiskCategoryInput {
  userId: string;
  projectId: string;
  name: string;
  order?: number;
}

/**
 * リスクカテゴリ作成ユースケース
 */
@Injectable()
export class CreateRiskCategoryUseCase {
  constructor(
    @Inject(RISK_CATEGORY_REPOSITORY)
    private readonly riskCategoryRepository: IRiskCategoryRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateRiskCategoryInput): Promise<RiskCategoryOutput> {
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

    const id = this.riskCategoryRepository.generateId();
    const category = RiskCategory.create(
      {
        projectId: input.projectId,
        name: input.name,
        order: input.order,
      },
      id,
    );

    await this.riskCategoryRepository.create(category);

    return toRiskCategoryOutput(category);
  }
}
