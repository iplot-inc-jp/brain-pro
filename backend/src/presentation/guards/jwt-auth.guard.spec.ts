import { JwtAuthGuard } from './jwt-auth.guard';

// peekKind が 'user-api' を返すトークンを resolve に流し、request.user に scopeOrgId が載るか検証。
describe('JwtAuthGuard user-api branch', () => {
  const makeCtx = (headers: Record<string, string>, req: any = {}) => {
    req.headers = headers;
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  };

  it('user-api JWT を解決したら request.user に id と scopeOrgId を載せる', async () => {
    const reflector = { getAllAndOverride: () => false } as any;
    const prisma = { apiKey: { findUnique: jest.fn() } } as any;
    const apiKeyService = { hash: jest.fn() } as any;
    // peekKind は 'user-api.' 形式のダミーJWTで判定される。resolve をスタブして scopeOrgId を返す。
    const userApiTokenService = {
      resolve: jest.fn().mockResolvedValue({ userId: 'member-1', scopeOrgId: 'org-9' }),
    } as any;
    const tokenService = { verifyToken: jest.fn() } as any;
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApiTokenService);

    // peekKind が 'user-api' を返すよう、payload に kind:"user-api" を持つ本物構造のトークンを作る。
    const payload = Buffer.from(JSON.stringify({ kind: 'user-api', sub: 'member-1', jti: 'tok-1' })).toString('base64url');
    const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${payload}.sig`;
    const req: any = {};
    const ok = await guard.canActivate(makeCtx({ authorization: `Bearer ${jwt}` }, req));

    expect(ok).toBe(true);
    expect(req.user).toEqual({ id: 'member-1', scopeOrgId: 'org-9' });
  });
});
