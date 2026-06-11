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

export interface UpdateMeetingInput {
  userId: string;
  id: string;
  name?: string;
  purpose?: string | null;
  frequency?: string | null;
  dayTime?: string | null;
  requiredAttendees?: string | null;
  optionalAttendees?: string | null;
  agendaTemplate?: string | null;
  preMaterials?: string | null;
  minutesOwner?: string | null;
  decisionMaker?: string | null;
  format?: string | null;
  durationMinutes?: number | null;
  locationUrl?: string | null;
  ownerStakeholderId?: string | null;
  status?: string | null;
  goal?: string | null;
  note?: string | null;
  order?: number;
}

/**
 * 会議体更新ユースケース
 */
@Injectable()
export class UpdateMeetingUseCase {
  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepository: IMeetingRepository,
    @Inject(STAKEHOLDER_REPOSITORY)
    private readonly stakeholderRepository: IStakeholderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: UpdateMeetingInput): Promise<MeetingOutput> {
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

    // 4. 主催ステークホルダーが同じプロジェクトに属することを検証
    const ownerStakeholderId = input.ownerStakeholderId?.trim();
    if (ownerStakeholderId) {
      const stakeholder =
        await this.stakeholderRepository.findById(ownerStakeholderId);
      if (!stakeholder) {
        throw new EntityNotFoundError('Stakeholder', ownerStakeholderId);
      }
      if (stakeholder.projectId !== meeting.projectId) {
        throw new ValidationError(
          'Owner stakeholder does not belong to the same project as the meeting',
        );
      }
    }

    // 5. ドメインロジック適用
    meeting.update({
      name: input.name,
      purpose: input.purpose,
      frequency: input.frequency,
      dayTime: input.dayTime,
      requiredAttendees: input.requiredAttendees,
      optionalAttendees: input.optionalAttendees,
      agendaTemplate: input.agendaTemplate,
      preMaterials: input.preMaterials,
      minutesOwner: input.minutesOwner,
      decisionMaker: input.decisionMaker,
      format: input.format,
      durationMinutes: input.durationMinutes,
      locationUrl: input.locationUrl,
      ownerStakeholderId: input.ownerStakeholderId,
      status: input.status,
      goal: input.goal,
      note: input.note,
      order: input.order,
    });

    // 6. 永続化
    await this.meetingRepository.save(meeting);

    // 7. 出力返却
    return toMeetingOutput(meeting);
  }
}
