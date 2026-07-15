import { Inject, Injectable } from '@nestjs/common';
import {
  IStakeholderRepository,
  STAKEHOLDER_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  StakeholderOutput,
  toStakeholderOutput,
} from './create-stakeholder.use-case';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export interface UpdateStakeholderInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  name?: string;
  affiliation?: string | null;
  role?: string | null;
  interest?: string | null;
  concern?: string | null;
  influence?: string | null;
  support?: string | null;
  engagement?: string | null;
  reportFrequency?: string | null;
  contactMethod?: string | null;
  owner?: string | null;
  reportLine?: string | null;
  asisHearing?: string | null;
  tobeSparring?: string | null;
  note?: string | null;
  side?: string | null;
  order?: number;
}

/**
 * ステークホルダー更新ユースケース
 */
@Injectable()
export class UpdateStakeholderUseCase {
  constructor(
    @Inject(STAKEHOLDER_REPOSITORY)
    private readonly stakeholderRepository: IStakeholderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateStakeholderInput): Promise<StakeholderOutput> {
    // 1. ステークホルダー存在確認
    const stakeholder = await this.stakeholderRepository.findById(input.id);
    if (!stakeholder) {
      throw new EntityNotFoundError('Stakeholder', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(
      stakeholder.projectId,
    );
    if (!project) {
      throw new EntityNotFoundError('Project', stakeholder.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3.5 プロジェクト単位 RBAC: ステークホルダー更新は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      stakeholder.projectId,
      'edit',
    );

    // 4. ドメインロジック適用
    stakeholder.update({
      name: input.name,
      affiliation: input.affiliation,
      role: input.role,
      interest: input.interest,
      concern: input.concern,
      influence: input.influence,
      support: input.support,
      engagement: input.engagement,
      reportFrequency: input.reportFrequency,
      contactMethod: input.contactMethod,
      owner: input.owner,
      reportLine: input.reportLine,
      asisHearing: input.asisHearing,
      tobeSparring: input.tobeSparring,
      note: input.note,
      side: input.side,
      order: input.order,
    });

    // 5. 永続化
    await this.stakeholderRepository.save(stakeholder);

    // 6. 出力返却
    return toStakeholderOutput(stakeholder);
  }
}
