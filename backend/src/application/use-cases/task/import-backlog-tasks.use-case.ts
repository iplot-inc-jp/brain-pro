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

export interface ImportBacklogTasksInput {
  userId: string;
  principal: AccessPrincipal;
  projectId: string;
  /** Backlog 課題 CSV のテキスト全体（UTF-8。frontend で SJIS→UTF-8 デコード済みを受ける）。 */
  csv: string;
}

export interface ImportBacklogTasksRowError {
  /** 1始まりのデータ行番号（ヘッダ行を除いた行）。 */
  row: number;
  message: string;
}

export interface ImportBacklogTasksOutput {
  created: number;
  skipped: number;
  errors: ImportBacklogTasksRowError[];
}

/**
 * 1リクエストで取り込めるデータ行数の上限。
 * 取込はトランザクション境界が無く1行ずつ逐次 DB 往復するため、上限を設けて
 * 部分取込・単一リクエストの長時間化（プロキシ/サーバのタイムアウト）を防ぐ。
 */
const MAX_IMPORT_ROWS = 2000;

/**
 * Backlog（nulab）の課題エクスポート CSV を Task に取り込むユースケース。
 *
 * - CSV はヘッダ行（日本語）から列インデックスを動的に特定する（列順非依存）。
 * - 状態/優先度の日本語値は対応表で enum に写像し、未知値は安全な既定にフォールバックする。
 * - 親課題はキー（例: PROJ-12）で参照されるため 2 パスで解決する:
 *     1) 全行を Task として作成し「キー → 新 TaskId」マップを作る
 *     2) 親課題キーがある行は parentId を設定して更新する（自己/循環/未知キーは無視）
 */
@Injectable()
export class ImportBacklogTasksUseCase {
  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: ImportBacklogTasksInput,
  ): Promise<ImportBacklogTasksOutput> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 取り込みは書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      input.projectId,
      'edit',
    );

    const errors: ImportBacklogTasksRowError[] = [];

    // ===== CSV パース =====
    const rows = parseCsv(input.csv);
    if (rows.length === 0) {
      return { created: 0, skipped: 0, errors: [] };
    }

    const header = rows[0];
    const col = buildColumnIndex(header);
    if (col.title === undefined) {
      return {
        created: 0,
        skipped: 0,
        errors: [
          {
            row: 0,
            message:
              'CSVヘッダに「件名」列が見つかりません（必須）。Backlog の課題エクスポート CSV を貼り付けてください。',
          },
        ],
      };
    }

    const dataRows = rows.slice(1);

    // 取込は1行ずつ逐次 DB 往復するため、行数に上限を設ける。
    // 上限超過は何も作成せずエラーで返す（部分取込・長時間化・タイムアウトの防止）。
    if (dataRows.length > MAX_IMPORT_ROWS) {
      return {
        created: 0,
        skipped: 0,
        errors: [
          {
            row: 0,
            message: `取込可能な行数の上限（${MAX_IMPORT_ROWS}行）を超えています（${dataRows.length}行）。CSVを分割して取り込んでください。`,
          },
        ],
      };
    }

    // ===== パス1: 全行を Task 作成し、キー→新 TaskId を記録 =====
    /** Backlog の課題キー（例: PROJ-12）→ 作成された新 Task ID */
    const keyToTaskId = new Map<string, string>();
    /** 重複が検出された課題キー（親解決対象から除外する）。 */
    const duplicateKeys = new Set<string>();
    /** 各データ行の作成結果（親/Epic 解決パスで使う）。スキップ行は null。 */
    const created: Array<{
      rowNo: number;
      taskId: string;
      parentKey: string | null;
      epicKey: string | null;
    } | null> = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowNo = i + 1; // 1始まり（ヘッダを除くデータ行番号）
      const fields = dataRows[i];

      // 完全な空行（全セル空）はスキップ（エラーにしない）
      if (fields.every((f) => f.trim() === '')) {
        created.push(null);
        continue;
      }

      const title = cell(fields, col.title).trim();
      if (!title) {
        errors.push({ row: rowNo, message: '件名（title）が空のためスキップしました' });
        created.push(null);
        continue;
      }

      try {
        const id = this.taskRepository.generateId();
        const task = Task.create(
          {
            projectId: input.projectId,
            title,
            description: optional(cell(fields, col.description)),
            status: mapStatus(cell(fields, col.status)),
            priority: mapPriority(cell(fields, col.priority)),
            issueType: mapIssueType(cell(fields, col.issueType)),
            storyPoints: parseStoryPoints(cell(fields, col.storyPoints)),
            sprint: optional(cell(fields, col.sprint)),
            assigneeName: optional(cell(fields, col.assigneeName)),
            startDate: parseDate(cell(fields, col.startDate)),
            dueDate: parseDate(cell(fields, col.dueDate)),
            estimatedHours: parseHours(cell(fields, col.estimatedHours)),
            actualHours: parseHours(cell(fields, col.actualHours)),
            category: optional(cell(fields, col.category)),
            milestone: optional(cell(fields, col.milestone)),
          },
          id,
        );
        await this.taskRepository.save(task);

        const key = cell(fields, col.key).trim();
        if (key) {
          // Backlog の課題キーは本来一意。重複（複数プロジェクトの連結貼付・
          // 編集ミス・別名ヘッダの二重取得 等）を検出し、親解決の誤紐付け
          // （後勝ち上書き）を防ぐ。最初の出現を採用し、以降は親解決の対象外とする。
          if (keyToTaskId.has(key)) {
            errors.push({
              row: rowNo,
              message: `課題キー「${key}」が重複しています。この行は親課題キーの解決対象から除外しました（タスク自体は作成済み）`,
            });
            duplicateKeys.add(key);
          } else {
            keyToTaskId.set(key, id);
          }
        }
        const parentKey = cell(fields, col.parentKey).trim();
        const epicKey = cell(fields, col.epicKey).trim();
        created.push({
          rowNo,
          taskId: id,
          parentKey: parentKey || null,
          epicKey: epicKey || null,
        });
      } catch (e) {
        errors.push({
          row: rowNo,
          message: (e as Error)?.message ?? String(e),
        });
        created.push(null);
      }
    }

    // ===== パス2: 親課題キーを解決して parentId を設定 =====
    //
    // 循環防止: parentId グラフはコードベース全体で「循環なし」を前提とする
    // （UpdateTaskUseCase.wouldCreateCycle / rollupAncestorDates 等）。取込経路だけが
    // この不変条件を破らないよう、確定済みの親リンク（childTaskId -> parentTaskId）の
    // 上で祖先を辿り、循環を作るリンクは適用せずエラー行として記録する。
    // 直接自己参照だけでなく推移的循環（A→B, B→A）も弾く。
    const appliedParent = new Map<string, string>(); // childTaskId -> parentTaskId（確定分）
    for (const entry of created) {
      if (!entry || !entry.parentKey) continue;
      const parentId = keyToTaskId.get(entry.parentKey);
      // 未知キー / 重複キー（曖昧）/ 自己参照は無視（親なしのまま）
      if (!parentId || parentId === entry.taskId) continue;
      if (duplicateKeys.has(entry.parentKey)) {
        errors.push({
          row: entry.rowNo,
          message: `親課題キー「${entry.parentKey}」が重複しており紐付け先が一意に定まらないため、親なしにしました`,
        });
        continue;
      }

      // 確定済みリンク上で parentId の祖先を辿り、entry.taskId に到達するなら循環。
      if (wouldFormCycle(appliedParent, entry.taskId, parentId)) {
        errors.push({
          row: entry.rowNo,
          message: `親課題「${entry.parentKey}」を設定すると循環参照になるため、親なしにしました`,
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
          message: `親課題の紐付けに失敗しました: ${(e as Error)?.message ?? String(e)}`,
        });
      }
    }

    // ===== パス3: Epic Link キーを解決して epicId を設定 =====
    // 親課題（parentId）とは別系統の自己FK。未知キー/重複キー/自己参照は安全側で無視。
    for (const entry of created) {
      if (!entry || !entry.epicKey) continue;
      const epicId = keyToTaskId.get(entry.epicKey);
      if (!epicId || epicId === entry.taskId) continue;
      if (duplicateKeys.has(entry.epicKey)) {
        errors.push({
          row: entry.rowNo,
          message: `Epic キー「${entry.epicKey}」が重複しており紐付け先が一意に定まらないため、Epic なしにしました`,
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
          message: `Epic の紐付けに失敗しました: ${(e as Error)?.message ?? String(e)}`,
        });
      }
    }

    const createdCount = created.filter((c) => c !== null).length;
    const skippedCount = dataRows.length - createdCount;
    return { created: createdCount, skipped: skippedCount, errors };
  }
}

/**
 * 確定済みの親リンク（childTaskId -> parentTaskId）の上で、
 * childId に parentId を親として設定すると循環になるかを判定する。
 *
 * parentId から祖先方向（appliedParent を辿る）に進み、childId に到達すれば循環。
 * 直接自己参照（childId === parentId）も true を返す。
 * 訪問済みガードで既存の不正循環があっても無限ループしない。
 */
export function wouldFormCycle(
  appliedParent: Map<string, string>,
  childId: string,
  parentId: string,
): boolean {
  let current: string | undefined = parentId;
  const visited = new Set<string>();
  while (current !== undefined) {
    if (current === childId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    current = appliedParent.get(current);
  }
  return false;
}

// ========== CSV パーサ ==========

/**
 * CSV テキストを行 × セルの 2 次元配列にパースする。
 * - 引用符（"）で囲まれたセル内のカンマ・改行・エスケープ（""）に対応（RFC4180 相当）。
 * - 改行は CRLF / LF / CR を許容。
 * - 先頭の BOM は除去する。
 */
export function parseCsv(input: string): string[][] {
  let text = input ?? '';
  // BOM 除去
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      // CRLF or lone CR
      pushRow();
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 末尾セル/行の確定（ファイル末尾に改行が無い場合）
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

// ========== 列マッピング ==========

interface ColumnIndex {
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
  startDate?: number;
  dueDate?: number;
  estimatedHours?: number;
  actualHours?: number;
  category?: number;
  milestone?: number;
  parentKey?: number;
}

/**
 * ヘッダ行から列名 → 列インデックスを構築する（列順に依存しない）。
 * Backlog の各列名（表記ゆれ・別名）を許容する。
 */
function buildColumnIndex(header: string[]): ColumnIndex {
  const norm = (s: string) =>
    (s ?? '').replace(/^﻿/, '').replace(/\s+/g, '').trim();

  const find = (...names: string[]): number | undefined => {
    for (let i = 0; i < header.length; i++) {
      const h = norm(header[i]);
      if (names.some((name) => h === norm(name))) return i;
    }
    return undefined;
  };

  return {
    title: find('件名', 'タイトル', 'Summary'),
    key: find('キー', 'Key', '課題キー'),
    description: find('詳細', '説明', 'Description'),
    status: find('状態', 'ステータス', 'Status'),
    priority: find('優先度', 'Priority'),
    issueType: find('種別', '種別名', '課題種別', 'Issue Type', 'IssueType'),
    epicKey: find('Epic Link', 'エピック', '親Epic', '親エピック', 'EpicLink'),
    storyPoints: find(
      'Story Points',
      'ストーリーポイント',
      '見積もりポイント',
      '見積りポイント',
      'StoryPoints',
    ),
    sprint: find('Sprint', 'スプリント'),
    assigneeName: find('担当者', '担当者名', 'Assignee'),
    startDate: find('開始日', 'Start Date', 'StartDate'),
    dueDate: find('期限日', '期限', '締切', 'Due Date', 'DueDate'),
    estimatedHours: find('予定時間', '見積時間', '予定工数', 'Estimated Hours'),
    actualHours: find('実績時間', '実績工数', 'Actual Hours'),
    category: find('カテゴリー', 'カテゴリ', 'Category'),
    milestone: find('マイルストーン', 'Milestone'),
    parentKey: find('親課題', '親課題キー', '親のキー', 'Parent Issue', 'Parent'),
  };
}

/** インデックスが未特定（undefined）または範囲外の場合は空文字を返す。 */
function cell(fields: string[], index: number | undefined): string {
  if (index === undefined) return '';
  return fields[index] ?? '';
}

/** 空（trim 後）なら null、それ以外は trim 済み文字列。 */
function optional(value: string): string | null {
  const t = (value ?? '').trim();
  return t === '' ? null : t;
}

// ========== enum 対応表 ==========

/**
 * Backlog の状態（日本語）→ TaskStatus。
 * 未知値は安全な既定 'OPEN'（未対応）にフォールバックする。
 */
export function mapStatus(raw: string): TaskStatus {
  const v = (raw ?? '').trim();
  switch (v) {
    case '未対応':
    case '未着手':
    case 'Open':
      return 'OPEN';
    case '処理中':
    case '対応中':
    case 'In Progress':
      return 'IN_PROGRESS';
    case '処理済み':
    case '処理済':
    case 'Resolved':
      return 'RESOLVED';
    case '完了':
    case 'クローズ':
    case 'Closed':
      return 'CLOSED';
    default:
      return 'OPEN';
  }
}

/**
 * Backlog の優先度（日本語）→ TaskPriority。
 * 未知値は安全な既定 'MEDIUM'（中）にフォールバックする。
 */
export function mapPriority(raw: string): TaskPriority {
  const v = (raw ?? '').trim();
  switch (v) {
    case '高':
    case 'High':
      return 'HIGH';
    case '中':
    case 'Normal':
    case 'Medium':
      return 'MEDIUM';
    case '低':
    case 'Low':
      return 'LOW';
    default:
      return 'MEDIUM';
  }
}

/**
 * 課題種別の原文 → TaskIssueType。Backlog（タスク/バグ/子課題 等）/ Jira 語彙双方を許容し、
 * 未知値は安全な既定 'TASK' にフォールバックする。
 */
export function mapIssueType(raw: string): TaskIssueType {
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

// ========== 値パーサ ==========

/**
 * 日付文字列を Date に変換。空や不正値は null。
 * Backlog は 'YYYY/MM/DD' or 'YYYY-MM-DD'（時刻付きもあり）で出力する。
 */
function parseDate(raw: string): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  // YYYY/MM/DD → YYYY-MM-DD に正規化（Date のパース安定化）
  const normalized = v.replace(/\//g, '-');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** 工数文字列を数値に変換。空や不正値は null。負値は 0 に丸めず null とする。 */
function parseHours(raw: string): number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const num = Number(v);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

/** ストーリーポイント文字列を数値に変換。空や不正値・負値は null。 */
function parseStoryPoints(raw: string): number | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const num = Number(v);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}
