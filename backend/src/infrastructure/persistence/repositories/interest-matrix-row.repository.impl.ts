import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  InterestMatrixRow,
  IInterestMatrixRowRepository,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * InterestMatrixRow リポジトリ実装
 */
@Injectable()
export class InterestMatrixRowRepositoryImpl
  implements IInterestMatrixRowRepository
{
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    projectId: string;
    phase: string | null;
    duration: string | null;
    mainMeetings: string | null;
    fieldStaff: string | null;
    clientPm: string | null;
    executive: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): InterestMatrixRow {
    return InterestMatrixRow.reconstruct({
      id: data.id,
      projectId: data.projectId,
      phase: data.phase,
      duration: data.duration,
      mainMeetings: data.mainMeetings,
      fieldStaff: data.fieldStaff,
      clientPm: data.clientPm,
      executive: data.executive,
      order: data.order,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findById(id: string): Promise<InterestMatrixRow | null> {
    const data = await this.prisma.interestMatrixRow.findUnique({
      where: { id },
    });
    if (!data) return null;
    return this.toDomain(data);
  }

  async findByProjectId(projectId: string): Promise<InterestMatrixRow[]> {
    const data = await this.prisma.interestMatrixRow.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return data.map((r) => this.toDomain(r));
  }

  async save(row: InterestMatrixRow): Promise<void> {
    const data = {
      projectId: row.projectId,
      phase: row.phase,
      duration: row.duration,
      mainMeetings: row.mainMeetings,
      fieldStaff: row.fieldStaff,
      clientPm: row.clientPm,
      executive: row.executive,
      order: row.order,
    };

    await this.prisma.interestMatrixRow.upsert({
      where: { id: row.id },
      create: {
        id: row.id,
        ...data,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      update: {
        ...data,
        updatedAt: row.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.interestMatrixRow.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
