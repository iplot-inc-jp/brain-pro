import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { signUserApiJwt, verifyUserApiJwt } from './user-api-jwt';

/**
 * ユーザー追従APIトークンの発行・検証・失効。
 * 発行: user_api_tokens 行を作り、その id を jti に埋めて署名。平文JWTは返り値のみ（DBに保存しない）。
 * 検証: 署名+期限（user-api-jwt）→ jti行の生存 → sub一致。権限は載せない（ガードが userId だけ載せ、
 *       ProjectAccessService がユーザーの会員RBACで毎回解決＝権限追従）。
 */
@Injectable()
export class UserApiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async mint(
    userId: string,
    name: string,
    nowMs: number,
  ): Promise<{ id: string; name: string; token: string; createdAt: Date }> {
    const record = await this.prisma.userApiToken.create({ data: { userId, name } });
    const token = signUserApiJwt({ userId, jti: record.id }, Math.floor(nowMs / 1000));
    return { id: record.id, name: record.name, token, createdAt: record.createdAt };
  }

  async resolve(token: string, nowMs: number): Promise<{ userId: string } | null> {
    const claims = verifyUserApiJwt(token, Math.floor(nowMs / 1000));
    if (!claims) return null;
    const row = await this.prisma.userApiToken.findUnique({ where: { id: claims.jti } });
    if (!row || row.revokedAt) return null;
    if (row.userId !== claims.sub) return null;
    // 監査。失敗しても認証は継続。
    void this.prisma.userApiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(nowMs) } })
      .catch(() => undefined);
    return { userId: row.userId };
  }

  async list(userId: string) {
    return this.prisma.userApiToken.findMany({
      where: { userId, revokedAt: null },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(userId: string, id: string): Promise<void> {
    await this.prisma.userApiToken.updateMany({
      where: { id, userId },
      data: { revokedAt: new Date() },
    });
  }
}
