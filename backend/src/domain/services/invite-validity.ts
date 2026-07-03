/**
 * 招待リンクが無効になる理由。
 */
export type InviteInvalidReason = 'notfound' | 'revoked' | 'expired' | 'maxed';

export interface InviteValidity {
  valid: boolean;
  reason: InviteInvalidReason | null;
}

export interface InviteValidityFields {
  revokedAt: Date | null;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
}

/**
 * 招待の有効性を判定する純粋関数。
 * 優先順位: notfound > revoked > expired > maxed。
 */
export function evaluateInviteValidity(
  invite: InviteValidityFields | null,
  now: Date,
): InviteValidity {
  if (!invite) return { valid: false, reason: 'notfound' };
  if (invite.revokedAt) return { valid: false, reason: 'revoked' };
  if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: 'expired' };
  }
  if (invite.maxUses != null && invite.useCount >= invite.maxUses) {
    return { valid: false, reason: 'maxed' };
  }
  return { valid: true, reason: null };
}
