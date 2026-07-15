import { Inject, Injectable } from '@nestjs/common';
import {
  IDemandDataRepository,
  DEMAND_DATA_REPOSITORY,
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

export interface DeleteDemandDataInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 需要データ削除ユースケース
 */
@Injectable()
export class DeleteDemandDataUseCase {
  constructor(
    @Inject(DEMAND_DATA_REPOSITORY)
    private readonly demandDataRepository: IDemandDataRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteDemandDataInput): Promise<void> {
    // 1. 需要データ存在確認
    const demandData = await this.demandDataRepository.findById(input.id);
    if (!demandData) {
      throw new EntityNotFoundError('DemandData', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(demandData.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', demandData.projectId);
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
      demandData.projectId,
      'edit',
    );

    // 4. 削除
    await this.demandDataRepository.delete(input.id);
  }
}
