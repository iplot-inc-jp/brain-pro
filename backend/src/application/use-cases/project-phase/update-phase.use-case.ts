import { Inject, Injectable } from '@nestjs/common';
import {
  PhaseKind,
  PhaseStatus,
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

export interface UpdatePhaseInput {
  userId: string;
  principal: AccessPrincipal;
  phaseId: string;
  status?: PhaseStatus;
  order?: number;
  summary?: string | null;
  detail?: string | null;
}

export interface UpdatePhaseOutput {
  id: string;
  projectId: string;
  kind: PhaseKind;
  order: number;
  status: PhaseStatus;
  summary: string | null;
  detail: string | null;
  metadata: Record<string, unknown>;
}

/**
 * フェーズ更新ユースケース（summary / status / order）
 */
@Injectable()
export class UpdatePhaseUseCase {
  constructor(
    @Inject(PROJECT_PHASE_REPOSITORY)
    private readonly projectPhaseRepository: IProjectPhaseRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdatePhaseInput): Promise<UpdatePhaseOutput> {
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

    // 4. 部分更新（ドメインロジック）
    if (input.status !== undefined) {
      phase.transitionTo(input.status);
    }
    if (input.order !== undefined) {
      phase.reorder(input.order);
    }
    if (input.summary !== undefined) {
      phase.updateSummary(input.summary);
    }
    if (input.detail !== undefined) {
      phase.updateDetail(input.detail);
    }

    // 5. 永続化
    await this.projectPhaseRepository.save(phase);

    // 6. 出力返却
    return {
      id: phase.id,
      projectId: phase.projectId,
      kind: phase.kind,
      order: phase.order,
      status: phase.status,
      summary: phase.summary,
      detail: phase.detail,
      metadata: phase.metadata,
    };
  }
}
