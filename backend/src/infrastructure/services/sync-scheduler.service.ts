import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { SyncService } from './sync.service';
import { CompanyKeyService } from './company-key.service';
import { JobService } from './job.service';

/**
 * autoSync が有効な GithubConnection を定期的に同期するスケジューラ。
 * 5分ごとに走り、各コネクションの syncIntervalMinutes を尊重して間引く。
 */
@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: SyncService,
    private readonly companyKeyService: CompanyKeyService,
    private readonly jobService: JobService,
  ) {}

  // 毎時 0,5,10,... 分に実行（秒指定の6フィールド cron）。ローカル/常駐サーバ専用。
  @Cron('0 */5 * * * *')
  async handleAutoSync(): Promise<void> {
    // Vercel Functions（serverless）ではプロセスが常駐せず @Cron は発火しない。
    // 本番は QStash の定期スケジュール → GET /api/cron/auto-sync（CronController）→ runAutoSync() で駆動する。
    if (process.env.VERCEL) {
      return;
    }
    await this.runAutoSync();
  }

  /**
   * autoSync 有効な GithubConnection と IssueTrackerConnection を、各コネクションの
   * syncIntervalMinutes を尊重して同期する本体。
   * ローカルは @Cron から、本番(Vercel)は CronController（QStash 経由）から呼ばれる。
   * @returns GitHub / トラッカーそれぞれの 検査件数 / 実同期件数 / スキップ件数
   */
  async runAutoSync(): Promise<{
    checked: number;
    synced: number;
    skipped: number;
    trackers: { checked: number; synced: number; skipped: number };
  }> {
    const connections = await this.prisma.githubConnection.findMany({
      where: { autoSync: true },
    });

    const now = Date.now();
    let synced = 0;
    let skipped = 0;
    for (const connection of connections) {
      try {
        const intervalMs = (connection.syncIntervalMinutes || 30) * 60_000;
        const due =
          !connection.lastSyncedAt ||
          now - connection.lastSyncedAt.getTime() >= intervalMs;
        if (!due) {
          skipped++;
          continue;
        }

        // 会社(Organization)キー → ユーザーキー → 環境変数。AUTO のため userId なし。
        const apiKey = await this.companyKeyService.resolveForProject(
          connection.projectId,
        );
        if (!apiKey) {
          this.logger.warn(
            `Skipping auto-sync for connection ${connection.id}: no Anthropic API key resolved.`,
          );
          skipped++;
          continue;
        }

        this.logger.log(
          `Auto-sync starting for connection ${connection.id} (${connection.repoFullName}).`,
        );
        await this.syncService.runSync(connection.id, 'AUTO', apiKey);
        synced++;
      } catch (err) {
        this.logger.error(
          `Auto-sync error for connection ${connection.id}: ${(err as Error).message}`,
        );
      }
    }

    const trackers = await this.runTrackerAutoSync(now);
    return { checked: connections.length, synced, skipped, trackers };
  }

  /**
   * autoSync 有効な IssueTrackerConnection を、syncIntervalMinutes を尊重して
   * 差分同期(TRACKER_IMPORT incremental)として enqueue する。
   *
   * GitHub 同期と違い AI キー不要（純粋な REST pull）。実処理は JobService 経由で
   * BackgroundJob に乗せ、自動リトライ＋試行記録（batch-jobs 管理画面）を再利用する。
   */
  private async runTrackerAutoSync(now: number): Promise<{
    checked: number;
    synced: number;
    skipped: number;
  }> {
    const connections = await this.prisma.issueTrackerConnection.findMany({
      where: { autoSync: true },
    });
    let synced = 0;
    let skipped = 0;
    for (const conn of connections) {
      try {
        // webhook 有効接続(webhookSecretEnc != null)は即時反映されるため、ポーリングは
        // 取りこぼし補修の日次バックストップ(最低1440分)に間引く。webhook 無効接続は従来どおり。
        const effectiveIntervalMinutes = conn.webhookSecretEnc
          ? Math.max(conn.syncIntervalMinutes || 60, 1440)
          : conn.syncIntervalMinutes || 60;
        const intervalMs = effectiveIntervalMinutes * 60_000;
        const due =
          !conn.lastSyncedAt ||
          now - conn.lastSyncedAt.getTime() >= intervalMs;
        if (!due) {
          skipped++;
          continue;
        }
        this.logger.log(
          `Tracker auto-sync enqueue for connection ${conn.id} (${conn.provider}).`,
        );
        // 差分同期を起票（秘匿情報は payload に入れず実行時に復号）。
        await this.jobService.enqueue(
          'TRACKER_IMPORT',
          { connectionId: conn.id, mode: 'incremental' },
          { projectId: conn.projectId, createdById: null },
        );
        synced++;
      } catch (err) {
        this.logger.error(
          `Tracker auto-sync error for connection ${conn.id}: ${(err as Error).message}`,
        );
      }
    }
    return { checked: connections.length, synced, skipped };
  }
}
