import { Inject, Injectable } from '@nestjs/common';
import {
  IGapItemRepository,
  GAP_ITEM_REPOSITORY,
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

export interface DeleteGapItemInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * GAP削除ユースケース
 */
@Injectable()
export class DeleteGapItemUseCase {
  constructor(
    @Inject(GAP_ITEM_REPOSITORY)
    private readonly gapItemRepository: IGapItemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteGapItemInput): Promise<void> {
    // 1. GAP存在確認
    const gapItem = await this.gapItemRepository.findById(input.id);
    if (!gapItem) {
      throw new EntityNotFoundError('GapItem', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(gapItem.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', gapItem.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3.5 プロジェクト単位 RBAC: GAP削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      gapItem.projectId,
      'edit',
    );

    // 4. 削除
    await this.gapItemRepository.delete(input.id);
  }
}
