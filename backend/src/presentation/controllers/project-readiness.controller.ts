import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import {
  ClaudeService,
  ReadinessAnalysis,
  ReadinessSummaryInput,
} from '../../infrastructure/services/claude.service';
import { CompanyKeyService } from '../../infrastructure/services/company-key.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

type ReadinessStatus = 'empty' | 'started' | 'rich';

interface ReadinessSection {
  key: string;
  label: string;
  group: string;
  count: number;
  target: number;
  status: ReadinessStatus;
}

interface ReadinessGroup {
  key: string;
  label: string;
  /** グループ内セクションの平均充実率（0〜100） */
  percent: number;
  sections: ReadinessSection[];
}

interface ReadinessReport {
  projectName: string | null;
  overallPercent: number;
  totalSections: number;
  completedSections: number;
  groups: ReadinessGroup[];
}

/** グループの表示順（方法論の並び）。 */
const GROUP_ORDER = [
  '背景・目的',
  '共通マスタ',
  '現状把握',
  '現状システム把握',
  '課題・打ち手',
  '設計',
  '推進',
];

/**
 * プロジェクトの「充実度（Readiness）」を各方法論エリアの設定件数から定量的に集計し、
 * さらに LLM（Haiku）に「今 何を優先すべきか」を分析させる。
 *
 * 認可は ProjectAccessGuard（params.projectId から view/edit を判定）に委ねる。
 */
@ApiTags('ProjectReadiness')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects')
export class ProjectReadinessController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claudeService: ClaudeService,
    private readonly companyKeyService: CompanyKeyService,
  ) {}

  @Get(':projectId/readiness')
  @ApiOperation({ summary: 'プロジェクト充実度（定量）を集計' })
  async getReadiness(
    @Param('projectId') projectId: string,
  ): Promise<ReadinessReport> {
    return this.computeReadiness(projectId);
  }

  @Post(':projectId/readiness/analyze')
  @ApiOperation({ summary: 'プロジェクト充実度をLLM(Haiku)で分析' })
  async analyzeReadiness(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<ReadinessAnalysis> {
    const report = await this.computeReadiness(projectId);

    const apiKey = await this.companyKeyService.resolveForProject(
      projectId,
      user.id,
    );
    if (!apiKey) {
      throw new HttpException(
        'Anthropic APIキーが未設定です',
        HttpStatus.BAD_REQUEST,
      );
    }

    const summary: ReadinessSummaryInput = {
      projectName: report.projectName,
      overallPercent: report.overallPercent,
      sections: report.groups.flatMap((g) =>
        g.sections.map((s) => ({
          key: s.key,
          label: s.label,
          group: g.label,
          count: s.count,
          target: s.target,
          status: s.status,
        })),
      ),
    };

    return this.claudeService.analyzeProjectReadiness(summary, apiKey, {
      projectId,
      area: 'OTHER',
      userId: user.id,
    });
  }

  /**
   * 各方法論エリアの件数を並列集計し、セクション/グループ/全体の充実率を返す。
   * status: 0件=未着手, 目安未満=着手, 目安以上=充実。
   */
  private async computeReadiness(projectId: string): Promise<ReadinessReport> {
    const p = projectId;

    // key/label/group/target と件数取得の対応。件数は並列で取得する。
    const defs: Array<{
      key: string;
      label: string;
      group: string;
      target: number;
      count: Promise<number>;
    }> = [
      // 背景・目的
      { key: 'charter', label: 'プロジェクト憲章', group: '背景・目的', target: 1, count: this.prisma.projectCharter.count({ where: { projectId: p } }) },
      { key: 'constraints', label: '制約条件', group: '背景・目的', target: 3, count: this.prisma.constraint.count({ where: { projectId: p } }) },
      // 共通マスタ
      { key: 'roles', label: 'ロール', group: '共通マスタ', target: 3, count: this.prisma.role.count({ where: { projectId: p } }) },
      { key: 'subProjects', label: '領域（サブプロジェクト）', group: '共通マスタ', target: 1, count: this.prisma.subProject.count({ where: { projectId: p } }) },
      { key: 'systems', label: 'システム', group: '共通マスタ', target: 1, count: this.prisma.system.count({ where: { projectId: p } }) },
      { key: 'informationTypes', label: '情報種別', group: '共通マスタ', target: 3, count: this.prisma.informationType.count({ where: { projectId: p } }) },
      { key: 'stakeholders', label: 'ステークホルダー', group: '共通マスタ', target: 3, count: this.prisma.stakeholder.count({ where: { projectId: p } }) },
      { key: 'meetings', label: '会議体', group: '共通マスタ', target: 1, count: this.prisma.meeting.count({ where: { projectId: p } }) },
      // 現状把握
      { key: 'asisFlows', label: 'ASIS業務フロー', group: '現状把握', target: 1, count: this.prisma.businessFlow.count({ where: { projectId: p, kind: 'ASIS' } }) },
      { key: 'asisMemos', label: 'ASISメモ', group: '現状把握', target: 1, count: this.prisma.asisMemo.count({ where: { projectId: p } }) },
      // 現状システム把握
      { key: 'tables', label: 'データカタログ（テーブル）', group: '現状システム把握', target: 3, count: this.prisma.table.count({ where: { projectId: p } }) },
      { key: 'dataObjects', label: 'オブジェクト関係性マップ', group: '現状システム把握', target: 3, count: this.prisma.dataObject.count({ where: { projectId: p } }) },
      // 課題・打ち手
      { key: 'gapItems', label: 'GAP（課題）', group: '課題・打ち手', target: 3, count: this.prisma.gapItem.count({ where: { projectId: p } }) },
      { key: 'issueTrees', label: '課題ツリー', group: '課題・打ち手', target: 1, count: this.prisma.issueTree.count({ where: { projectId: p } }) },
      // 設計
      { key: 'tobeVisions', label: 'あるべき姿（TOBE）', group: '設計', target: 1, count: this.prisma.tobeVision.count({ where: { projectId: p } }) },
      { key: 'tobeFlows', label: 'TOBE業務フロー', group: '設計', target: 1, count: this.prisma.businessFlow.count({ where: { projectId: p, kind: 'TOBE' } }) },
      { key: 'requirements', label: '要求定義', group: '設計', target: 3, count: this.prisma.requirement.count({ where: { projectId: p } }) },
      { key: 'kpis', label: 'KPI', group: '設計', target: 3, count: this.prisma.kpi.count({ where: { projectId: p } }) },
      // 推進
      { key: 'tasks', label: 'タスク', group: '推進', target: 5, count: this.prisma.task.count({ where: { projectId: p } }) },
      { key: 'risks', label: 'リスク', group: '推進', target: 3, count: this.prisma.risk.count({ where: { projectId: p } }) },
    ];

    const [project, counts] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: p },
        select: { name: true },
      }),
      Promise.all(defs.map((d) => d.count)),
    ]);

    const sections: ReadinessSection[] = defs.map((d, i) => {
      const count = counts[i];
      const status: ReadinessStatus =
        count === 0 ? 'empty' : count < d.target ? 'started' : 'rich';
      return {
        key: d.key,
        label: d.label,
        group: d.group,
        count,
        target: d.target,
        status,
      };
    });

    const ratio = (s: ReadinessSection) => Math.min(s.count / s.target, 1);
    const overallPercent = sections.length
      ? Math.round(
          (sections.reduce((a, s) => a + ratio(s), 0) / sections.length) * 100,
        )
      : 0;

    const groups: ReadinessGroup[] = GROUP_ORDER.map((g) => {
      const gs = sections.filter((s) => s.group === g);
      const percent = gs.length
        ? Math.round((gs.reduce((a, s) => a + ratio(s), 0) / gs.length) * 100)
        : 0;
      return { key: g, label: g, percent, sections: gs };
    }).filter((gr) => gr.sections.length > 0);

    return {
      projectName: project?.name ?? null,
      overallPercent,
      totalSections: sections.length,
      completedSections: sections.filter((s) => s.count > 0).length,
      groups,
    };
  }
}
