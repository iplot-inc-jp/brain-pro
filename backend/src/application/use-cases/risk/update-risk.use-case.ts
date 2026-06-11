import { Inject, Injectable } from '@nestjs/common';
import {
  IRiskRepository,
  RISK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  IRiskCategoryRepository,
  RISK_CATEGORY_REPOSITORY,
  IStakeholderRepository,
  STAKEHOLDER_REPOSITORY,
  IMeetingRepository,
  MEETING_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { RiskOutput, toRiskOutput } from './create-risk.use-case';
import { assertRiskReferencesInProject } from './assert-risk-references';

export interface UpdateRiskInput {
  userId: string;
  id: string;
  code?: string | null;
  type?: string | null;
  event?: string | null;
  causeCategory?: string | null;
  probability?: string | null;
  impact?: string | null;
  priority?: string | null;
  countermeasure?: string | null;
  needsMtg?: string | null;
  mtgDate?: string | null;
  deadline?: string | null;
  owner?: string | null;
  status?: string | null;
  note?: string | null;
  order?: number;
  // --- PMBOK準拠の追加項目（全て optional・後方互換） ---
  categoryId?: string | null;
  subProjectId?: string | null;
  ownerStakeholderId?: string | null;
  reviewMeetingId?: string | null;
  probabilityScore?: number | null;
  impactScore?: number | null;
  riskType?: string | null;
  strategy?: string | null;
  responsePlan?: string | null;
  contingencyPlan?: string | null;
  trigger?: string | null;
  lifecycle?: string | null;
}

/**
 * リスク更新ユースケース
 */
@Injectable()
export class UpdateRiskUseCase {
  constructor(
    @Inject(RISK_REPOSITORY)
    private readonly riskRepository: IRiskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(RISK_CATEGORY_REPOSITORY)
    private readonly riskCategoryRepository: IRiskCategoryRepository,
    @Inject(STAKEHOLDER_REPOSITORY)
    private readonly stakeholderRepository: IStakeholderRepository,
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepository: IMeetingRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: UpdateRiskInput): Promise<RiskOutput> {
    // 1. リスク存在確認
    const risk = await this.riskRepository.findById(input.id);
    if (!risk) {
      throw new EntityNotFoundError('Risk', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(risk.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', risk.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3.5 参照ID（カテゴリ・サブ領域・オーナー・レビュー会議）が
    //     リスクと同一プロジェクトに属することを確認
    await assertRiskReferencesInProject(
      {
        riskCategoryRepository: this.riskCategoryRepository,
        stakeholderRepository: this.stakeholderRepository,
        meetingRepository: this.meetingRepository,
        prisma: this.prisma,
      },
      risk.projectId,
      input,
    );

    // 4. ドメインロジック適用
    risk.update({
      code: input.code,
      type: input.type,
      event: input.event,
      causeCategory: input.causeCategory,
      probability: input.probability,
      impact: input.impact,
      priority: input.priority,
      countermeasure: input.countermeasure,
      needsMtg: input.needsMtg,
      mtgDate: input.mtgDate,
      deadline: input.deadline,
      owner: input.owner,
      status: input.status,
      note: input.note,
      order: input.order,
      categoryId: input.categoryId,
      subProjectId: input.subProjectId,
      ownerStakeholderId: input.ownerStakeholderId,
      reviewMeetingId: input.reviewMeetingId,
      probabilityScore: input.probabilityScore,
      impactScore: input.impactScore,
      riskType: input.riskType,
      strategy: input.strategy,
      responsePlan: input.responsePlan,
      contingencyPlan: input.contingencyPlan,
      trigger: input.trigger,
      lifecycle: input.lifecycle,
    });

    // 5. 永続化
    await this.riskRepository.save(risk);

    // 6. 出力返却
    return toRiskOutput(risk);
  }
}
