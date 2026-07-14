import { UserApiTokenService } from './user-api-token.service';

describe('UserApiTokenService', () => {
  const NOW = 1_700_000_000_000; // ms
  beforeAll(() => { process.env.BRAINPRO_API_JWT_SECRET = 'test-secret'; });

  const makePrisma = (row: any) => ({
    userApiToken: {
      create: jest.fn().mockResolvedValue({ id: 'tok-1', name: 'ipro', createdAt: new Date(NOW) }),
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([{ id: 'tok-1', name: 'ipro', lastUsedAt: null, createdAt: new Date(NOW) }]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }) as any;

  it('mint: 行を作り、その id を jti にした JWT を返す', async () => {
    const prisma = makePrisma(null);
    const svc = new UserApiTokenService(prisma);
    const out = await svc.mint('user-1', 'ipro', NOW);
    expect(prisma.userApiToken.create).toHaveBeenCalledWith({ data: { userId: 'user-1', name: 'ipro' } });
    expect(out.token.split('.')).toHaveLength(3);
    // 返ったトークンを resolve すると userId が取れる（同じ行が生きている前提）
    const prisma2 = makePrisma({ id: 'tok-1', userId: 'user-1', revokedAt: null });
    const svc2 = new UserApiTokenService(prisma2);
    expect(await svc2.resolve(out.token, NOW)).toEqual({ userId: 'user-1' });
  });

  it('resolve: jti行が revoked なら null', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('user-1', 'ipro', NOW);
    const prismaRevoked = makePrisma({ id: 'tok-1', userId: 'user-1', revokedAt: new Date(NOW) });
    expect(await new UserApiTokenService(prismaRevoked).resolve(token, NOW)).toBe(null);
  });

  it('resolve: jti行が無ければ null', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('user-1', 'ipro', NOW);
    const prismaGone = makePrisma(null);
    expect(await new UserApiTokenService(prismaGone).resolve(token, NOW)).toBe(null);
  });

  it('resolve: sub と行の userId が食い違えば null', async () => {
    const prisma = makePrisma(null);
    const { token } = await new UserApiTokenService(prisma).mint('user-1', 'ipro', NOW);
    const prismaMismatch = makePrisma({ id: 'tok-1', userId: 'someone-else', revokedAt: null });
    expect(await new UserApiTokenService(prismaMismatch).resolve(token, NOW)).toBe(null);
  });

  it('revoke: userId でスコープして updateMany（他人のは消せない）', async () => {
    const prisma = makePrisma(null);
    await new UserApiTokenService(prisma).revoke('user-1', 'tok-1');
    expect(prisma.userApiToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1', userId: 'user-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
