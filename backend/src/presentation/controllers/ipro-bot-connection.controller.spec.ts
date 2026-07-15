import { IproBotConnectionController } from './ipro-bot-connection.controller';
import { ForbiddenError } from '../../domain';

function makePrisma(opts: { role?: string | null; isSuperAdmin?: boolean; conn?: any }) {
  return {
    user: {
      findUnique: jest.fn(async () => ({ isSuperAdmin: opts.isSuperAdmin ?? false })),
    },
    organizationMember: {
      findUnique: jest.fn(async () => (opts.role ? { role: opts.role } : null)),
    },
    iproBotConnection: {
      findUnique: jest.fn(async () => opts.conn ?? null),
      upsert: jest.fn(async (args: any) => ({
        baseUrl: args.create.baseUrl,
        apiTokenEnc: args.create.apiTokenEnc,
        enabled: args.create.enabled,
        strict: args.create.strict,
      })),
    },
  } as any;
}

const crypto = {
  encrypt: jest.fn((v: string) => `enc(${v})`),
  decrypt: jest.fn((v: string) => `dec(${v})`),
} as any;

const user = { id: 'u1', email: 'a@b.c' } as any;

describe('IproBotConnectionController', () => {
  beforeEach(() => jest.clearAllMocks());

  it('管理者でなければ ForbiddenError', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'MEMBER' }), crypto);
    await expect(c.get(user, 'org1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('COMPANY_ADMIN の sk_ キーが別会社を指すと ForbiddenError（会員照会せず即拒否）', async () => {
    const prisma = makePrisma({ role: 'ADMIN', isSuperAdmin: true });
    const c = new IproBotConnectionController(prisma, crypto);
    const keyUser = { id: 'k1', email: 'k@b.c', apiKeyRole: 'COMPANY_ADMIN', organizationId: 'orgX' } as any;
    await expect(c.get(keyUser, 'org1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('GENERAL_USER の sk_ キーは会社管理不可（自社を指していても拒否）', async () => {
    const prisma = makePrisma({ role: 'ADMIN', isSuperAdmin: true });
    const c = new IproBotConnectionController(prisma, crypto);
    const keyUser = { id: 'k1', email: 'k@b.c', apiKeyRole: 'GENERAL_USER', organizationId: 'org1' } as any;
    await expect(c.get(keyUser, 'org1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('COMPANY_ADMIN の sk_ キーが自社を指すなら通す', async () => {
    const prisma = makePrisma({ role: 'ADMIN' });
    const c = new IproBotConnectionController(prisma, crypto);
    const keyUser = { id: 'k1', email: 'k@b.c', apiKeyRole: 'COMPANY_ADMIN', organizationId: 'org1' } as any;
    expect(await c.get(keyUser, 'org1')).toEqual({ configured: false });
  });

  it('GET: 未設定なら configured=false', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'ADMIN' }), crypto);
    expect(await c.get(user, 'org1')).toEqual({ configured: false });
  });

  it('GET: 設定済みは秘密を返さず hasApiToken のみ', async () => {
    const c = new IproBotConnectionController(
      makePrisma({
        role: 'OWNER',
        conn: { baseUrl: 'https://b', apiTokenEnc: 'ENC', enabled: true, strict: false },
      }),
      crypto,
    );
    const res = await c.get(user, 'org1');
    expect(res).toEqual({
      configured: true,
      baseUrl: 'https://b',
      enabled: true,
      strict: false,
      hasApiToken: true,
    });
    expect(JSON.stringify(res)).not.toContain('ENC');
  });

  it('PUT: 新規作成には baseUrl と apiToken が必須', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'ADMIN' }), crypto);
    await expect(c.upsert(user, 'org1', { enabled: true } as any)).rejects.toThrow();
  });

  it('PUT: baseUrl 変更時は apiToken 再入力が必須（保存済みトークンの流出防止）', async () => {
    const prisma = makePrisma({
      role: 'ADMIN',
      conn: { baseUrl: 'https://old', apiTokenEnc: 'ENC', enabled: true, strict: false },
    });
    const c = new IproBotConnectionController(prisma, crypto);
    await expect(c.upsert(user, 'org1', { baseUrl: 'https://evil' } as any)).rejects.toThrow(
      'apiToken の再入力が必要',
    );
    // 同じURLなら再入力不要（enabled 等のトグルは通る）
    await expect(
      c.upsert(user, 'org1', { baseUrl: 'https://old', enabled: false } as any),
    ).resolves.toBeDefined();
  });

  it('PUT: apiToken は暗号化して保存する', async () => {
    const prisma = makePrisma({ role: 'ADMIN' });
    const c = new IproBotConnectionController(prisma, crypto);
    await c.upsert(user, 'org1', { baseUrl: 'https://b', apiToken: 'aig_x' } as any);
    expect(crypto.encrypt).toHaveBeenCalledWith('aig_x');
    const args = prisma.iproBotConnection.upsert.mock.calls[0][0];
    expect(args.create.apiTokenEnc).toBe('enc(aig_x)');
  });

  it('test: /api/ai/health を復号トークンで叩き ok を返す', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, companyId: 'co1' }),
    }));
    (global as any).fetch = fetchMock;
    const c = new IproBotConnectionController(
      makePrisma({
        role: 'ADMIN',
        conn: { baseUrl: 'https://b/', apiTokenEnc: 'ENC', enabled: true, strict: false },
      }),
      crypto,
    );
    const res = await c.test(user, 'org1');
    expect(res).toEqual({ ok: true, detail: 'companyId=co1' });
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://b/api/ai/health');
    expect(init.headers.Authorization).toBe('Bearer dec(ENC)');
  });

  it('test: 未設定は ok=false', async () => {
    const c = new IproBotConnectionController(makePrisma({ role: 'ADMIN' }), crypto);
    expect(await c.test(user, 'org1')).toEqual({ ok: false, error: '未設定です' });
  });
});
