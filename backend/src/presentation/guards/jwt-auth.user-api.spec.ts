import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard (user-api token 経路)', () => {
  beforeAll(() => { process.env.BRAINPRO_API_JWT_SECRET = 'test-secret'; });

  const reflector = { getAllAndOverride: () => false } as any;
  const tokenService = { verifyToken: jest.fn() } as any;
  const prisma = {} as any;
  const apiKeyService = { hash: jest.fn() } as any; // sk_ 経路には入らない

  const ctxWith = (authorization: string, req: any = {}) =>
    ({ switchToHttp: () => ({ getRequest: () => (req.headers = { authorization }, req) }), getHandler: () => ({}), getClass: () => ({}) }) as any;

  it('有効な user-api トークンなら request.user={id, scopeOrgId} を載せ、apiKeyRole は付けない', async () => {
    const userApi = { resolve: jest.fn().mockResolvedValue({ userId: 'user-1', scopeOrgId: null }) } as any;
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApi);
    // kind:"user-api" の本物の署名トークンを作る
    const { signUserApiJwt } = require('../../infrastructure/services/user-api-jwt');
    const token = signUserApiJwt({ userId: 'user-1', jti: 'tok-1' }, Math.floor(Date.now() / 1000));
    const req: any = {};
    await expect(guard.canActivate(ctxWith(`Bearer ${token}`, req))).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'user-1', scopeOrgId: null });
    expect(req.user.apiKeyRole).toBeUndefined();
  });

  it('resolve が null（失効/改竄）なら 401', async () => {
    const userApi = { resolve: jest.fn().mockResolvedValue(null) } as any;
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApi);
    const { signUserApiJwt } = require('../../infrastructure/services/user-api-jwt');
    const token = signUserApiJwt({ userId: 'user-1', jti: 'tok-1' }, Math.floor(Date.now() / 1000));
    await expect(guard.canActivate(ctxWith(`Bearer ${token}`))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('kind が無い（ログイン）JWT は user-api 経路に入らず TokenService に渡る', async () => {
    const userApi = { resolve: jest.fn() } as any;
    tokenService.verifyToken.mockReturnValue({ sub: 'u9', email: 'a@b.c' });
    const guard = new JwtAuthGuard(tokenService, reflector, prisma, apiKeyService, userApi);
    const req: any = {};
    await expect(guard.canActivate(ctxWith('Bearer login.jwt.here', req))).resolves.toBe(true);
    expect(userApi.resolve).not.toHaveBeenCalled();
    expect(req.user).toEqual({ id: 'u9', email: 'a@b.c' });
  });
});
