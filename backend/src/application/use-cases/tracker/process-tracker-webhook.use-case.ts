import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ITaskRepository, TASK_REPOSITORY } from '../../../domain';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/services/crypto.service';
import { TrackerImportService } from '../../../infrastructure/services/trackers/tracker-import.service';

/** 公開受信エンドポイントから渡る入力（URL パス + 生 body）。 */
export interface ProcessTrackerWebhookInput {
  /** URL パスの provider（小文字。"jira" / "backlog"）。検証は接続レコードの provider を正とする。 */
  provider: string;
  /** 対象の接続レコード ID（URL パス）。 */
  connectionId: string;
  /** URL パスに埋め込まれた秘密トークン（timing-safe に照合）。 */
  token: string;
  /** Jira/Backlog から POST される webhook ペイロード（形は provider 依存）。 */
  body: unknown;
}

/** ペイロードから解釈したイベント（種別 + 対象課題キー）。 */
interface ParsedEvent {
  kind: 'upsert' | 'delete' | 'ignore';
  /** 課題の外部キー（例 "ABC-1" / "IPLOT-9"）。ignore のときは null。 */
  externalKey: string | null;
}

/**
 * トラッカー webhook の受信処理（インバウンド同期）。
 *
 * 流れ:
 *   1. connectionId で接続を取得。無い / webhook 無効（webhookSecretEnc=null）なら 401。
 *   2. URL の :token を、復号した秘密と timing-safe 比較（長さ不一致は不一致）。誤りは 401。
 *   3. ペイロードを provider 別に解釈し、イベント種別と課題キーを取り出す。
 *   4. created/updated → TrackerImportService.importSingleByKey で当該 1 課題を upsert（sourceKey 冪等）。
 *   5. deleted → 対応 Task を sourceKey='PROVIDER:KEY' で引き、CLOSED にして save（物理削除しない）。無ければ無視。
 *
 * token 検証だけは 401 を投げる（受信の正当性ゲート）。それ以外（未知イベント / import 中の
 * 上流エラー等）は受信を素早く完了させるためログのみで握り、例外は伝播しない。
 */
@Injectable()
export class ProcessTrackerWebhookUseCase {
  private readonly logger = new Logger(ProcessTrackerWebhookUseCase.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trackerImport: TrackerImportService,
    @Inject(TASK_REPOSITORY)
    private readonly taskRepository: ITaskRepository,
    private readonly crypto: CryptoService,
  ) {}

  async execute(input: ProcessTrackerWebhookInput): Promise<void> {
    const conn = await this.prisma.issueTrackerConnection.findUnique({
      where: { id: input.connectionId },
    });
    // 接続が無い / webhook 無効は、情報を漏らさず一律 401。
    if (!conn || !conn.webhookSecretEnc) {
      throw new UnauthorizedException();
    }

    // ===== token の timing-safe 照合 =====
    const expected = this.crypto.decrypt(conn.webhookSecretEnc);
    if (!this.tokenMatches(input.token, expected)) {
      throw new UnauthorizedException();
    }

    // ===== ここから先は検証済み。失敗してもログのみで握る（受信は 2xx を返す） =====
    try {
      const event = this.parseEvent(conn.provider, conn.projectKey, input.body);
      if (event.kind === 'ignore' || !event.externalKey) {
        return;
      }
      if (event.kind === 'upsert') {
        const result = await this.trackerImport.importSingleByKey(
          conn.id,
          event.externalKey,
        );
        if (result === 'not_found') {
          this.logger.warn(
            `webhook upsert: 外部に課題が見つかりませんでした conn=${conn.id} key=${event.externalKey}`,
          );
        }
      } else {
        await this.closeTask(conn.projectId, conn.provider, event.externalKey);
      }
    } catch (err) {
      // 重複/未知/上流エラーは無害化（受信側に例外を伝播させない）。
      this.logger.error(
        `webhook 処理に失敗しました conn=${input.connectionId} provider=${input.provider}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ========== Private ==========

  /** 平文トークンを timing-safe に比較（長さ不一致は即 false）。 */
  private tokenMatches(got: string, expected: string): boolean {
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * provider 別にペイロードからイベント種別と課題キーを取り出す。
   *
   *   - Jira: body.webhookEvent（jira:issue_created|updated|deleted）+ body.issue.key。
   *   - Backlog: body.type（1=追加,2=更新,3=削除）+ "<projectKey>-<content.key_id>"。
   *     projectKey は body.project.projectKey を優先し、無ければ接続の projectKey を使う。
   *
   * 解釈できない / 対象外イベントは kind='ignore'。
   */
  private parseEvent(
    provider: string,
    connProjectKey: string | null,
    body: unknown,
  ): ParsedEvent {
    const b = (body ?? {}) as Record<string, unknown>;

    if (provider === 'JIRA') {
      const webhookEvent =
        typeof b.webhookEvent === 'string' ? b.webhookEvent : '';
      const issue = (b.issue ?? {}) as Record<string, unknown>;
      const key = typeof issue.key === 'string' ? issue.key : null;
      if (webhookEvent === 'jira:issue_deleted') {
        return { kind: 'delete', externalKey: key };
      }
      if (
        webhookEvent === 'jira:issue_created' ||
        webhookEvent === 'jira:issue_updated'
      ) {
        return { kind: 'upsert', externalKey: key };
      }
      return { kind: 'ignore', externalKey: null };
    }

    if (provider === 'BACKLOG') {
      const type = typeof b.type === 'number' ? b.type : Number(b.type);
      const project = (b.project ?? {}) as Record<string, unknown>;
      const content = (b.content ?? {}) as Record<string, unknown>;
      const projectKey =
        (typeof project.projectKey === 'string'
          ? project.projectKey
          : null) ?? connProjectKey;
      const keyId = content.key_id;
      const key =
        projectKey != null && keyId != null
          ? `${projectKey}-${keyId}`
          : null;
      // Backlog webhook type: 1=課題の追加, 2=課題の更新, ... 一覧は割愛。削除イベントは課題削除。
      if (type === 1 || type === 2) {
        return { kind: 'upsert', externalKey: key };
      }
      // Backlog の「課題削除」通知（type 値はスペース設定依存のため content から判断する余地もあるが、
      // 公式 type=3 を削除として扱う。未知 type は ignore。）
      if (type === 3) {
        return { kind: 'delete', externalKey: key };
      }
      return { kind: 'ignore', externalKey: null };
    }

    return { kind: 'ignore', externalKey: null };
  }

  /**
   * 削除イベント: 対応 Task を sourceKey='PROVIDER:KEY' で引き、CLOSED にして save。
   * 物理削除はしない（履歴/リンクを残す）。該当 Task が無ければ無視。
   */
  private async closeTask(
    projectId: string,
    provider: string,
    externalKey: string,
  ): Promise<void> {
    const sourceKey = `${provider}:${externalKey}`;
    const task = await this.taskRepository.findByProjectIdAndSourceKey(
      projectId,
      sourceKey,
    );
    if (!task) return;
    task.changeStatus('CLOSED');
    await this.taskRepository.save(task);
  }
}
