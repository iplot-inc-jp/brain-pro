import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/services/crypto.service';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';

/** enable/regenerate/getUrl の戻り値（秘密入り URL を返す。disable/無効時は url=null）。 */
export interface WebhookUrlResult {
  /** 秘密トークンを埋め込んだ受信用 URL。webhook 無効なら null。 */
  url: string | null;
}

/**
 * トラッカー接続ごとの Webhook 秘密トークンの管理（admin 限定）。
 *
 *   - enable    … ランダム秘密を生成→暗号化して webhookSecretEnc に保存→秘密入り URL を返す。
 *   - regenerate… 新しい秘密に置換（旧 URL は無効化）→新 URL を返す。
 *   - disable   … webhookSecretEnc=null（webhook 無効化）。
 *   - getUrl    … 現在の秘密を復号して URL を再表示（無効なら null）。
 *
 * 秘密は AES-256-GCM で暗号化して DB に保存し、平文は URL（管理者のみ取得）にのみ現れる。
 * URL 形: `${PUBLIC_BASE_URL}/api/trackers/webhook/<provider小文字>/<connectionId>/<秘密>`。
 * PUBLIC_BASE_URL は /api を含まない想定（qstash.service と同じ運用）。
 */
@Injectable()
export class ManageTrackerWebhookUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** 秘密を新規発行し webhook を有効化、秘密入り URL を返す。 */
  async enable(connectionId: string, userId: string): Promise<WebhookUrlResult> {
    const conn = await this.requireAdminConnection(connectionId, userId);
    const secret = this.generateSecret();
    await this.prisma.issueTrackerConnection.update({
      where: { id: conn.id },
      data: { webhookSecretEnc: this.crypto.encrypt(secret) },
    });
    return { url: this.buildUrl(conn.provider, conn.id, secret) };
  }

  /** 秘密を新しいものに置換し、新 URL を返す（旧 URL は無効化される）。 */
  async regenerate(
    connectionId: string,
    userId: string,
  ): Promise<WebhookUrlResult> {
    // enable と同じく新しい秘密で上書きするだけ（旧秘密は破棄）。
    return this.enable(connectionId, userId);
  }

  /** webhook を無効化（秘密を破棄）。 */
  async disable(
    connectionId: string,
    userId: string,
  ): Promise<WebhookUrlResult> {
    const conn = await this.requireAdminConnection(connectionId, userId);
    await this.prisma.issueTrackerConnection.update({
      where: { id: conn.id },
      data: { webhookSecretEnc: null },
    });
    return { url: null };
  }

  /** 現在の秘密を復号して URL を返す（無効なら null）。管理画面の再表示用。 */
  async getUrl(
    connectionId: string,
    userId: string,
  ): Promise<WebhookUrlResult> {
    const conn = await this.requireAdminConnection(connectionId, userId);
    if (!conn.webhookSecretEnc) return { url: null };
    const secret = this.crypto.decrypt(conn.webhookSecretEnc);
    return { url: this.buildUrl(conn.provider, conn.id, secret) };
  }

  // ========== Private ==========

  /** 接続を取得し、プロジェクト管理者でなければ Forbidden。 */
  private async requireAdminConnection(connectionId: string, userId: string) {
    const conn = await this.prisma.issueTrackerConnection.findUnique({
      where: { id: connectionId },
    });
    if (!conn) {
      throw new NotFoundException('トラッカー接続が見つかりません');
    }
    const isAdmin = await this.projectAccess.isProjectAdmin(
      conn.projectId,
      userId,
    );
    if (!isAdmin) {
      throw new ForbiddenException(
        'Webhook の管理にはプロジェクト管理者権限が必要です',
      );
    }
    return conn;
  }

  /** URL 安全な秘密（base64url, 推測困難な 24 バイト）。 */
  private generateSecret(): string {
    return randomBytes(24).toString('base64url');
  }

  /** 受信用 URL を組み立てる（provider は小文字でパスに埋め込む）。 */
  private buildUrl(provider: string, connectionId: string, secret: string): string {
    const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
    return `${base}/api/trackers/webhook/${provider.toLowerCase()}/${connectionId}/${secret}`;
  }
}
