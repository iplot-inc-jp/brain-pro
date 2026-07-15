import { Inject, Injectable } from '@nestjs/common';
import {
  ITobeVisionRepository,
  TOBE_VISION_REPOSITORY,
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

export interface DeleteTobeVisionInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * TOBEビジョン削除ユースケース
 */
@Injectable()
export class DeleteTobeVisionUseCase {
  constructor(
    @Inject(TOBE_VISION_REPOSITORY)
    private readonly tobeVisionRepository: ITobeVisionRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteTobeVisionInput): Promise<void> {
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

    // 4. 削除
    await this.tobeVisionRepository.delete(input.id);
  }
}
