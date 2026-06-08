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

export interface UpdateReportCalendarInput {
  userId: string;
  id: string;
  stakeholderId?: string | null;
  reportTo?: string | null;
  meetingId?: string | null;
  reportContent?: string | null;
  frequency?: string | null;
  dayTime?: string | null;
  format?: string | null;
  medium?: string | null;
  drafter?: string | null;
  approver?: string | null;
  templateRef?: string | null;
  note?: string | null;
  order?: number;
}

/**
 * 報告カレンダー更新ユースケース
 */
@Injectable()
export class UpdateReportCalendarUseCase {
  constructor(
    @Inject(REPORT_CALENDAR_REPOSITORY)
    private readonly reportCalendarRepository: IReportCalendarRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: UpdateReportCalendarInput,
  ): Promise<ReportCalendarOutput> {
    // 1. 報告カレンダー存在確認
    const reportCalendar = await this.reportCalendarRepository.findById(
      input.id,
    );
    if (!reportCalendar) {
      throw new EntityNotFoundError('ReportCalendar', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(
      reportCalendar.projectId,
    );
    if (!project) {
      throw new EntityNotFoundError('Project', reportCalendar.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 4. ドメインロジック適用
    reportCalendar.update({
      stakeholderId: input.stakeholderId,
      reportTo: input.reportTo,
      meetingId: input.meetingId,
      reportContent: input.reportContent,
      frequency: input.frequency,
      dayTime: input.dayTime,
      format: input.format,
      medium: input.medium,
      drafter: input.drafter,
      approver: input.approver,
      templateRef: input.templateRef,
      note: input.note,
      order: input.order,
    });

    // 5. 永続化
    await this.reportCalendarRepository.save(reportCalendar);

    // 6. 出力返却
    return toReportCalendarOutput(reportCalendar);
  }
}
