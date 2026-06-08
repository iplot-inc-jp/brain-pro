import { Inject, Injectable } from '@nestjs/common';
import {
  IReportCalendarRepository,
  REPORT_CALENDAR_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  ReportCalendarOutput,
  toReportCalendarOutput,
} from './create-report-calendar.use-case';

export interface GetReportCalendarsInput {
  userId: string;
  projectId: string;
}

/**
 * 報告カレンダー一覧取得ユースケース（プロジェクト内、order昇順）
 */
@Injectable()
export class GetReportCalendarsUseCase {
  constructor(
    @Inject(REPORT_CALENDAR_REPOSITORY)
    private readonly reportCalendarRepository: IReportCalendarRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: GetReportCalendarsInput,
  ): Promise<ReportCalendarOutput[]> {
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

    // 3. 一覧取得
    const reportCalendars =
      await this.reportCalendarRepository.findByProjectId(input.projectId);

    // 4. DTOに変換して返却
    return reportCalendars.map((r) => toReportCalendarOutput(r));
  }
}
