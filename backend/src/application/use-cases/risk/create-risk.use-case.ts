import { Inject, Injectable } from '@nestjs/common';
import {
  Risk,
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
import { assertRiskReferencesInProject } from './assert-risk-references';

export interface CreateRiskInput {
  userId: string;
  projectId: string;
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

export interface RiskOutput {
  id: string;
  projectId: string;
  code: string | null;
  type: string | null;
  event: string | null;
  causeCategory: string | null;
  probability: string | null;
  impact: string | null;
  priority: string | null;
  countermeasure: string | null;
  needsMtg: string | null;
  mtgDate: string | null;
  deadline: string | null;
  owner: string | null;
  status: string | null;
  note: string | null;
  order: number;
  categoryId: string | null;
  subProjectId: string | null;
  ownerStakeholderId: string | null;
  reviewMeetingId: string | null;
  probabilityScore: number | null;
  impactScore: number | null;
  riskType: string | null;
  strategy: string | null;
  responsePlan: string | null;
  contingencyPlan: string | null;
  trigger: string | null;
  lifecycle: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toRiskOutput(risk: Risk): RiskOutput {
  return {
    id: risk.id,
    projectId: risk.projectId,
    code: risk.code,
    type: risk.type,
    event: risk.event,
    causeCategory: risk.causeCategory,
    probability: risk.probability,
    impact: risk.impact,
    priority: risk.priority,
    countermeasure: risk.countermeasure,
    needsMtg: risk.needsMtg,
    mtgDate: risk.mtgDate,
    deadline: risk.deadline,
    owner: risk.owner,
    status: risk.status,
    note: risk.note,
    order: risk.order,
    categoryId: risk.categoryId,
    subProjectId: risk.subProjectId,
    ownerStakeholderId: risk.ownerStakeholderId,
    reviewMeetingId: risk.reviewMeetingId,
    probabilityScore: risk.probabilityScore,
    impactScore: risk.impactScore,
    riskType: risk.riskType,
    strategy: risk.strategy,
    responsePlan: risk.responsePlan,
    contingencyPlan: risk.contingencyPlan,
    trigger: risk.trigger,
    lifecycle: risk.lifecycle,
    createdAt: risk.createdAt,
    updatedAt: risk.updatedAt,
  };
}

/**
 * リスク作成ユースケース
 */
@Injectable()
export class CreateRiskUseCase {
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

  async execute(input: CreateRiskInput): Promise<RiskOutput> {
    // 1. プロジェクト存在確認
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    // 2. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 2.5 参照ID（カテゴリ・サブ領域・オーナー・レビュー会議）が
    //     同一プロジェクトに属することを確認（assertIssueNodeInProject と同じ作法）
    await assertRiskReferencesInProject(
      {
        riskCategoryRepository: this.riskCategoryRepository,
        stakeholderRepository: this.stakeholderRepository,
        meetingRepository: this.meetingRepository,
        prisma: this.prisma,
      },
      input.projectId,
      input,
    );

    // 3. ID生成
    const id = this.riskRepository.generateId();

    // 4. エンティティ生成
    const risk = Risk.create(
      {
        projectId: input.projectId,
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
      },
      id,
    );

    // 5. 永続化
    await this.riskRepository.save(risk);

    // 6. 出力返却
    return toRiskOutput(risk);
  }
}
