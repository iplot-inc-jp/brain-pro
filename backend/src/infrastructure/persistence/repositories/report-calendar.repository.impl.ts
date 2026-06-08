import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ReportCalendar, IReportCalendarRepository } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ReportCalendar リポジトリ実装
 */
@Injectable()
export class ReportCalendarRepositoryImpl
  implements IReportCalendarRepository
{
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
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
  }): ReportCalendar {
    return ReportCalendar.reconstruct({
      id: data.id,
      projectId: data.projectId,
      stakeholderId: data.stakeholderId,
      reportTo: data.reportTo,
      meetingId: data.meetingId,
      reportContent: data.reportContent,
      frequency: data.frequency,
      dayTime: data.dayTime,
      format: data.format,
      medium: data.medium,
      drafter: data.drafter,
      approver: data.approver,
      templateRef: data.templateRef,
      note: data.note,
      order: data.order,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findById(id: string): Promise<ReportCalendar | null> {
    const data = await this.prisma.reportCalendar.findUnique({ where: { id } });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<ReportCalendar[]> {
    const data = await this.prisma.reportCalendar.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(reportCalendar: ReportCalendar): Promise<void> {
    const data = {
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
    };

    await this.prisma.reportCalendar.upsert({
      where: { id: reportCalendar.id },
      create: {
        id: reportCalendar.id,
        ...data,
        createdAt: reportCalendar.createdAt,
        updatedAt: reportCalendar.updatedAt,
      },
      update: {
        ...data,
        updatedAt: reportCalendar.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.reportCalendar.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
