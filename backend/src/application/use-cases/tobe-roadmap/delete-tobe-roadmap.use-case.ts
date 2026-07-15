import { Inject, Injectable } from '@nestjs/common';
import {
  ITobeRoadmapRepository,
  TOBE_ROADMAP_REPOSITORY,
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

export interface DeleteTobeRoadmapInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * TOBEロードマップ削除ユースケース
 */
@Injectable()
export class DeleteTobeRoadmapUseCase {
  constructor(
    @Inject(TOBE_ROADMAP_REPOSITORY)
    private readonly tobeRoadmapRepository: ITobeRoadmapRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteTobeRoadmapInput): Promise<void> {
    // 1. TOBEロードマップ存在確認
    const tobeRoadmap = await this.tobeRoadmapRepository.findById(input.id);
    if (!tobeRoadmap) {
      throw new EntityNotFoundError('TobeRoadmap', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(
      tobeRoadmap.projectId,
    );
    if (!project) {
      throw new EntityNotFoundError('Project', tobeRoadmap.projectId);
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
      tobeRoadmap.projectId,
      'edit',
    );

    // 4. 削除
    await this.tobeRoadmapRepository.delete(input.id);
  }
}
