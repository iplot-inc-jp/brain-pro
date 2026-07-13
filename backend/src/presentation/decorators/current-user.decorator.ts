import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiKeyRole } from '@prisma/client';

/**
 * 現在のユーザー情報を取得するデコレータ
 */
export interface CurrentUserPayload {
  id: string;
  email: string;
  // 以下は APIキー（サービスアカウント）認証時のみ設定される（JwtAuthGuard が付与）。
  // JWTユーザーでは undefined。by-id ルートの authz でキーのスコープ判定に使う。
  apiKeyId?: string;
  apiKeyRole?: ApiKeyRole | null;
  organizationId?: string | null;
  projectId?: string | null;
}

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserPayload | undefined, ctx: ExecutionContext): CurrentUserPayload | CurrentUserPayload[keyof CurrentUserPayload] => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as CurrentUserPayload;

    if (data) {
      return user[data];
    }
    return user;
  },
);

