import { Inject, Injectable } from '@nestjs/common';
import {
  IRoadmapPhaseRepository,
  ROADMAP_PHASE_REPOSITORY,
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

export interface DeleteRoadmapPhaseInput {
  userId: string;
  principal: AccessPrincipal;
  roadmapPhaseId: string;
}

/**
 * ロードマップフェーズ削除ユースケース
 */
@Injectable()
export class DeleteRoadmapPhaseUseCase {
  constructor(
    @Inject(ROADMAP_PHASE_REPOSITORY)
    private readonly roadmapPhaseRepository: IRoadmapPhaseRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteRoadmapPhaseInput): Promise<void> {
    const phase = await this.roadmapPhaseRepository.findById(
      input.roadmapPhaseId,
    );
    if (!phase) {
      throw new EntityNotFoundError('RoadmapPhase', input.roadmapPhaseId);
    }

    const project = await this.projectRepository.findById(phase.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', phase.projectId);
    }

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

    await this.roadmapPhaseRepository.delete(input.roadmapPhaseId);
  }
}
