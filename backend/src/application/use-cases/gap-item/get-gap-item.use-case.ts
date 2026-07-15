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
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';
import { GapItemOutput, toGapItemOutput } from './create-gap-item.use-case';

export interface GetGapItemInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * GAP詳細取得ユースケース
 */
@Injectable()
export class GetGapItemUseCase {
  constructor(
    @Inject(GAP_ITEM_REPOSITORY)
    private readonly gapItemRepository: IGapItemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: GetGapItemInput): Promise<GapItemOutput> {
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

    // 3-2. プロジェクト単位 RBAC（会社スコープ）: 読取のため view 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      gapItem.projectId,
      'view',
    );

    // 4. 出力返却
    return toGapItemOutput(gapItem);
  }
}
