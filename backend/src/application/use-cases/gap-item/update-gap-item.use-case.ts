import { Inject, Injectable } from '@nestjs/common';
import {
  GapPriority,
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

export interface UpdateGapItemInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  businessArea?: string;
  phaseId?: string | null;
  asisDescription?: string | null;
  tobeDescription?: string | null;
  gapDescription?: string | null;
  priority?: GapPriority;
  ownerName?: string | null;
  order?: number;
  outOfScope?: boolean;
  asisFlowId?: string | null;
  asisNodeId?: string | null;
  tobeFlowId?: string | null;
  tobeNodeId?: string | null;
  issueTreeId?: string | null;
}

/**
 * GAP更新ユースケース
 */
@Injectable()
export class UpdateGapItemUseCase {
  constructor(
    @Inject(GAP_ITEM_REPOSITORY)
    private readonly gapItemRepository: IGapItemRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateGapItemInput): Promise<GapItemOutput> {
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

    // 3.5 プロジェクト単位 RBAC: GAP更新は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      gapItem.projectId,
      'edit',
    );

    // 4. ドメインロジック適用
    if (input.businessArea !== undefined) {
      gapItem.changeBusinessArea(input.businessArea);
    }
    if (input.phaseId !== undefined) {
      gapItem.changePhase(input.phaseId);
    }
    if (
      input.asisDescription !== undefined ||
      input.tobeDescription !== undefined ||
      input.gapDescription !== undefined
    ) {
      gapItem.updateDescriptions({
        asis: input.asisDescription,
        tobe: input.tobeDescription,
        gap: input.gapDescription,
      });
    }
    if (input.priority !== undefined) {
      gapItem.setPriority(input.priority);
    }
    if (input.ownerName !== undefined) {
      gapItem.changeOwnerName(input.ownerName);
    }
    if (input.order !== undefined) {
      gapItem.reorder(input.order);
    }
    if (input.outOfScope !== undefined) {
      gapItem.setOutOfScope(input.outOfScope);
    }
    if (input.asisFlowId !== undefined || input.asisNodeId !== undefined) {
      gapItem.linkAsis(input.asisFlowId ?? null, input.asisNodeId ?? null);
    }
    if (input.tobeFlowId !== undefined || input.tobeNodeId !== undefined) {
      gapItem.linkTobe(input.tobeFlowId ?? null, input.tobeNodeId ?? null);
    }
    if (input.issueTreeId !== undefined) {
      gapItem.linkIssueTree(input.issueTreeId);
    }

    // 5. 永続化
    await this.gapItemRepository.save(gapItem);

    // 6. 出力返却
    return toGapItemOutput(gapItem);
  }
}
