import { OrganizationInviteRecord, evaluateInviteValidity } from '../../../domain';

export interface InviteView {
  id: string;
  token: string;
  role: string;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revoked: boolean;
  valid: boolean;
}

/**
 * 招待レコードを API レスポンス用の View に変換する。
 */
export function toInviteView(record: OrganizationInviteRecord, now: Date): InviteView {
  return {
    id: record.id,
    token: record.token,
    role: record.role,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    maxUses: record.maxUses,
    useCount: record.useCount,
    revoked: Boolean(record.revokedAt),
    valid: evaluateInviteValidity(record, now).valid,
  };
}
