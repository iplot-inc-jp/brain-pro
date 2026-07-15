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
  ValidationError,
} from '../../../domain';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import { MeetingOutput, toMeetingOutput } from './create-meeting.use-case';

export interface SetMeetingSubProjectsInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  subProjectIds: string[];
}

/**
 * 会議体の対象サブ領域を置き換えるユースケース
 * join行をまるごと入れ替える
 */
@Injectable()
export class SetMeetingSubProjectsUseCase {
  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepository: IMeetingRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    /** SubProject はドメインリポジトリ未整備のため Prisma を直接参照する。 */
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: SetMeetingSubProjectsInput): Promise<MeetingOutput> {
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

    // 3.5 プロジェクト単位 RBAC: 対象サブ領域の置換は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      meeting.projectId,
      'edit',
    );

    // 4. 指定されたサブ領域が同じプロジェクトに属することを検証
    const uniqueIds = Array.from(new Set(input.subProjectIds));
    for (const subProjectId of uniqueIds) {
      const subProject = await this.prisma.subProject.findUnique({
        where: { id: subProjectId },
        select: { projectId: true },
      });
      if (!subProject) {
        throw new EntityNotFoundError('SubProject', subProjectId);
      }
      if (subProject.projectId !== meeting.projectId) {
        throw new ValidationError(
          'SubProject does not belong to the same project as the meeting',
        );
      }
    }

    // 5. join行の置き換え
    await this.meetingRepository.setSubProjects(input.id, uniqueIds);

    // 6. 最新状態を取得して返却
    const updated = await this.meetingRepository.findById(input.id);
    if (!updated) {
      throw new EntityNotFoundError('Meeting', input.id);
    }
    return toMeetingOutput(updated);
  }
}
