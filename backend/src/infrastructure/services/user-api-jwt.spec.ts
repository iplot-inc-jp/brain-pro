import { signUserApiJwt, verifyUserApiJwt, peekKind } from './user-api-jwt';

describe('user-api-jwt', () => {
  const NOW = 1_700_000_000; // 秒
  beforeAll(() => { process.env.BRAINPRO_API_JWT_SECRET = 'test-secret'; });

  it('sign→verify で claims が復元できる', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    const c = verifyUserApiJwt(t, NOW);
    expect(c).toMatchObject({ sub: 'u1', jti: 'j1', kind: 'user-api' });
    expect(c!.exp).toBeGreaterThan(NOW);
  });

  it('peekKind は署名前に kind を覗ける', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    expect(peekKind(t)).toBe('user-api');
    expect(peekKind('not.a.jwt')).toBe(null);
  });

  it('署名改竄は null', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    const tampered = t.slice(0, -2) + (t.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyUserApiJwt(tampered, NOW)).toBe(null);
  });

  it('別の鍵で署名されたトークンは null', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW);
    process.env.BRAINPRO_API_JWT_SECRET = 'other-secret';
    expect(verifyUserApiJwt(t, NOW)).toBe(null);
    process.env.BRAINPRO_API_JWT_SECRET = 'test-secret';
  });

  it('期限切れは null', () => {
    const t = signUserApiJwt({ userId: 'u1', jti: 'j1' }, NOW, 10);
    expect(verifyUserApiJwt(t, NOW + 11)).toBe(null);
  });

  it('kind が user-api でなければ null（他JWTの誤受理防止）', () => {
    // header.payload.sig を手組みして kind を変える
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', jti: 'j1', kind: 'login', iat: NOW, exp: NOW + 100 })).toString('base64url');
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', 'test-secret').update(`${header}.${payload}`).digest('base64url');
    expect(verifyUserApiJwt(`${header}.${payload}.${sig}`, NOW)).toBe(null);
  });
});
