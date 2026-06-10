import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Role, RoleRepository, RoleType } from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ロールリポジトリ実装
 */
@Injectable()
export class RoleRepositoryImpl implements RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Role | null> {
    const data = await this.prisma.role.findUnique({
      where: { id },
    });

    if (!data) return null;

    return Role.reconstruct({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      type: data.type as RoleType,
      description: data.description,
      color: data.color,
      order: data.order,
      laneHeight: data.laneHeight,
      responsibility: data.responsibility,
      decisionScope: data.decisionScope,
      kpi: data.kpi,
      systemId: data.systemId,
      subProjectId: data.subProjectId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findByProjectId(projectId: string): Promise<Role[]> {
    const data = await this.prisma.role.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });

    return data.map((r) =>
      Role.reconstruct({
        id: r.id,
        projectId: r.projectId,
        name: r.name,
        type: r.type as RoleType,
        description: r.description,
        color: r.color,
        order: r.order,
        laneHeight: r.laneHeight,
        responsibility: r.responsibility,
        decisionScope: r.decisionScope,
        kpi: r.kpi,
        systemId: r.systemId,
        subProjectId: r.subProjectId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }),
    );
  }

  async findByProjectIdAndName(
    projectId: string,
    name: string,
  ): Promise<Role | null> {
    const data = await this.prisma.role.findFirst({
      where: { projectId, name },
    });

    if (!data) return null;

    return Role.reconstruct({
      id: data.id,
      projectId: data.projectId,
      name: data.name,
      type: data.type as RoleType,
      description: data.description,
      color: data.color,
      order: data.order,
      laneHeight: data.laneHeight,
      responsibility: data.responsibility,
      decisionScope: data.decisionScope,
      kpi: data.kpi,
      systemId: data.systemId,
      subProjectId: data.subProjectId,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async existsByProjectIdAndName(
    projectId: string,
    name: string,
  ): Promise<boolean> {
    const count = await this.prisma.role.count({
      where: { projectId, name },
    });
    return count > 0;
  }

  async save(role: Role): Promise<void> {
    await this.prisma.role.upsert({
      where: { id: role.id },
      create: {
        id: role.id,
        projectId: role.projectId,
        name: role.name,
        type: role.type,
        description: role.description,
        color: role.color,
        order: role.order,
        laneHeight: role.laneHeight,
        responsibility: role.responsibility,
        decisionScope: role.decisionScope,
        kpi: role.kpi,
        systemId: role.systemId,
        subProjectId: role.subProjectId,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
      update: {
        name: role.name,
        type: role.type,
        description: role.description,
        color: role.color,
        order: role.order,
        laneHeight: role.laneHeight,
        responsibility: role.responsibility,
        decisionScope: role.decisionScope,
        kpi: role.kpi,
        systemId: role.systemId,
        subProjectId: role.subProjectId,
        updatedAt: role.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.role.delete({
      where: { id },
    });
  }

  generateId(): string {
    return randomUUID();
  }
}

