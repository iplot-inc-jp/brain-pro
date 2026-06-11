import { Inject, Injectable } from '@nestjs/common';
import {
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

export interface UpdateRiskCategoryInput {
  userId: string;
  riskCategoryId: string;
  name?: string;
  order?: number;
}

/**
 * リスクカテゴリ更新ユースケース（改名・並べ替え）
 */
@Injectable()
export class UpdateRiskCategoryUseCase {
  constructor(
    @Inject(RISK_CATEGORY_REPOSITORY)
    private readonly riskCategoryRepository: IRiskCategoryRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: UpdateRiskCategoryInput): Promise<RiskCategoryOutput> {
    const category = await this.riskCategoryRepository.findById(
      input.riskCategoryId,
    );
    if (!category) {
      throw new EntityNotFoundError('RiskCategory', input.riskCategoryId);
    }

    const project = await this.projectRepository.findById(category.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', category.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    category.update({
      name: input.name,
      order: input.order,
    });
    await this.riskCategoryRepository.update(category);

    return toRiskCategoryOutput(category);
  }
}
