import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Risk, IRiskRepository } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Risk リポジトリ実装
 */
@Injectable()
export class RiskRepositoryImpl implements IRiskRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    projectId: string;
    code: string | null;
    type: string | null;
    event: string | null;
    causeCategory: string | null;
    probability: string | null;
    impact: string | null;
    priority: string | null;
    countermeasure: string | null;
    needsMtg: string | null;
    mtgDate: string | null;
    deadline: string | null;
    owner: string | null;
    status: string | null;
    note: string | null;
    order: number;
    categoryId: string | null;
    subProjectId: string | null;
    ownerStakeholderId: string | null;
    reviewMeetingId: string | null;
    probabilityScore: number | null;
    impactScore: number | null;
    riskType: string | null;
    strategy: string | null;
    responsePlan: string | null;
    contingencyPlan: string | null;
    trigger: string | null;
    lifecycle: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Risk {
    return Risk.reconstruct({
      id: data.id,
      projectId: data.projectId,
      code: data.code,
      type: data.type,
      event: data.event,
      causeCategory: data.causeCategory,
      probability: data.probability,
      impact: data.impact,
      priority: data.priority,
      countermeasure: data.countermeasure,
      needsMtg: data.needsMtg,
      mtgDate: data.mtgDate,
      deadline: data.deadline,
      owner: data.owner,
      status: data.status,
      note: data.note,
      order: data.order,
      categoryId: data.categoryId,
      subProjectId: data.subProjectId,
      ownerStakeholderId: data.ownerStakeholderId,
      reviewMeetingId: data.reviewMeetingId,
      probabilityScore: data.probabilityScore,
      impactScore: data.impactScore,
      riskType: data.riskType,
      strategy: data.strategy,
      responsePlan: data.responsePlan,
      contingencyPlan: data.contingencyPlan,
      trigger: data.trigger,
      lifecycle: data.lifecycle,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findById(id: string): Promise<Risk | null> {
    const data = await this.prisma.risk.findUnique({ where: { id } });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<Risk[]> {
    const data = await this.prisma.risk.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(risk: Risk): Promise<void> {
    const data = {
      projectId: risk.projectId,
      code: risk.code,
      type: risk.type,
      event: risk.event,
      causeCategory: risk.causeCategory,
      probability: risk.probability,
      impact: risk.impact,
      priority: risk.priority,
      countermeasure: risk.countermeasure,
      needsMtg: risk.needsMtg,
      mtgDate: risk.mtgDate,
      deadline: risk.deadline,
      owner: risk.owner,
      status: risk.status,
      note: risk.note,
      order: risk.order,
      categoryId: risk.categoryId,
      subProjectId: risk.subProjectId,
      ownerStakeholderId: risk.ownerStakeholderId,
      reviewMeetingId: risk.reviewMeetingId,
      probabilityScore: risk.probabilityScore,
      impactScore: risk.impactScore,
      riskType: risk.riskType,
      strategy: risk.strategy,
      responsePlan: risk.responsePlan,
      contingencyPlan: risk.contingencyPlan,
      trigger: risk.trigger,
      lifecycle: risk.lifecycle,
    };

    await this.prisma.risk.upsert({
      where: { id: risk.id },
      create: {
        id: risk.id,
        ...data,
        createdAt: risk.createdAt,
        updatedAt: risk.updatedAt,
      },
      update: {
        ...data,
        updatedAt: risk.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.risk.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
