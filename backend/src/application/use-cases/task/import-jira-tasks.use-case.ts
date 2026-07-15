import { Inject, Injectable } from '@nestjs/common';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskIssueType,
  ITaskRepository,
  TASK_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import {
  mapStatus,
  mapPriority,
} from '../../../infrastructure/services/trackers/tracker-import.service';
import { parseCsv, wouldFormCycle } from './import-backlog-tasks.use-case';

export interface ImportJiraTasksInput {
  userId: string;
  principal: AccessPrincipal;
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
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      input.projectId,
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
      epicKey: string | null;
    } | null> = [];
    let created = 0;
    let updated = 0;
    // 完全空行は skipped に計上しない（取込対象でないため別管理）。
    let emptyRows = 0;

    // ===== パス1: upsert（sourceKey で冪等）=====
    for (let i = 0; i < dataRows.length; i++) {
      const rowNo = i + 1;
      const fields = dataRows[i];
      if (fields.every((f) => f.trim() === '')) {
        emptyRows++;
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
          // 更新時は CSV に列があり値が取れたフィールドだけを props に含める。
          // 列なし/空セルは undefined のまま（Task.update の undefined=無変更）にして、
          // 既定値や NULL で既存値を破壊しない（再取込でのデータ破壊防止）。
          existing.update(buildUpdateProps(fields, col, title));
          await this.taskRepository.save(existing);
          taskId = existing.id;
          updated++;
        } else {
          // 新規作成は既定値ありで全フィールドを構築（列なしは既定値/NULL）。
          const id = this.taskRepository.generateId();
          const task = Task.create(
            {
              projectId: input.projectId,
              sourceKey,
              ...buildCreateProps(fields, col, title),
            },
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
        const epicKey = cell(fields, col.epicKey).trim();
        processed.push({
          rowNo,
          taskId,
          parentKey: parentKey || null,
          epicKey: epicKey || null,
        });
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

    // ===== パス3: Epic Link キー解決（親系統とは別の自己FK epicId）=====
    for (const entry of processed) {
      if (!entry || !entry.epicKey) continue;
      const epicId = keyToTaskId.get(entry.epicKey);
      if (!epicId || epicId === entry.taskId) continue;
      if (duplicateKeys.has(entry.epicKey)) {
        errors.push({
          row: entry.rowNo,
          message: `Epic キー「${entry.epicKey}」が重複しており紐付け先が一意でないため Epic なしにしました`,
        });
        continue;
      }
      try {
        const task = await this.taskRepository.findById(entry.taskId);
        if (!task) continue;
        task.update({ epicId });
        await this.taskRepository.save(task);
      } catch (e) {
        errors.push({
          row: entry.rowNo,
          message: `Epic の紐付けに失敗: ${(e as Error)?.message ?? String(e)}`,
        });
      }
    }

    const processedCount = processed.filter((c) => c !== null).length;
    // 空行は取込対象外なので skipped から除外する（件名空などの「スキップ」とは区別）。
    const skipped = dataRows.length - processedCount - emptyRows;
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
  issueType?: number;
  epicKey?: number;
  storyPoints?: number;
  sprint?: number;
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
    key: find('Issue key', 'Issue Key', 'Key', 'キー', '課題キー'),
    description: find('Description', '説明'),
    status: find('Status', '状態'),
    priority: find('Priority', '優先度'),
    issueType: find('Issue Type', 'IssueType', '課題種別', '課題タイプ', '種別'),
    epicKey: find('Epic Link', 'エピック', '親Epic', 'Custom field (Epic Link)'),
    storyPoints: find(
      'Story Points',
      'Story point estimate',
      'ストーリーポイント',
      '見積もりポイント',
      'Custom field (Story Points)',
    ),
    sprint: find('Sprint', 'スプリント', 'Custom field (Sprint)'),
    assigneeName: find('Assignee', '担当者'),
    dueDate: find('Due date', 'Due Date', '期限'),
    estimatedHours: find(
      'Original Estimate',
      'Σ Original Estimate',
      'Original estimate',
    ),
    actualHours: find('Time Spent', 'Σ Time Spent', 'Time spent'),
    parentKey: find(
      'Parent',
      'Parent key',
      'Parent id',
      'Parent Issue',
      '親',
      '親課題',
    ),
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
/** CSV に当該列が存在し、かつセルに非空の値があるか（更新時に含めるか判定）。 */
function hasValue(fields: string[], index: number | undefined): boolean {
  if (index === undefined) return false;
  return (fields[index] ?? '').trim() !== '';
}

/**
 * 新規作成用 props。既定値ありで全フィールドを構築する（列なし/空セルは既定値/NULL）。
 * status/priority は共有写像 mapStatus/mapPriority('JIRA')（日英・正規表現対応）を使う。
 */
function buildCreateProps(
  fields: string[],
  col: JiraColumnIndex,
  title: string,
) {
  return {
    title,
    description: optional(cell(fields, col.description)),
    status: mapStatus(cell(fields, col.status), 'JIRA'),
    priority: mapPriority(cell(fields, col.priority), 'JIRA'),
    issueType: mapJiraIssueType(cell(fields, col.issueType)),
    storyPoints: parseStoryPoints(cell(fields, col.storyPoints)),
    sprint: optional(cell(fields, col.sprint)),
    assigneeName: optional(cell(fields, col.assigneeName)),
    dueDate: parseDate(cell(fields, col.dueDate)),
    estimatedHours: secondsToHours(cell(fields, col.estimatedHours)),
    actualHours: secondsToHours(cell(fields, col.actualHours)),
  };
}

/**
 * 更新用 props。CSV に列があり値が取れたフィールドだけを含める（再取込でのデータ破壊防止）。
 *   - status/priority/issueType: 列非存在/空セルでは既定値を流し込まない（除外＝無変更）。
 *   - その他: 列があり非空のときだけ含める。列なし/空セルは undefined（=Task.update で無変更）。
 * title は必須なので常に含める。
 */
function buildUpdateProps(
  fields: string[],
  col: JiraColumnIndex,
  title: string,
) {
  const props: {
    title: string;
    description?: string | null;
    status?: TaskStatus;
    priority?: TaskPriority;
    issueType?: TaskIssueType;
    storyPoints?: number | null;
    sprint?: string | null;
    assigneeName?: string | null;
    dueDate?: Date | null;
    estimatedHours?: number | null;
    actualHours?: number | null;
  } = { title };

  // enum 系は「列があり値がある」ときだけ写像して上書き（既定値での破壊を避ける）。
  if (hasValue(fields, col.status))
    props.status = mapStatus(cell(fields, col.status), 'JIRA');
  if (hasValue(fields, col.priority))
    props.priority = mapPriority(cell(fields, col.priority), 'JIRA');
  if (hasValue(fields, col.issueType))
    props.issueType = mapJiraIssueType(cell(fields, col.issueType));

  // 値フィールドも「列があり値がある」ときだけ含める（空セルは無変更）。
  if (hasValue(fields, col.description))
    props.description = optional(cell(fields, col.description));
  if (hasValue(fields, col.storyPoints))
    props.storyPoints = parseStoryPoints(cell(fields, col.storyPoints));
  if (hasValue(fields, col.sprint))
    props.sprint = optional(cell(fields, col.sprint));
  if (hasValue(fields, col.assigneeName))
    props.assigneeName = optional(cell(fields, col.assigneeName));
  if (hasValue(fields, col.dueDate))
    props.dueDate = parseDate(cell(fields, col.dueDate));
  if (hasValue(fields, col.estimatedHours))
    props.estimatedHours = secondsToHours(cell(fields, col.estimatedHours));
  if (hasValue(fields, col.actualHours))
    props.actualHours = secondsToHours(cell(fields, col.actualHours));

  return props;
}
/**
 * Jira の課題種別（Epic/Story/Sub-task/Bug/Task 等）→ TaskIssueType。
 * 未知値は安全な既定 'TASK' にフォールバックする。
 */
export function mapJiraIssueType(raw: string): TaskIssueType {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'TASK';
  if (/(epic|エピック)/.test(v)) return 'EPIC';
  // Sub-task は Story / Task より先に判定（"sub-task" の "task" 誤判定を避ける）。
  if (/(sub[-\s]?task|subtask|子課題|サブタスク)/.test(v)) return 'SUBTASK';
  if (/(story|ストーリー)/.test(v)) return 'STORY';
  if (/(bug|バグ|不具合|障害)/.test(v)) return 'BUG';
  if (/(task|タスク)/.test(v)) return 'TASK';
  return 'TASK';
}
// ===== 値パーサ =====
/** ストーリーポイント文字列を数値に変換。空や不正値・負値は null。 */
function parseStoryPoints(raw: string): number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const num = Number(v);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}
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
