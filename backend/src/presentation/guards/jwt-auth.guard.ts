import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService, TOKEN_SERVICE } from '../../domain';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ApiKeyService } from '../../infrastructure/services/api-key.service';
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';
import { peekKind } from '../../infrastructure/services/user-api-jwt';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 認証ガード。2方式を受け付ける:
 *   1. JWT (Authorization: Bearer <jwt>) — Webアプリ用
 *   2. APIキー (x-api-key: sk_... または Authorization: Bearer sk_...) — 公開API / MCP用
 * APIキーは作成ユーザーの権限で動作する（request.user に key.userId を設定）。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly apiKeyService: ApiKeyService,
    private readonly userApiTokenService: UserApiTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() デコレータがあればスキップ
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();

    // 1. APIキー認証（x-api-key / Bearer sk_...）
    const apiKey = ApiKeyService.extract(request.headers ?? {});
    if (apiKey) {
      const record = await this.prisma.apiKey.findUnique({
        where: { keyHash: this.apiKeyService.hash(apiKey) },
        include: { projects: { select: { projectId: true } } },
      });
      if (!record || record.revokedAt) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }
      // GENERAL_USER キーの紐付けプロジェクト（複数可）。結合テーブルが空なら旧来の単一 projectId に
      // フォールバック（＝移行前に発行された単一プロジェクトキーもそのまま動く・後方互換）。
      const projectIds =
        record.projects.length > 0
          ? record.projects.map((p) => p.projectId)
          : record.projectId
            ? [record.projectId]
            : [];
      // サービスアカウントのスコープを request.user に載せる（会社・ロール・紐付けプロジェクト）。
      // 認可判定は ProjectAccessGuard がこのスコープで行う（発行ユーザーの会員権限には依存しない）。
      request.user = {
        id: record.userId,
        email: '',
        apiKeyId: record.id,
        apiKeyRole: record.role,
        organizationId: record.organizationId,
        projectId: record.projectId,
        projectIds,
      };
      // 最終利用日時を更新（失敗しても認証は継続）
      this.prisma.apiKey
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
      return true;
    }

    // 1.5 ユーザー追従APIトークン（kind:"user-api" JWT）。sk_ でない Bearer JWT のうち、
    //     payload.kind==="user-api" のものだけをここで処理する（ログインJWTは kind 無し＝素通り）。
    const authForApi = request.headers.authorization;
    const bearerForApi =
      typeof authForApi === 'string' && authForApi.startsWith('Bearer ')
        ? authForApi.substring(7)
        : null;
    if (bearerForApi && peekKind(bearerForApi) === 'user-api') {
      const resolved = await this.userApiTokenService.resolve(bearerForApi, Date.now());
      if (!resolved) {
        throw new UnauthorizedException('Invalid or revoked API token');
      }
      // apiKeyRole を付けない＝ProjectAccessService がユーザーの会員RBACで認可（権限追従）。
      // scopeOrgId があれば「発行会社にだけ効く」制約が resolveForPrincipal / assertCompanyAdmin で適用される。
      request.user = { id: resolved.userId, scopeOrgId: resolved.scopeOrgId ?? null };
      return true;
    }

    // 2. JWT認証
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid token');
    }

    const token = authHeader.substring(7);
    const payload = this.tokenService.verifyToken(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = {
      id: payload.sub,
      email: payload.email,
    };

    return true;
  }
}
