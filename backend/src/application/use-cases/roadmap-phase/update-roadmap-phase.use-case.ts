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
import { RoadmapPhaseOutput, toRoadmapPhaseOutput } from './roadmap-phase.output';

export interface UpdateRoadmapPhaseInput {
  userId: string;
  principal: AccessPrincipal;
  roadmapPhaseId: string;
  name?: string;
  order?: number;
}

/**
 * ロードマップフェーズ更新ユースケース（改名・並べ替え）
 * legacyKey は互換キーのため変更不可。
 */
@Injectable()
export class UpdateRoadmapPhaseUseCase {
  constructor(
    @Inject(ROADMAP_PHASE_REPOSITORY)
    private readonly roadmapPhaseRepository: IRoadmapPhaseRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateRoadmapPhaseInput): Promise<RoadmapPhaseOutput> {
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

    phase.update({
      name: input.name,
      order: input.order,
    });
    await this.roadmapPhaseRepository.update(phase);

    return toRoadmapPhaseOutput(phase);
  }
}
