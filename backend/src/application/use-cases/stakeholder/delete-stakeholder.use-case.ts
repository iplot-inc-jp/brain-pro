import { Inject, Injectable } from '@nestjs/common';
import {
  IStakeholderRepository,
  STAKEHOLDER_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteStakeholderInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * ステークホルダー削除ユースケース
 */
@Injectable()
export class DeleteStakeholderUseCase {
  constructor(
    @Inject(STAKEHOLDER_REPOSITORY)
    private readonly stakeholderRepository: IStakeholderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteStakeholderInput): Promise<void> {
    // 1. ステークホルダー存在確認
    const stakeholder = await this.stakeholderRepository.findById(input.id);
    if (!stakeholder) {
      throw new EntityNotFoundError('Stakeholder', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(
      stakeholder.projectId,
    );
    if (!project) {
      throw new EntityNotFoundError('Project', stakeholder.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3.5 プロジェクト単位 RBAC: ステークホルダー削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      stakeholder.projectId,
      'edit',
    );

    // 4. 削除
    await this.stakeholderRepository.delete(input.id);
  }
}
