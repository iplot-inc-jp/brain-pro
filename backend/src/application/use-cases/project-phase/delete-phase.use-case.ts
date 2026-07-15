import { Inject, Injectable } from '@nestjs/common';
import {
  IProjectPhaseRepository,
  PROJECT_PHASE_REPOSITORY,
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

export interface DeletePhaseInput {
  userId: string;
  principal: AccessPrincipal;
  phaseId: string;
}

/**
 * フェーズ削除ユースケース
 */
@Injectable()
export class DeletePhaseUseCase {
  constructor(
    @Inject(PROJECT_PHASE_REPOSITORY)
    private readonly projectPhaseRepository: IProjectPhaseRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeletePhaseInput): Promise<void> {
    // 1. フェーズの存在確認
    const phase = await this.projectPhaseRepository.findById(input.phaseId);
    if (!phase) {
      throw new EntityNotFoundError('ProjectPhase', input.phaseId);
    }

    // 2. 親プロジェクトの存在確認
    const project = await this.projectRepository.findById(phase.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', phase.projectId);
    }

    // 3. 組織メンバーシップ確認
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
      phase.projectId,
      'edit',
    );

    // 4. 削除
    await this.projectPhaseRepository.delete(phase.id);
  }
}
