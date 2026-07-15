import { Inject, Injectable } from '@nestjs/common';
import {
  IMeetingRepository,
  MEETING_REPOSITORY,
  IStakeholderRepository,
  STAKEHOLDER_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../../domain';
import { MeetingOutput, toMeetingOutput } from './create-meeting.use-case';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface SetMeetingStakeholdersInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  stakeholderIds: string[];
}

/**
 * 会議体の対象ステークホルダーを置き換えるユースケース
 * join行をまるごと入れ替える
 */
@Injectable()
export class SetMeetingStakeholdersUseCase {
  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepository: IMeetingRepository,
    @Inject(STAKEHOLDER_REPOSITORY)
    private readonly stakeholderRepository: IStakeholderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: SetMeetingStakeholdersInput): Promise<MeetingOutput> {
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

    // 3.5 プロジェクト単位 RBAC: 出席者の置換は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      meeting.projectId,
      'edit',
    );

    // 4. 指定されたステークホルダーが同じプロジェクトに属することを検証
    const uniqueIds = Array.from(new Set(input.stakeholderIds));
    for (const stakeholderId of uniqueIds) {
      const stakeholder =
        await this.stakeholderRepository.findById(stakeholderId);
      if (!stakeholder) {
        throw new EntityNotFoundError('Stakeholder', stakeholderId);
      }
      if (stakeholder.projectId !== meeting.projectId) {
        throw new ValidationError(
          'Stakeholder does not belong to the same project as the meeting',
        );
      }
    }

    // 5. join行の置き換え
    await this.meetingRepository.setStakeholders(input.id, uniqueIds);

    // 6. 最新状態を取得して返却
    const updated = await this.meetingRepository.findById(input.id);
    if (!updated) {
      throw new EntityNotFoundError('Meeting', input.id);
    }
    return toMeetingOutput(updated);
  }
}
