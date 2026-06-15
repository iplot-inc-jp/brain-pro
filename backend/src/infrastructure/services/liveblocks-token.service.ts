import { Injectable } from '@nestjs/common';
import { Liveblocks } from '@liveblocks/node';

export interface MintTokenParams {
  userId: string;
  userInfo: { name: string; email: string; avatarUrl: string | null; color: string };
  roomId: string;
  fullAccess: boolean;
}

/**
 * @liveblocks/node を包む薄いラッパ。秘密鍵は process.env.LIVEBLOCKS_SECRET_KEY から取得
 * （BlobStorageService と同じ env-getter 方式）。未設定なら mintToken は明示的に throw し、
 * フロント側はトークン取得失敗としてプレゼンスをグレースフルに無効化する。
 */
@Injectable()
export class LiveblocksTokenService {
  private client: Liveblocks | null = null;

  get isConfigured(): boolean {
    const s = process.env.LIVEBLOCKS_SECRET_KEY;
    return !!(s && s.trim());
  }

  private getClient(): Liveblocks {
    const secret = process.env.LIVEBLOCKS_SECRET_KEY;
    if (!secret || !secret.trim()) {
      throw new Error('LIVEBLOCKS_SECRET_KEY is not configured');
    }
    if (!this.client) {
      this.client = new Liveblocks({ secret: secret.trim() });
    }
    return this.client;
  }

  async mintToken(params: MintTokenParams): Promise<{ body: string; status: number }> {
    const liveblocks = this.getClient();
    const session = liveblocks.prepareSession(params.userId, {
      userInfo: params.userInfo,
    });
    session.allow(
      params.roomId,
      params.fullAccess ? session.FULL_ACCESS : session.READ_ACCESS,
    );
    const { body, status } = await session.authorize();
    return { body, status };
  }
}
