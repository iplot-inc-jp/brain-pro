import { Inject, Injectable } from '@nestjs/common';
import {
  ReportCalendar,
  IReportCalendarRepository,
  REPORT_CALENDAR_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';

export interface CreateReportCalendarInput {
  userId: string;
  projectId: string;
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

export interface ReportCalendarOutput {
  id: string;
  projectId: string;
  stakeholderId: string | null;
  reportTo: string | null;
  meetingId: string | null;
  reportContent: string | null;
  frequency: string | null;
  dayTime: string | null;
  format: string | null;
  medium: string | null;
  drafter: string | null;
  approver: string | null;
  templateRef: string | null;
  note: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toReportCalendarOutput(
  reportCalendar: ReportCalendar,
): ReportCalendarOutput {
  return {
    id: reportCalendar.id,
    projectId: reportCalendar.projectId,
    stakeholderId: reportCalendar.stakeholderId,
    reportTo: reportCalendar.reportTo,
    meetingId: reportCalendar.meetingId,
    reportContent: reportCalendar.reportContent,
    frequency: reportCalendar.frequency,
    dayTime: reportCalendar.dayTime,
    format: reportCalendar.format,
    medium: reportCalendar.medium,
    drafter: reportCalendar.drafter,
    approver: reportCalendar.approver,
    templateRef: reportCalendar.templateRef,
    note: reportCalendar.note,
    order: reportCalendar.order,
    createdAt: reportCalendar.createdAt,
    updatedAt: reportCalendar.updatedAt,
  };
}

/**
 * 報告カレンダー作成ユースケース
 */
@Injectable()
export class CreateReportCalendarUseCase {
  constructor(
    @Inject(REPORT_CALENDAR_REPOSITORY)
    private readonly reportCalendarRepository: IReportCalendarRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: CreateReportCalendarInput,
  ): Promise<ReportCalendarOutput> {
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

    // 3. ID生成
    const id = this.reportCalendarRepository.generateId();

    // 4. エンティティ生成
    const reportCalendar = ReportCalendar.create(
      {
        projectId: input.projectId,
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
      },
      id,
    );

    // 5. 永続化
    await this.reportCalendarRepository.save(reportCalendar);

    // 6. 出力返却
    return toReportCalendarOutput(reportCalendar);
  }
}
