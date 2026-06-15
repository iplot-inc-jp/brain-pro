import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CryptoService } from '../../../infrastructure/services/crypto.service';
import { ManageTrackerWebhookUseCase } from './manage-tracker-webhook.use-case';

/**
 * prisma.issueTrackerConnection の最小モック（findUnique / update）と
 * ProjectAccessService.isProjectAdmin の最小モックを返す。
 */
function makeDeps(opts?: {
  connection?: Record<string, unknown> | null;
  isAdmin?: boolean;
}) {
  const connection =
    opts?.connection === undefined
      ? {
          id: 'conn1',
          projectId: 'p1',
          provider: 'JIRA',
          webhookSecretEnc: null as string | null,
        }
      : opts.connection;
  const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const prisma = {
    issueTrackerConnection: {
      findUnique: jest.fn(async () => connection),
      update: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        updates.push(args);
        return { ...(connection as object), ...args.data };
      }),
    },
  };
  const projectAccess = {
    isProjectAdmin: jest.fn(async () => opts?.isAdmin ?? true),
  };
  const crypto = new CryptoService();
  return { prisma, projectAccess, crypto, updates, connection };
}

function makeUseCase(d: ReturnType<typeof makeDeps>) {
  return new ManageTrackerWebhookUseCase(
    d.prisma as any,
    d.crypto,
    d.projectAccess as any,
  );
}

describe('ManageTrackerWebhookUseCase', () => {
  const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL;
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = 'https://example.test';
  });
  afterAll(() => {
    if (ORIGINAL_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL;
  });

  it('enable: 秘密を生成して webhookSecretEnc をセットし、秘密入り URL を返す', async () => {
    const d = makeDeps();
    const uc = makeUseCase(d);

    const result = await uc.enable('conn1', 'u1');

    // webhookSecretEnc が更新された
    expect(d.prisma.issueTrackerConnection.update).toHaveBeenCalledTimes(1);
    const data = d.updates[0].data;
    expect(typeof data.webhookSecretEnc).toBe('string');
    expect((data.webhookSecretEnc as string).length).toBeGreaterThan(0);

    // 保存値は平文ではなく暗号文（復号すると URL に含まれる秘密と一致）
    const secret = d.crypto.decrypt(data.webhookSecretEnc as string);
    expect(result.url).toBe(
      `https://example.test/api/trackers/webhook/jira/conn1/${secret}`,
    );
    // URL には平文の秘密が含まれるが、保存値（暗号文）そのものは含まれない
    expect(result.url).not.toContain(data.webhookSecretEnc as string);
  });

  it('enable: 非adminは ForbiddenException で弾く（更新しない）', async () => {
    const d = makeDeps({ isAdmin: false });
    const uc = makeUseCase(d);

    await expect(uc.enable('conn1', 'u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(d.prisma.issueTrackerConnection.update).not.toHaveBeenCalled();
  });

  it('enable: 接続が無ければ NotFoundException', async () => {
    const d = makeDeps({ connection: null });
    const uc = makeUseCase(d);
    await expect(uc.enable('missing', 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('regenerate: 新しい秘密に置換し、新 URL を返す（旧と異なる）', async () => {
    const oldSecret = 'OLD_SECRET';
    const d = makeDeps({
      connection: {
        id: 'conn1',
        projectId: 'p1',
        provider: 'BACKLOG',
        webhookSecretEnc: new CryptoService().encrypt(oldSecret),
      },
    });
    const uc = makeUseCase(d);

    const result = await uc.regenerate('conn1', 'u1');
    const data = d.updates[0].data;
    const newSecret = d.crypto.decrypt(data.webhookSecretEnc as string);

    expect(newSecret).not.toBe(oldSecret);
    expect(result.url).toBe(
      `https://example.test/api/trackers/webhook/backlog/conn1/${newSecret}`,
    );
  });

  it('disable: webhookSecretEnc を null にし、url=null を返す', async () => {
    const d = makeDeps({
      connection: {
        id: 'conn1',
        projectId: 'p1',
        provider: 'JIRA',
        webhookSecretEnc: new CryptoService().encrypt('S'),
      },
    });
    const uc = makeUseCase(d);

    const result = await uc.disable('conn1', 'u1');
    expect(d.updates[0].data.webhookSecretEnc).toBeNull();
    expect(result.url).toBeNull();
  });

  it('getUrl: 有効なら復号して URL を返し、無効なら null', async () => {
    const secret = 'STORED_SECRET';
    const enabled = makeDeps({
      connection: {
        id: 'conn1',
        projectId: 'p1',
        provider: 'JIRA',
        webhookSecretEnc: new CryptoService().encrypt(secret),
      },
    });
    const ucEnabled = makeUseCase(enabled);
    const r1 = await ucEnabled.getUrl('conn1', 'u1');
    expect(r1.url).toBe(
      `https://example.test/api/trackers/webhook/jira/conn1/${secret}`,
    );

    const disabled = makeDeps(); // webhookSecretEnc=null
    const ucDisabled = makeUseCase(disabled);
    const r2 = await ucDisabled.getUrl('conn1', 'u1');
    expect(r2.url).toBeNull();
  });

  it('getUrl: 非adminは ForbiddenException', async () => {
    const d = makeDeps({ isAdmin: false });
    const uc = makeUseCase(d);
    await expect(uc.getUrl('conn1', 'u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
