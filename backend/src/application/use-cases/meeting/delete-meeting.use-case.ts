import { Inject, Injectable } from '@nestjs/common';
import {
  IMeetingRepository,
  MEETING_REPOSITORY,
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

export interface DeleteMeetingInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 会議体削除ユースケース
 */
@Injectable()
export class DeleteMeetingUseCase {
  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepository: IMeetingRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteMeetingInput): Promise<void> {
    // 1. 会議体存在確認
    const meeting = await this.meetingRepository.findById(input.id);
    if (!meeting) {
      throw new EntityNotFoundError('Meeting', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(meeting.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', meeting.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3.5 プロジェクト単位 RBAC: 会議体削除は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      meeting.projectId,
      'edit',
    );

    // 4. 削除
    await this.meetingRepository.delete(input.id);
  }
}
