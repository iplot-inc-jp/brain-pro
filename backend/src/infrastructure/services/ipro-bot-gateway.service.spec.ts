import { IproBotGatewayService } from './ipro-bot-gateway.service';

function makePrisma(opts: { org?: string | null; conn?: any }) {
  return {
    project: {
      findUnique: jest.fn(async () =>
        opts.org === undefined ? { organizationId: 'org1' } : opts.org ? { organizationId: opts.org } : null,
      ),
    },
    iproBotConnection: {
      findUnique: jest.fn(async () => opts.conn ?? null),
    },
  } as any;
}

const crypto = { decrypt: jest.fn((v: string) => `dec(${v})`) } as any;

describe('IproBotGatewayService.resolveForProject', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.IPRO_BOT_URL;
    delete process.env.IPRO_BOT_API_TOKEN;
    jest.clearAllMocks();
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('DB接続設定(enabled)があれば復号して返す', async () => {
    const svc = new IproBotGatewayService(
      makePrisma({ conn: { baseUrl: 'https://b', apiTokenEnc: 'ENC', enabled: true, strict: true } }),
      crypto,
    );
    expect(await svc.resolveForProject('p1')).toEqual({
      baseUrl: 'https://b',
      apiToken: 'dec(ENC)',
      strict: true,
      organizationId: 'org1',
    });
  });

  it('DB接続設定が enabled=false なら env があっても null（明示OFF優先）', async () => {
    process.env.IPRO_BOT_URL = 'https://env';
    process.env.IPRO_BOT_API_TOKEN = 'aig_env';
    const svc = new IproBotGatewayService(
      makePrisma({ conn: { baseUrl: 'https://b', apiTokenEnc: 'ENC', enabled: false, strict: false } }),
      crypto,
    );
    expect(await svc.resolveForProject('p1')).toBeNull();
  });

  it('DB接続設定が無ければ env にフォールバック', async () => {
    process.env.IPRO_BOT_URL = 'https://env';
    process.env.IPRO_BOT_API_TOKEN = 'aig_env';
    const svc = new IproBotGatewayService(makePrisma({}), crypto);
    expect(await svc.resolveForProject('p1')).toEqual({
      baseUrl: 'https://env',
      apiToken: 'aig_env',
      strict: false,
      organizationId: 'org1',
    });
  });

  it('DBもenvも無ければ null', async () => {
    const svc = new IproBotGatewayService(makePrisma({}), crypto);
    expect(await svc.resolveForProject('p1')).toBeNull();
  });

  it('projectId 無しは env のみ参照', async () => {
    process.env.IPRO_BOT_URL = 'https://env';
    process.env.IPRO_BOT_API_TOKEN = 'aig_env';
    const prisma = makePrisma({});
    const svc = new IproBotGatewayService(prisma, crypto);
    expect(await svc.resolveForProject(undefined)).toEqual({
      baseUrl: 'https://env',
      apiToken: 'aig_env',
      strict: false,
      organizationId: null,
    });
    expect(prisma.project.findUnique).not.toHaveBeenCalled();
  });
});
