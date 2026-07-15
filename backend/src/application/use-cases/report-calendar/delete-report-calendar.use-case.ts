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
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteReportCalendarInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 報告カレンダー削除ユースケース
 */
@Injectable()
export class DeleteReportCalendarUseCase {
  constructor(
    @Inject(REPORT_CALENDAR_REPOSITORY)
    private readonly reportCalendarRepository: IReportCalendarRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteReportCalendarInput): Promise<void> {
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

    // プロジェクト単位 RBAC: 書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      reportCalendar.projectId,
      'edit',
    );

    // 4. 削除
    await this.reportCalendarRepository.delete(input.id);
  }
}
