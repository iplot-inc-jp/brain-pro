import { Inject, Injectable } from '@nestjs/common';
import {
  IRiskRepository,
  RISK_REPOSITORY,
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

export interface DeleteRiskInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * リスク削除ユースケース
 */
@Injectable()
export class DeleteRiskUseCase {
  constructor(
    @Inject(RISK_REPOSITORY)
    private readonly riskRepository: IRiskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteRiskInput): Promise<void> {
    // 1. リスク存在確認
    const risk = await this.riskRepository.findById(input.id);
    if (!risk) {
      throw new EntityNotFoundError('Risk', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(risk.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', risk.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3.5 プロジェクト単位 RBAC: リスク削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      risk.projectId,
      'edit',
    );

    // 4. 削除
    await this.riskRepository.delete(input.id);
  }
}
