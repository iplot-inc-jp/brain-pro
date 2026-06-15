import { Inject, Injectable } from '@nestjs/common';
import {
  Task,
  TaskStatus,
  TaskPriority,
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { parseCsv, wouldFormCycle } from './import-backlog-tasks.use-case';

export interface ImportJiraTasksInput {
  userId: string;
  projectId: string;
  csv: string;
}
export interface ImportJiraTasksRowError {
  row: number;
  message: string;
}
export interface ImportJiraTasksOutput {
  created: number;
  updated: number;
  skipped: number;
  errors: ImportJiraTasksRowError[];
}

const MAX_IMPORT_ROWS = 2000;

/**
 * Jira の課題エクスポート CSV を Task に取り込む。Backlog 版をミラーするが、
 * - 列名は Jira 標準ヘッダ（Summary / Issue key / Status / Priority / Assignee / Due date /
 *   Original Estimate(秒) / Σ Time Spent(秒) / Parent）。
 * - status/priority は Jira 語彙で写像。
 * - sourceKey='JIRA:<Issue key>' で冪等 upsert（再取込で重複させない）。
 */
@Injectable()
export class ImportJiraTasksUseCase {
  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: ImportJiraTasksInput): Promise<ImportJiraTasksOutput> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) throw new EntityNotFoundError('Project', input.projectId);
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember)
      throw new ForbiddenError('You are not a member of this organization');
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'edit',
    );

    const errors: ImportJiraTasksRowError[] = [];
    const rows = parseCsv(input.csv);
    if (rows.length === 0)
      return { created: 0, updated: 0, skipped: 0, errors: [] };

    const col = buildJiraColumnIndex(rows[0]);
    if (col.title === undefined) {
      return {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [
          {
            row: 0,
            message:
              'CSVヘッダに「Summary」列が見つかりません（必須）。Jira の課題エクスポート CSV を貼り付けてください。',
          },
        ],
      };
    }
    const dataRows = rows.slice(1);
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return {
        created: 0,
        updated: 0,
        skipped: 0,
        errors: [
          {
            row: 0,
            message: `取込可能な行数の上限（${MAX_IMPORT_ROWS}行）を超えています（${dataRows.length}行）。CSVを分割してください。`,
          },
        ],
      };
    }

    const keyToTaskId = new Map<string, string>();
    const duplicateKeys = new Set<string>();
    const processed: Array<{
      rowNo: number;
      taskId: string;
      parentKey: string | null;
    } | null> = [];
    let created = 0;
    let updated = 0;

    // ===== パス1: upsert（sourceKey で冪等）=====
    for (let i = 0; i < dataRows.length; i++) {
      const rowNo = i + 1;
      const fields = dataRows[i];
      if (fields.every((f) => f.trim() === '')) {
        processed.push(null);
        continue;
      }

      const title = cell(fields, col.title).trim();
      if (!title) {
        errors.push({ row: rowNo, message: 'Summary（件名）が空のためスキップしました' });
        processed.push(null);
        continue;
      }
      const key = cell(fields, col.key).trim();
      const props = {
        title,
        description: optional(cell(fields, col.description)),
        status: mapJiraStatus(cell(fields, col.status)),
        priority: mapJiraPriority(cell(fields, col.priority)),
        assigneeName: optional(cell(fields, col.assigneeName)),
        dueDate: parseDate(cell(fields, col.dueDate)),
        estimatedHours: secondsToHours(cell(fields, col.estimatedHours)),
        actualHours: secondsToHours(cell(fields, col.actualHours)),
      };

      try {
        let taskId: string;
        const sourceKey = key ? `JIRA:${key}` : null;
        const existing = sourceKey
          ? await this.taskRepository.findByProjectIdAndSourceKey(
              input.projectId,
              sourceKey,
            )
          : null;
        if (existing) {
          existing.update(props); // 既存を更新（重複作成しない）
          await this.taskRepository.save(existing);
          taskId = existing.id;
          updated++;
        } else {
          const id = this.taskRepository.generateId();
          const task = Task.create(
            { projectId: input.projectId, sourceKey, ...props },
            id,
          );
          await this.taskRepository.save(task);
          taskId = id;
          created++;
        }

        if (key) {
          if (keyToTaskId.has(key)) {
            errors.push({
              row: rowNo,
              message: `Issue key「${key}」が重複しています。この行は親解決の対象から除外しました（タスクは作成/更新済み）`,
            });
            duplicateKeys.add(key);
          } else {
            keyToTaskId.set(key, taskId);
          }
        }
        const parentKey = cell(fields, col.parentKey).trim();
        processed.push({ rowNo, taskId, parentKey: parentKey || null });
      } catch (e) {
        errors.push({ row: rowNo, message: (e as Error)?.message ?? String(e) });
        processed.push(null);
      }
    }

    // ===== パス2: 親キー解決（Backlog 版と同一の循環ガード）=====
    const appliedParent = new Map<string, string>();
    for (const entry of processed) {
      if (!entry || !entry.parentKey) continue;
      const parentId = keyToTaskId.get(entry.parentKey);
      if (!parentId || parentId === entry.taskId) continue;
      if (duplicateKeys.has(entry.parentKey)) {
        errors.push({
          row: entry.rowNo,
          message: `親キー「${entry.parentKey}」が重複しており紐付け先が一意でないため親なしにしました`,
        });
        continue;
      }
      if (wouldFormCycle(appliedParent, entry.taskId, parentId)) {
        errors.push({
          row: entry.rowNo,
          message: `親「${entry.parentKey}」を設定すると循環参照になるため親なしにしました`,
        });
        continue;
      }
      try {
        const task = await this.taskRepository.findById(entry.taskId);
        if (!task) continue;
        task.reparent(parentId);
        await this.taskRepository.save(task);
        appliedParent.set(entry.taskId, parentId);
      } catch (e) {
        errors.push({
          row: entry.rowNo,
          message: `親の紐付けに失敗: ${(e as Error)?.message ?? String(e)}`,
        });
      }
    }

    const processedCount = processed.filter((c) => c !== null).length;
    const skipped = dataRows.length - processedCount;
    return { created, updated, skipped, errors };
  }
}

// ===== Jira 列マッピング =====
interface JiraColumnIndex {
  title?: number;
  key?: number;
  description?: number;
  status?: number;
  priority?: number;
  assigneeName?: number;
  dueDate?: number;
  estimatedHours?: number;
  actualHours?: number;
  parentKey?: number;
}
function buildJiraColumnIndex(header: string[]): JiraColumnIndex {
  const norm = (s: string) =>
    (s ?? '')
      .replace(/^﻿/, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  const find = (...names: string[]): number | undefined => {
    for (let i = 0; i < header.length; i++) {
      const h = norm(header[i]);
      if (names.some((n) => h === norm(n))) return i;
    }
    return undefined;
  };
  return {
    title: find('Summary', '件名'),
    key: find('Issue key', 'Issue Key', 'Key'),
    description: find('Description', '説明'),
    status: find('Status', '状態'),
    priority: find('Priority', '優先度'),
    assigneeName: find('Assignee', '担当者'),
    dueDate: find('Due date', 'Due Date', '期限'),
    estimatedHours: find(
      'Original Estimate',
      'Σ Original Estimate',
      'Original estimate',
    ),
    actualHours: find('Time Spent', 'Σ Time Spent', 'Time spent'),
    parentKey: find('Parent', 'Parent key', 'Parent id', 'Parent Issue'),
  };
}
function cell(fields: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return fields[index] ?? '';
}
function optional(value: string): string | null {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
}
// ===== Jira enum 写像 =====
export function mapJiraStatus(raw: string): TaskStatus {
  const v = (raw ?? '').trim().toLowerCase();
  if (['to do', 'todo', 'open', 'backlog', 'reopened'].includes(v))
    return 'OPEN';
  if (['in progress', 'in review', 'doing'].includes(v)) return 'IN_PROGRESS';
  if (['resolved'].includes(v)) return 'RESOLVED';
  if (['done', 'closed', 'complete', 'completed'].includes(v)) return 'CLOSED';
  return 'OPEN';
}
export function mapJiraPriority(raw: string): TaskPriority {
  const v = (raw ?? '').trim().toLowerCase();
  if (['highest', 'high', 'blocker', 'critical'].includes(v)) return 'HIGH';
  if (['medium', 'normal'].includes(v)) return 'MEDIUM';
  if (['low', 'lowest', 'trivial', 'minor'].includes(v)) return 'LOW';
  return 'MEDIUM';
}
// ===== 値パーサ =====
function parseDate(raw: string): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const d = new Date(v.replace(/\//g, '-'));
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Jira CSV の Original Estimate / Time Spent は秒。時間に換算。空/不正は null。 */
function secondsToHours(raw: string): number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const num = Number(v);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round((num / 3600) * 100) / 100;
}
