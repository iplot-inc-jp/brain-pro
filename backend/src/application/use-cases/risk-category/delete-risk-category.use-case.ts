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
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteRiskCategoryInput {
  userId: string;
  principal: AccessPrincipal;
  riskCategoryId: string;
}

/**
 * リスクカテゴリ削除ユースケース
 * 紐付くリスクの categoryId はスキーマの onDelete: SetNull で未分類に戻る。
 */
@Injectable()
export class DeleteRiskCategoryUseCase {
  constructor(
    @Inject(RISK_CATEGORY_REPOSITORY)
    private readonly riskCategoryRepository: IRiskCategoryRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteRiskCategoryInput): Promise<void> {
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

    // プロジェクト単位 RBAC: リスクカテゴリ削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      category.projectId,
      'edit',
    );

    await this.riskCategoryRepository.delete(input.riskCategoryId);
  }
}
