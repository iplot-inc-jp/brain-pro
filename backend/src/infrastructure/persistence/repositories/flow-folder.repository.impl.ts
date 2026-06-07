import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FlowFolder } from '../../../domain/entities/flow-folder.entity';
import { IFlowFolderRepository } from '../../../domain/repositories/flow-folder.repository';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FlowFolderRepositoryImpl implements IFlowFolderRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    projectId: string;
    parentId: string | null;
    name: string;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): FlowFolder {
    return FlowFolder.reconstruct({
      id: record.id,
      projectId: record.projectId,
      parentId: record.parentId,
      name: record.name,
      order: record.order,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<FlowFolder | null> {
    const record = await this.prisma.flowFolder.findUnique({ where: { id } });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(projectId: string): Promise<FlowFolder[]> {
    const records = await this.prisma.flowFolder.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async findChildrenByParentId(parentId: string): Promise<FlowFolder[]> {
    const records = await this.prisma.flowFolder.findMany({
      where: { parentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return records.map((r) => this.toDomain(r));
  }

  async save(folder: FlowFolder): Promise<void> {
    const data = {
      projectId: folder.projectId,
      parentId: folder.parentId,
      name: folder.name,
      order: folder.order,
    };

    await this.prisma.flowFolder.upsert({
      where: { id: folder.id },
      create: {
        id: folder.id,
        ...data,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
      },
      update: {
        ...data,
        updatedAt: folder.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    // 子フォルダはスキーマの onDelete: Cascade で連鎖削除される
    // 紐づく BusinessFlow.folderId は onDelete: SetNull で NULL になる
    await this.prisma.flowFolder.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }
}
