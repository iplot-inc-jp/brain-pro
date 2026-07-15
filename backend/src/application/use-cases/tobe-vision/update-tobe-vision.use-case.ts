import { Inject, Injectable } from '@nestjs/common';
import {
  ITobeVisionRepository,
  TOBE_VISION_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  IBusinessFlowRepository,
  BUSINESS_FLOW_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  TobeVisionOutput,
  toTobeVisionOutput,
  assertAsisFlowBelongsToProject,
} from './create-tobe-vision.use-case';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface UpdateTobeVisionInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  area?: string | null;
  vision?: string | null;
  countermeasure?: string | null;
  effect?: string | null;
  order?: number;
  subProjectId?: string | null;
  asisFlowId?: string | null;
}

/**
 * TOBEビジョン更新ユースケース
 */
@Injectable()
export class UpdateTobeVisionUseCase {
  constructor(
    @Inject(TOBE_VISION_REPOSITORY)
    private readonly tobeVisionRepository: ITobeVisionRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY)
    private readonly businessFlowRepository: IBusinessFlowRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateTobeVisionInput): Promise<TobeVisionOutput> {
    // 1. TOBEビジョン存在確認
    const tobeVision = await this.tobeVisionRepository.findById(input.id);
    if (!tobeVision) {
      throw new EntityNotFoundError('TobeVision', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(tobeVision.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', tobeVision.projectId);
    }

    // 3. 組織メンバー確認
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
      tobeVision.projectId,
      'edit',
    );

    // 3.5 asisFlowId 整合性確認（同一プロジェクトの ASIS フローのみ許可）
    await assertAsisFlowBelongsToProject(
      this.businessFlowRepository,
      input.asisFlowId,
      tobeVision.projectId,
    );

    // 4. ドメインロジック適用
    tobeVision.update({
      area: input.area,
      vision: input.vision,
      countermeasure: input.countermeasure,
      effect: input.effect,
      order: input.order,
      subProjectId: input.subProjectId,
      asisFlowId: input.asisFlowId,
    });

    // 5. 永続化
    await this.tobeVisionRepository.save(tobeVision);

    // 6. 出力返却
    return toTobeVisionOutput(tobeVision);
  }
}
