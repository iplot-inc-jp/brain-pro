import { createHmac, timingSafeEqual } from 'node:crypto';

// ユーザー追従APIトークン = HS256 JWT（依存なし・node crypto のみ。ipro-kun の service-account-auth と同形）。
// claims は本人性(sub)＋失効識別子(jti)＋種別(kind)＋時刻(iat/exp・秒)。org/プロジェクト権限は載せない
// （＝毎リクエスト userId の会員RBACで解決＝権限追従）。失効は DB(user_api_tokens.revokedAt) で効かせる。

const DEFAULT_TTL_SEC = 365 * 24 * 60 * 60; // 長寿命。取り消しは DB 側。

export interface UserApiClaims {
  sub: string; // brain-pro userId
  jti: string; // user_api_tokens.id
  kind: 'user-api';
  iat: number; // 秒
  exp: number; // 秒
}

function secret(): string {
  const s = process.env.BRAINPRO_API_JWT_SECRET;
  if (!s) throw new Error('BRAINPRO_API_JWT_SECRET is required');
  return s;
}

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** ガードの経路分岐用に kind だけ署名前に覗く（信用しない＝この後必ず署名検証する）。 */
export function peekKind(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.kind === 'string' ? payload.kind : null;
  } catch {
    return null;
  }
}

/** userId + jti から user-api JWT を署名。平文は呼び出し側で1回だけ返す。 */
export function signUserApiJwt(
  input: { userId: string; jti: string },
  nowSec: number,
  ttlSec: number = DEFAULT_TTL_SEC,
): string {
  const header = b64urlJson({ alg: 'HS256', typ: 'JWT' });
  const claims: UserApiClaims = {
    sub: input.userId,
    jti: input.jti,
    kind: 'user-api',
    iat: nowSec,
    exp: nowSec + ttlSec,
  };
  const payload = b64urlJson(claims);
  const signingInput = `${header}.${payload}`;
  const sig = createHmac('sha256', secret()).update(signingInput).digest('base64url');
  return `${signingInput}.${sig}`;
}

/** 署名・期限・kind を検証して claims を返す。失敗は null（fail-closed）。jti行の生存確認は呼び出し側。 */
export function verifyUserApiJwt(token: string, nowSec: number): UserApiClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const expected = createHmac('sha256', secret()).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(sig);
  const e = Buffer.from(expected);
  if (a.length !== e.length || !timingSafeEqual(a, e)) return null;

  let claims: UserApiClaims;
  try {
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256') return null;
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (claims.kind !== 'user-api') return null;
  if (typeof claims.sub !== 'string' || typeof claims.jti !== 'string') return null;
  if (typeof claims.exp !== 'number' || nowSec > claims.exp) return null;
  return claims;
}
