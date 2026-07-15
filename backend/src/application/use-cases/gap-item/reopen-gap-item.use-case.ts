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
import { GapItemOutput, toGapItemOutput } from './create-gap-item.use-case';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface ReopenGapItemInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * GAP再オープンユースケース（status -> OPEN）
 */
@Injectable()
export class ReopenGapItemUseCase {
  constructor(
    @Inject(GAP_ITEM_REPOSITORY)
    private readonly gapItemRepository: IGapItemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: ReopenGapItemInput): Promise<GapItemOutput> {
    const gapItem = await this.gapItemRepository.findById(input.id);
    if (!gapItem) {
      throw new EntityNotFoundError('GapItem', input.id);
    }

    const project = await this.projectRepository.findById(gapItem.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', gapItem.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: GAP再オープンは書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      gapItem.projectId,
      'edit',
    );

    gapItem.reopen();
    await this.gapItemRepository.save(gapItem);
    return toGapItemOutput(gapItem);
  }
}
