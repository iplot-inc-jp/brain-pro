import { Inject, Injectable } from '@nestjs/common';
import {
  Meeting,
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

export interface CreateMeetingInput {
  userId: string;
  projectId: string;
  name: string;
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

export interface MeetingOutput {
  id: string;
  projectId: string;
  name: string;
  purpose: string | null;
  frequency: string | null;
  dayTime: string | null;
  requiredAttendees: string | null;
  optionalAttendees: string | null;
  agendaTemplate: string | null;
  preMaterials: string | null;
  minutesOwner: string | null;
  decisionMaker: string | null;
  format: string | null;
  durationMinutes: number | null;
  locationUrl: string | null;
  ownerStakeholderId: string | null;
  status: string | null;
  goal: string | null;
  note: string | null;
  order: number;
  stakeholderIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export function toMeetingOutput(meeting: Meeting): MeetingOutput {
  return {
    id: meeting.id,
    projectId: meeting.projectId,
    name: meeting.name,
    purpose: meeting.purpose,
    frequency: meeting.frequency,
    dayTime: meeting.dayTime,
    requiredAttendees: meeting.requiredAttendees,
    optionalAttendees: meeting.optionalAttendees,
    agendaTemplate: meeting.agendaTemplate,
    preMaterials: meeting.preMaterials,
    minutesOwner: meeting.minutesOwner,
    decisionMaker: meeting.decisionMaker,
    format: meeting.format,
    durationMinutes: meeting.durationMinutes,
    locationUrl: meeting.locationUrl,
    ownerStakeholderId: meeting.ownerStakeholderId,
    status: meeting.status,
    goal: meeting.goal,
    note: meeting.note,
    order: meeting.order,
    stakeholderIds: meeting.stakeholderIds,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
  };
}

/**
 * 会議体作成ユースケース
 */
@Injectable()
export class CreateMeetingUseCase {
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

  async execute(input: CreateMeetingInput): Promise<MeetingOutput> {
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

    // 3. 主催ステークホルダーが同じプロジェクトに属することを検証
    const ownerStakeholderId = input.ownerStakeholderId?.trim();
    if (ownerStakeholderId) {
      const stakeholder =
        await this.stakeholderRepository.findById(ownerStakeholderId);
      if (!stakeholder) {
        throw new EntityNotFoundError('Stakeholder', ownerStakeholderId);
      }
      if (stakeholder.projectId !== input.projectId) {
        throw new ValidationError(
          'Owner stakeholder does not belong to the same project as the meeting',
        );
      }
    }

    // 4. ID生成
    const id = this.meetingRepository.generateId();

    // 5. エンティティ生成
    const meeting = Meeting.create(
      {
        projectId: input.projectId,
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
      },
      id,
    );

    // 6. 永続化
    await this.meetingRepository.save(meeting);

    // 7. 出力返却
    return toMeetingOutput(meeting);
  }
}
