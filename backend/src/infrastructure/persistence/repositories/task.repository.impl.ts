import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  Task,
  TaskStatus,
  TaskPriority,
} from '../../../domain/entities/task.entity';
import { IssueNodeKind } from '../../../domain/entities/issue-node.entity';
import {
  ITaskRepository,
  TaskDependencyRecord,
} from '../../../domain/repositories/task.repository';
import { PrismaService } from '../prisma/prisma.service';

/** read 時に issueNode リレーションを join するための include 条件 */
const ISSUE_NODE_INCLUDE = {
  issueNode: { select: { id: true, label: true, kind: true } },
} as const;

@Injectable()
export class TaskRepositoryImpl implements ITaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(record: {
    id: string;
    projectId: string;
    parentId: string | null;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    assigneeName: string | null;
    assigneeRoleId: string | null;
    issueNodeId: string | null;
    riskId: string | null;
    startDate: Date | null;
    dueDate: Date | null;
    progress: number;
    estimatedHours: number | null;
    actualHours: number | null;
    milestone: string | null;
    category: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
    issueNode?: { id: string; label: string; kind: string } | null;
  }): Task {
    return Task.reconstruct({
      id: record.id,
      projectId: record.projectId,
      parentId: record.parentId,
      title: record.title,
      description: record.description,
      status: record.status as TaskStatus,
      priority: record.priority as TaskPriority,
      assigneeName: record.assigneeName,
      assigneeRoleId: record.assigneeRoleId,
      issueNodeId: record.issueNodeId,
      linkedIssueNode: record.issueNode
        ? {
            id: record.issueNode.id,
            label: record.issueNode.label,
            kind: record.issueNode.kind as IssueNodeKind,
          }
        : null,
      riskId: record.riskId,
      startDate: record.startDate,
      dueDate: record.dueDate,
      progress: record.progress,
      estimatedHours: record.estimatedHours,
      actualHours: record.actualHours,
      milestone: record.milestone,
      category: record.category,
      order: record.order,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  async findById(id: string): Promise<Task | null> {
    const record = await this.prisma.task.findUnique({
      where: { id },
      include: ISSUE_NODE_INCLUDE,
    });
    if (!record) return null;
    return this.toDomain(record);
  }

  async findByProjectId(
    projectId: string,
    issueNodeId?: string,
  ): Promise<Task[]> {
    const records = await this.prisma.task.findMany({
      where: {
        projectId,
        ...(issueNodeId ? { issueNodeId } : {}),
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: ISSUE_NODE_INCLUDE,
    });
    return records.map((r) => this.toDomain(r));
  }

  async findChildrenByParentId(parentId: string): Promise<Task[]> {
    const records = await this.prisma.task.findMany({
      where: { parentId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: ISSUE_NODE_INCLUDE,
    });
    return records.map((r) => this.toDomain(r));
  }

  async save(task: Task): Promise<void> {
    const data = {
      projectId: task.projectId,
      parentId: task.parentId,
      title: task.title,
      description: task.description,
      status: task.status as TaskStatus,
      priority: task.priority as TaskPriority,
      assigneeName: task.assigneeName,
      assigneeRoleId: task.assigneeRoleId,
      issueNodeId: task.issueNodeId,
      riskId: task.riskId,
      startDate: task.startDate,
      dueDate: task.dueDate,
      progress: task.progress,
      estimatedHours: task.estimatedHours,
      actualHours: task.actualHours,
      milestone: task.milestone,
      category: task.category,
      order: task.order,
    };

    await this.prisma.task.upsert({
      where: { id: task.id },
      create: {
        id: task.id,
        ...data,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
      update: {
        ...data,
        updatedAt: task.updatedAt,
      },
    });
  }

  async delete(id: string): Promise<void> {
    // 子タスクはスキーマの onDelete: Cascade で連鎖削除される。
    // 依存関係（TaskDependency）も onDelete: Cascade で削除される。
    await this.prisma.task.delete({ where: { id } });
  }

  generateId(): string {
    return randomUUID();
  }

  // ===== 依存関係 =====

  private toDepRecord(record: {
    id: string;
    predecessorId: string;
    successorId: string;
  }): TaskDependencyRecord {
    return {
      id: record.id,
      predecessorId: record.predecessorId,
      successorId: record.successorId,
    };
  }

  async findDependenciesByProjectId(
    projectId: string,
  ): Promise<TaskDependencyRecord[]> {
    const records = await this.prisma.taskDependency.findMany({
      where: { successor: { projectId } },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.toDepRecord(r));
  }

  async findDependenciesByTaskId(
    taskId: string,
  ): Promise<TaskDependencyRecord[]> {
    const records = await this.prisma.taskDependency.findMany({
      where: {
        OR: [{ predecessorId: taskId }, { successorId: taskId }],
      },
      orderBy: { createdAt: 'asc' },
    });
    return records.map((r) => this.toDepRecord(r));
  }

  async findDependencyById(
    depId: string,
  ): Promise<TaskDependencyRecord | null> {
    const record = await this.prisma.taskDependency.findUnique({
      where: { id: depId },
    });
    if (!record) return null;
    return this.toDepRecord(record);
  }

  async addDependency(
    predecessorId: string,
    successorId: string,
  ): Promise<TaskDependencyRecord> {
    const record = await this.prisma.taskDependency.upsert({
      where: {
        predecessorId_successorId: { predecessorId, successorId },
      },
      create: { id: randomUUID(), predecessorId, successorId },
      update: {},
    });
    return this.toDepRecord(record);
  }

  async deleteDependency(depId: string): Promise<void> {
    await this.prisma.taskDependency.delete({ where: { id: depId } });
  }

  async deleteDependencyByPair(
    predecessorId: string,
    successorId: string,
  ): Promise<void> {
    await this.prisma.taskDependency.delete({
      where: {
        predecessorId_successorId: { predecessorId, successorId },
      },
    });
  }
}
