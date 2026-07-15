import { ApiKeyRole } from '@prisma/client';
import { ForbiddenError } from '../../../domain';
import { AccessPrincipal } from '../../../infrastructure/services/project-access.service';

/**
 * route param :organizationId（招待管理ルート）に対する主体の会社スコープ検査（越境拒否）。
 * ProjectAccessGuard は organization 系ルートを projectId 非依存として素通りさせるため、
 * ここで自前強制する（create-project の assertCreateOrgScope と同型）。
 *   - 管理者発行の会社スコープトークン（scopeOrgId）… 対象組織が一致必須。
 *   - サービスアカウントAPIキー（会社紐付けありの新スコープキー = organizationId 設定済み）…
 *       COMPANY_ADMIN は自社のみ、GENERAL_USER は招待操作不可（紐付けプロジェクトのみ操作可のキー）。
 *   - それ以外（通常ユーザー / organizationId 未設定の旧APIキー）… 素通り（従来どおり assertOrgAdmin に委ねる）。
 *
 * defense-in-depth: これを通過しても呼び出し側は assertOrgAdmin（発行ユーザーの会員権限）を続けて要求する。
 */
export function assertInviteOrgScope(
  principal: AccessPrincipal,
  organizationId: string,
): void {
  // 管理者発行トークンの会社スコープ: 対象組織が一致必須。
  if (principal.scopeOrgId && principal.scopeOrgId !== organizationId) {
    throw new ForbiddenError('このトークンはこの会社を操作できません');
  }
  // サービスアカウントAPIキー（会社紐付けありの新スコープキーのみ判定。
  // organizationId 未設定＝移行前の旧キーは発行者権限に委ねるため素通り）。
  if (principal.apiKeyRole && principal.organizationId) {
    if (principal.apiKeyRole === ApiKeyRole.COMPANY_ADMIN) {
      if (principal.organizationId !== organizationId) {
        throw new ForbiddenError('このAPIキーはこの会社を操作できません');
      }
    } else {
      // GENERAL_USER: 紐付けプロジェクトのみ操作可のキー。招待の管理は不可。
      throw new ForbiddenError('このAPIキーには招待を操作する権限がありません');
    }
  }
}
