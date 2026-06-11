import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Meeting, IMeetingRepository } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Meeting リポジトリ実装
 */
@Injectable()
export class MeetingRepositoryImpl implements IMeetingRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
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
    createdAt: Date;
    updatedAt: Date;
    stakeholders?: { stakeholderId: string }[];
  }): Meeting {
    return Meeting.reconstruct({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      purpose: data.purpose,
      frequency: data.frequency,
      dayTime: data.dayTime,
      requiredAttendees: data.requiredAttendees,
      optionalAttendees: data.optionalAttendees,
      agendaTemplate: data.agendaTemplate,
      preMaterials: data.preMaterials,
      minutesOwner: data.minutesOwner,
      decisionMaker: data.decisionMaker,
      format: data.format,
      durationMinutes: data.durationMinutes,
      locationUrl: data.locationUrl,
      ownerStakeholderId: data.ownerStakeholderId,
      status: data.status,
      goal: data.goal,
      note: data.note,
      order: data.order,
      stakeholderIds: (data.stakeholders ?? []).map((s) => s.stakeholderId),
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findById(id: string): Promise<Meeting | null> {
    const data = await this.prisma.meeting.findUnique({
      where: { id },
      include: { stakeholders: { select: { stakeholderId: true } } },
    });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<Meeting[]> {
    const data = await this.prisma.meeting.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { stakeholders: { select: { stakeholderId: true } } },
    });
    return data.map((m) => this.toDomain(m));
  }

  async save(meeting: Meeting): Promise<void> {
    const data = {
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
    };

    await this.prisma.meeting.upsert({
      where: { id: meeting.id },
      create: {
        id: meeting.id,
        ...data,
        createdAt: meeting.createdAt,
        updatedAt: meeting.updatedAt,
      },
      update: {
        ...data,
        updatedAt: meeting.updatedAt,
      },
    });
  }

  async setStakeholders(
    meetingId: string,
    stakeholderIds: string[],
  ): Promise<void> {
    const uniqueIds = Array.from(new Set(stakeholderIds));
    await this.prisma.$transaction([
      this.prisma.meetingStakeholder.deleteMany({ where: { meetingId } }),
      ...(uniqueIds.length > 0
        ? [
            this.prisma.meetingStakeholder.createMany({
              data: uniqueIds.map((stakeholderId) => ({
                id: randomUUID(),
                meetingId,
                stakeholderId,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);
  }

  async delete(id: string): Promise<void> {
    // join行はスキーマの onDelete: Cascade で連鎖削除される
    await this.prisma.meeting.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
