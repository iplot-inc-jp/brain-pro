import { ForbiddenError } from '../../domain';
import { IproWebhookSourceController } from './ipro-webhook-source.controller';

const SOURCE = {
  id: 'source-1',
  projectId: 'project-1',
  name: 'ipro production',
  tokenHash: 'token-hash-must-stay-private',
  secretEnc: 'encrypted-secret-must-stay-private',
  active: true,
  lastReceivedAt: null,
  lastError: null,
  createdAt: new Date('2026-07-17T00:00:00.000Z'),
  updatedAt: new Date('2026-07-17T00:00:00.000Z'),
};

function makeDependencies() {
  const prisma = {
    iproWebhookSource: {
      findMany: jest.fn().mockResolvedValue([SOURCE]),
      findFirst: jest.fn().mockResolvedValue(SOURCE),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...SOURCE, ...data }),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...SOURCE, ...data }),
      ),
      delete: jest.fn().mockResolvedValue(SOURCE),
    },
  } as any;
  const crypto = {
    encrypt: jest.fn((value: string) => `enc(${value})`),
  } as any;
  const projectAccess = {
    assertPrincipalAccess: jest.fn().mockResolvedValue(undefined),
    isProjectAdmin: jest.fn().mockResolvedValue(true),
  } as any;
  return { prisma, crypto, projectAccess };
}

const admin = { id: 'user-1', email: 'admin@example.test' } as any;

describe('IproWebhookSourceController', () => {
  const originalBaseUrl = process.env.PUBLIC_BASE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_BASE_URL = 'https://brain.example.test/';
  });

  afterAll(() => {
    if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = originalBaseUrl;
  });

  it('rejects a project viewer/member without organization admin rights', async () => {
    const d = makeDependencies();
    d.projectAccess.isProjectAdmin.mockResolvedValue(false);
    const controller = new IproWebhookSourceController(
      d.prisma,
      d.crypto,
      d.projectAccess,
    );

    await expect(controller.list(admin, 'project-1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('allows a project/organization admin to list without exposing stored secrets', async () => {
    const d = makeDependencies();
    const controller = new IproWebhookSourceController(
      d.prisma,
      d.crypto,
      d.projectAccess,
    );

    const result = await controller.list(admin, 'project-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'source-1',
        name: 'ipro production',
        active: true,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(SOURCE.tokenHash);
    expect(JSON.stringify(result)).not.toContain(SOURCE.secretEnc);
  });

  it('creates a source and returns its token, URL, and HMAC secret exactly once', async () => {
    const d = makeDependencies();
    const controller = new IproWebhookSourceController(
      d.prisma,
      d.crypto,
      d.projectAccess,
    );

    const created = await controller.create(admin, 'project-1', {
      name: 'ipro production',
    });

    expect(created.sourceToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(created.secret).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(created.receiverUrl).toBe(
      `https://brain.example.test/api/webhooks/ipro-db/${created.sourceToken}`,
    );
    expect(d.crypto.encrypt).toHaveBeenCalledWith(created.secret);
    const saved = d.prisma.iproWebhookSource.create.mock.calls[0][0].data;
    expect(saved.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.secretEnc).toBe(`enc(${created.secret})`);
    expect(JSON.stringify(saved)).not.toContain(created.sourceToken);

    const listed = await controller.list(admin, 'project-1');
    expect(JSON.stringify(listed)).not.toContain(created.sourceToken);
    expect(JSON.stringify(listed)).not.toContain(created.secret);
  });

  it('can pause, delete, and rotate only a source belonging to the route project', async () => {
    const d = makeDependencies();
    const controller = new IproWebhookSourceController(
      d.prisma,
      d.crypto,
      d.projectAccess,
    );

    const paused = await controller.update(admin, 'project-1', 'source-1', {
      active: false,
    });
    expect(paused.active).toBe(false);

    const rotated = await controller.rotate(admin, 'project-1', 'source-1');
    expect(rotated.sourceToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(rotated.secret).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(rotated.receiverUrl).toContain(rotated.sourceToken);

    await expect(
      controller.delete(admin, 'project-1', 'source-1'),
    ).resolves.toEqual({ success: true });
    expect(d.prisma.iproWebhookSource.findFirst).toHaveBeenCalledWith({
      where: { id: 'source-1', projectId: 'project-1' },
    });
  });

  it('rejects a scoped token attempting to manage another project/company', async () => {
    const d = makeDependencies();
    d.projectAccess.assertPrincipalAccess.mockRejectedValue(
      new ForbiddenError('You do not have access to this project'),
    );
    const controller = new IproWebhookSourceController(
      d.prisma,
      d.crypto,
      d.projectAccess,
    );
    const scopedToken = {
      id: 'token-user',
      email: 'token@example.test',
      apiKeyRole: 'COMPANY_ADMIN',
      organizationId: 'organization-a',
    } as any;

    await expect(
      controller.create(scopedToken, 'project-in-organization-b', {
        name: 'cross-company',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.projectAccess.assertPrincipalAccess).toHaveBeenCalledWith(
      scopedToken,
      'project-in-organization-b',
      'edit',
    );
    expect(d.prisma.iproWebhookSource.create).not.toHaveBeenCalled();
  });
});
