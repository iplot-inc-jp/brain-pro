export type NormalizedRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * 入力文字列を MemberRole に正規化する。既定は MEMBER。
 */
export function normalizeMemberRole(role?: string): NormalizedRole {
  const r = (role ?? '').trim();
  if (r === '会社管理者') return 'OWNER';
  if (r === '一般ユーザー') return 'MEMBER';
  if (r === 'OWNER' || r === 'ADMIN' || r === 'MEMBER' || r === 'VIEWER') return r;
  return 'MEMBER';
}
