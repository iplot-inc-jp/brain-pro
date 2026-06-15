import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskIssueType,
  TaskComment,
  ITaskRepository,
  TASK_REPOSITORY,
  ITaskCommentRepository,
  TASK_COMMENT_REPOSITORY,
} from '../../../domain';
import { PrismaService } from '../../persistence/prisma/prisma.service';
import { CryptoService } from '../crypto.service';
import { NormalizedComment, NormalizedIssue } from './types';
import { backlogGetIssue, backlogListIssues } from './backlog-api';
import { jiraGetIssue, jiraListIssues } from './jira-api';

/** TRACKER_IMPORT ジョブの結果サマリ（result に記録 / フロントが表示）。 */
export interface TrackerImportResult {
  provider: string;
  mode: 'full' | 'incremental';
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  commentsCreated: number;
  errors: string[];
}

/** 進捗コールバック（0–100）。BackgroundJob.progress に反映する。 */
type ProgressFn = (progress: number) => Promise<void>;

/**
 * 外部トラッカー（Backlog / Jira）→ Task への移行/同期の本体。
 *
 * JobService.dispatch の `TRACKER_IMPORT` 分岐から呼ばれる（手動 import エンドポイント経由でのみ起票）。
 * 冪等性: Task は (projectId, sourceKey) で upsert（externalKey 由来の sourceKey）。再 import でも
 * 重複作成せず更新する。親子は 2 パス（外部キー→TaskId マップ）で解決し、循環/自己参照はガードする。
 * コメントは (authorName, body) の重複を避けて追記する（コメント側の外部キーは持たない簡易冪等）。
 *
 * 秘匿情報: credential は payload に入れず、接続レコードから復号して使う。
 */
@Injectable()
export class TrackerImportService {
  private readonly logger = new Logger(TrackerImportService.name);

  constructor(
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    @Inject(TASK_COMMENT_REPOSITORY)
    private readonly taskCommentRepository: ITaskCommentRepository,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * 移行/同期を実行する。
   * @param connectionId 接続レコード ID
   * @param mode "full"=全件 / "incremental"=lastSyncedAt 以降の差分
   * @param onProgress 進捗更新コールバック（任意）
   */
  async run(
    connectionId: string,
    mode: 'full' | 'incremental',
    onProgress?: ProgressFn,
  ): Promise<TrackerImportResult> {
    const conn = await this.prisma.issueTrackerConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) {
      throw new Error(`トラッカー接続が見つかりません: ${connectionId}`);
    }

    const credential = this.crypto.decrypt(conn.credentialEnc);
    const updatedSince =
      mode === 'incremental' && conn.lastSyncedAt
        ? conn.lastSyncedAt.toISOString()
        : null;

    await onProgress?.(15);

    // ===== 1. プロバイダから課題を取得（正規化済み） =====
    let issues: NormalizedIssue[];
    if (conn.provider === 'BACKLOG') {
      issues = await backlogListIssues(conn.host, credential, conn.projectKey, {
        updatedSince,
        includeComments: true,
      });
    } else if (conn.provider === 'JIRA') {
      if (!conn.email) {
        throw new Error('Jira 接続には認証メールアドレス(email)が必要です');
      }
      issues = await jiraListIssues(
        conn.host,
        conn.email,
        credential,
        conn.projectKey,
        { updatedSince, includeComments: true },
      );
    } else {
      throw new Error(`未対応のプロバイダです: ${conn.provider}`);
    }

    await onProgress?.(40);

    const result: TrackerImportResult = {
      provider: conn.provider,
      mode,
      fetched: issues.length,
      created: 0,
      updated: 0,
      skipped: 0,
      commentsCreated: 0,
      errors: [],
    };

    // ===== 2. パス1: Task の upsert（sourceKey で冪等） =====
    // externalKey（プロバイダ内一意） → 作成/既存の TaskId。
    const keyToTaskId = new Map<string, string>();
    // 親/Epic 解決パス用に各課題の (taskId, parentExternalKey, epicExternalKey) を保持。
    const linkPlan: Array<{
      externalKey: string;
      taskId: string;
      parentExternalKey: string | null;
      epicExternalKey: string | null;
    }> = [];

    const total = issues.length || 1;
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i];
      try {
        // 1 件の NormalizedIssue を Task に upsert（sourceKey 冪等。親/Epic は後段パス）。
        const { taskId, created, commentsCreated } = await this.upsertIssue(
          conn.projectId,
          conn.provider,
          issue,
        );
        if (created) result.created++;
        else result.updated++;
        result.commentsCreated += commentsCreated;

        keyToTaskId.set(issue.externalKey, taskId);
        linkPlan.push({
          externalKey: issue.externalKey,
          taskId,
          parentExternalKey: issue.parentExternalKey,
          epicExternalKey: issue.epicExternalKey ?? null,
        });
      } catch (e) {
        result.skipped++;
        result.errors.push(
          `課題 ${issue.externalKey} の取込に失敗: ${(e as Error)?.message ?? String(e)}`,
        );
      }

      // 課題取込は重い部分なので 40→85% に割り当てて進捗更新（10件ごと）。
      if (onProgress && i % 10 === 0) {
        await onProgress(40 + Math.floor((i / total) * 45));
      }
    }

    await onProgress?.(85);

    // ===== 3. パス2: 親子（parentExternalKey → parentId）を解決 =====
    // 既存タスクの親リンク（更新時に外部側で変わった分）も上書きする。
    // 循環/自己参照は applied マップ上の祖先探索で弾く。
    const appliedParent = new Map<string, string>();
    // 既存リンクをシードに入れる（取込外のタスクとの循環も検知できるよう全件は引かないが、
    // 取込対象内の整合は十分担保できる）。
    for (const plan of linkPlan) {
      const parentId = plan.parentExternalKey
        ? keyToTaskId.get(plan.parentExternalKey)
        : undefined;
      // 取込集合に親が居ない（差分取込で親が範囲外 等）/ 自己参照は親なしのまま。
      if (!parentId || parentId === plan.taskId) {
        // full モードのみ: 外部側で親が外れた（externalKey が null）場合は parentId を明示クリアする。
        // 差分モードは取込範囲外の親（externalKey 解決不能）を誤って外す恐れがあるため対象外。
        if (mode === 'full' && !plan.parentExternalKey) {
          try {
            const task = await this.taskRepository.findById(plan.taskId);
            if (task && task.parentId !== null) {
              task.reparent(null);
              await this.taskRepository.save(task);
            }
          } catch (e) {
            result.errors.push(
              `課題 ${plan.externalKey} の親解除に失敗: ${(e as Error)?.message ?? String(e)}`,
            );
          }
        }
        continue;
      }
      if (wouldFormCycle(appliedParent, plan.taskId, parentId)) {
        result.errors.push(
          `課題 ${plan.externalKey} の親 ${plan.parentExternalKey} は循環になるため親なしにしました`,
        );
        continue;
      }
      try {
        const task = await this.taskRepository.findById(plan.taskId);
        if (!task) continue;
        if (task.parentId !== parentId) {
          task.reparent(parentId);
          await this.taskRepository.save(task);
        }
        appliedParent.set(plan.taskId, parentId);
      } catch (e) {
        result.errors.push(
          `課題 ${plan.externalKey} の親紐付けに失敗: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }

    // ===== 3b. Epic 紐付け（epicExternalKey → epicId）を解決 =====
    // parentId（subtask の親）とは別系統の自己FK。externalKey→taskId マップで解決する。
    // 取込集合に Epic が居ない（差分取込で範囲外 等）/ 自己参照は epic なしのまま（安全側 null）。
    for (const plan of linkPlan) {
      const epicId = plan.epicExternalKey
        ? keyToTaskId.get(plan.epicExternalKey)
        : undefined;
      if (!epicId || epicId === plan.taskId) {
        // full モードのみ: 外部側で Epic Link が外れた場合は epicId を明示クリアする。
        // 差分モードは Epic が取込範囲外のことがあり誤クリアの恐れがあるため対象外。
        if (mode === 'full' && !plan.epicExternalKey) {
          try {
            const task = await this.taskRepository.findById(plan.taskId);
            if (task && task.epicId !== null) {
              task.update({ epicId: null });
              await this.taskRepository.save(task);
            }
          } catch (e) {
            result.errors.push(
              `課題 ${plan.externalKey} の Epic 解除に失敗: ${(e as Error)?.message ?? String(e)}`,
            );
          }
        }
        continue;
      }
      try {
        const task = await this.taskRepository.findById(plan.taskId);
        if (!task) continue;
        if (task.epicId !== epicId) {
          task.update({ epicId });
          await this.taskRepository.save(task);
        }
      } catch (e) {
        result.errors.push(
          `課題 ${plan.externalKey} の Epic 紐付けに失敗: ${(e as Error)?.message ?? String(e)}`,
        );
      }
    }

    await onProgress?.(95);

    // ===== 4. lastSyncedAt を更新 =====
    await this.prisma.issueTrackerConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: new Date(), status: 'active' },
    });

    return result;
  }

  /** "BACKLOG:IPLOT-12" 形式の由来キー。 */
  private buildSourceKey(provider: string, externalKey: string): string {
    return `${provider}:${externalKey}`;
  }

  /**
   * 1 件の NormalizedIssue を Task に upsert する（sourceKey で冪等）。
   * 既存があれば update、無ければ create。親/Epic リンクはここでは触らず後段パス（run）/
   * importSingleByKey 側で解決する。コメントは重複回避で追記する。
   * @returns 作成/更新の別と、追記したコメント件数（taskId は親/Epic 解決に使う）。
   */
  private async upsertIssue(
    projectId: string,
    provider: string,
    issue: NormalizedIssue,
  ): Promise<{ taskId: string; created: boolean; commentsCreated: number }> {
    const sourceKey = this.buildSourceKey(provider, issue.externalKey);
    const existing = await this.taskRepository.findByProjectIdAndSourceKey(
      projectId,
      sourceKey,
    );

    const status = mapStatus(issue.status, provider);
    const priority = mapPriority(issue.priority, provider);
    const issueType = mapIssueType(issue.issueType);

    let taskId: string;
    let created: boolean;
    if (existing) {
      // 既存タスクを更新（親/Epic は後段パスで設定するためここでは触らない）。
      existing.update({
        title: issue.title,
        description: issue.description,
        status,
        priority,
        issueType,
        storyPoints: issue.storyPoints ?? null,
        sprint: issue.sprint ?? null,
        assigneeName: issue.assigneeName,
        startDate: parseDate(issue.startDate),
        dueDate: parseDate(issue.dueDate),
        estimatedHours: issue.estimatedHours,
        actualHours: issue.actualHours,
      });
      await this.taskRepository.save(existing);
      taskId = existing.id;
      created = false;
    } else {
      taskId = this.taskRepository.generateId();
      const task = Task.create(
        {
          projectId,
          sourceKey,
          title: issue.title,
          description: issue.description,
          status,
          priority,
          issueType,
          storyPoints: issue.storyPoints ?? null,
          sprint: issue.sprint ?? null,
          assigneeName: issue.assigneeName,
          startDate: parseDate(issue.startDate),
          dueDate: parseDate(issue.dueDate),
          estimatedHours: issue.estimatedHours,
          actualHours: issue.actualHours,
        },
        taskId,
      );
      await this.taskRepository.save(task);
      created = true;
    }

    // コメント取込（重複を避けて追記）。
    let commentsCreated = 0;
    if (issue.comments && issue.comments.length > 0) {
      commentsCreated = await this.upsertComments(taskId, issue.comments);
    }

    return { taskId, created, commentsCreated };
  }

  /**
   * webhook 受信時に「変更された 1 課題だけ」を既存の正規化 + upsert 経路で取り込む。
   * 接続の provider/host/credential/projectKey を使い、その 1 key に絞って外部 API を呼ぶ。
   * 取得できた NormalizedIssue を connection.projectId に upsert（sourceKey 冪等）し、
   * 親/Epic は既存 Task から sourceKey で引けたら張る（取込集合は 1 件なので新規には作らない）。
   *
   * @param connectionId 接続レコード ID
   * @param externalKey 取り込む課題の外部キー（例 "ABC-12" / "IPLOT-3"）
   * @returns 'upserted'=取り込んだ / 'not_found'=外部に該当課題が無かった
   */
  async importSingleByKey(
    connectionId: string,
    externalKey: string,
  ): Promise<'upserted' | 'not_found'> {
    const conn = await this.prisma.issueTrackerConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) {
      throw new Error(`トラッカー接続が見つかりません: ${connectionId}`);
    }

    const credential = this.crypto.decrypt(conn.credentialEnc);

    // ===== 1. その 1 key に絞って外部 API から取得（正規化済み） =====
    let issue: NormalizedIssue | null;
    if (conn.provider === 'BACKLOG') {
      issue = await backlogGetIssue(conn.host, credential, externalKey, {
        includeComments: true,
      });
    } else if (conn.provider === 'JIRA') {
      if (!conn.email) {
        throw new Error('Jira 接続には認証メールアドレス(email)が必要です');
      }
      issue = await jiraGetIssue(conn.host, conn.email, credential, externalKey, {
        includeComments: true,
      });
    } else {
      throw new Error(`未対応のプロバイダです: ${conn.provider}`);
    }

    if (!issue) return 'not_found';

    // ===== 2. upsert（sourceKey 冪等。既存あれば update、無ければ create） =====
    const { taskId } = await this.upsertIssue(
      conn.projectId,
      conn.provider,
      issue,
    );

    // ===== 3. 親/Epic を既存 Task から sourceKey で解決（単一なので新規には作らない） =====
    // lastSyncedAt は更新しない（webhook の単発取込であり、差分ポーリングの取りこぼし補修
    // 範囲を狭めないため。最終同期時刻は run() のフル/差分同期が担う）。
    await this.relinkSingle(conn.projectId, conn.provider, taskId, issue);

    return 'upserted';
  }

  /**
   * 単一 import 時の親/Epic 解決。取込集合が 1 件なので、親/Epic は既存 Task を
   * sourceKey で引けた場合のみ張る（無ければ親/Epic なしのまま＝安全側）。
   * full import の親解除ロジックとは異なり、webhook は差分的なので明示クリアはしない。
   */
  private async relinkSingle(
    projectId: string,
    provider: string,
    taskId: string,
    issue: NormalizedIssue,
  ): Promise<void> {
    const resolve = async (key: string | null | undefined) => {
      if (!key) return null;
      const t = await this.taskRepository.findByProjectIdAndSourceKey(
        projectId,
        this.buildSourceKey(provider, key),
      );
      return t && t.id !== taskId ? t.id : null;
    };

    const parentId = await resolve(issue.parentExternalKey);
    const epicId = await resolve(issue.epicExternalKey);
    if (parentId === null && epicId === null) return;

    const task = await this.taskRepository.findById(taskId);
    if (!task) return;
    let changed = false;
    if (parentId !== null && task.parentId !== parentId) {
      task.reparent(parentId);
      changed = true;
    }
    if (epicId !== null && task.epicId !== epicId) {
      task.update({ epicId });
      changed = true;
    }
    if (changed) await this.taskRepository.save(task);
  }

  /**
   * コメントを取込（重複回避）。既存コメントの (authorName, body) 集合に無いものだけ追記する。
   * @returns 追記したコメント件数
   */
  private async upsertComments(
    taskId: string,
    comments: NormalizedComment[],
  ): Promise<number> {
    const existing = await this.taskCommentRepository.findByTaskId(taskId);
    const seen = new Set(
      existing.map((c) => `${c.authorName ?? ''} ${c.body}`),
    );
    let added = 0;
    for (const c of comments) {
      const body = (c.body ?? '').trim();
      if (!body) continue;
      const key = `${c.authorName ?? ''} ${body}`;
      if (seen.has(key)) continue;
      try {
        const id = this.taskCommentRepository.generateId();
        const comment = TaskComment.create(
          { taskId, authorName: c.authorName, body },
          id,
        );
        await this.taskCommentRepository.save(comment);
        seen.add(key);
        added++;
      } catch {
        // 1 コメントの失敗は他を止めない（本文が長すぎる等）。
      }
    }
    return added;
  }
}

// ========== enum 写像 ==========

/**
 * 状態の原文 → TaskStatus。Backlog（日本語）/ Jira（英語カテゴリ）双方を許容し、
 * 未知値は安全な既定 'OPEN' にフォールバックする。
 */
export function mapStatus(
  raw: string | null | undefined,
  _provider: string,
): TaskStatus {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'OPEN';
  // 完了系
  if (
    /(完了|クローズ|done|closed|resolved|完了済|処理済)/.test(v) &&
    !/未/.test(v)
  ) {
    if (/(処理済|resolved)/.test(v)) return 'RESOLVED';
    return 'CLOSED';
  }
  // 進行系
  if (/(処理中|対応中|in progress|inprogress|doing|進行)/.test(v)) {
    return 'IN_PROGRESS';
  }
  // 未対応系
  if (/(未対応|未着手|open|to ?do|todo|backlog|new)/.test(v)) {
    return 'OPEN';
  }
  return 'OPEN';
}

/**
 * 優先度の原文 → TaskPriority。Backlog（高/中/低）/ Jira（Highest..Lowest）双方を許容し、
 * 未知値は 'MEDIUM' にフォールバックする。
 */
export function mapPriority(
  raw: string | null | undefined,
  _provider: string,
): TaskPriority {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'MEDIUM';
  if (/(高|highest|high|urgent|critical|blocker)/.test(v)) return 'HIGH';
  if (/(低|lowest|low|minor|trivial)/.test(v)) return 'LOW';
  if (/(中|medium|normal|major)/.test(v)) return 'MEDIUM';
  return 'MEDIUM';
}

/**
 * 課題種別の原文 → TaskIssueType。
 * Jira（Epic/Story/Sub-task/Bug/Task）/ Backlog（タスク/バグ/子課題 等）双方を許容し、
 * 未知値は安全な既定 'TASK' にフォールバックする。
 */
export function mapIssueType(
  raw: string | null | undefined,
): TaskIssueType {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'TASK';
  // Epic
  if (/(epic|エピック)/.test(v)) return 'EPIC';
  // Sub-task（"sub-task" / "subtask" / Backlog の「子課題」「サブタスク」）。Story より先に判定。
  if (/(sub[-\s]?task|subtask|子課題|サブタスク)/.test(v)) return 'SUBTASK';
  // Story
  if (/(story|ストーリー)/.test(v)) return 'STORY';
  // Bug
  if (/(bug|バグ|不具合|障害)/.test(v)) return 'BUG';
  // Task（"task" / Backlog の「タスク」）
  if (/(task|タスク)/.test(v)) return 'TASK';
  return 'TASK';
}

/** 日付文字列 → Date（不正/空は null）。'YYYY/MM/DD' も許容。 */
function parseDate(raw: string | null | undefined): Date | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const d = new Date(v.replace(/\//g, '-'));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * 確定済みリンク(child→parent)上で childId に parentId を設定すると循環になるか。
 * parentId から祖先方向に辿り childId に到達すれば循環。訪問済みガードで無限ループ防止。
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
