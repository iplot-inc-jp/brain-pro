import { UnauthorizedException } from '@nestjs/common';
import { CryptoService } from '../../../infrastructure/services/crypto.service';
import { ProcessTrackerWebhookUseCase } from './process-tracker-webhook.use-case';

/**
 * ProcessTrackerWebhookUseCase の単体検証（webhook 受信時の token 検証 / 単一 import / 削除=クローズ）。
 *
 * 依存（prisma.issueTrackerConnection / TrackerImportService / ITaskRepository / CryptoService）は
 * 最小モック。CryptoService は本物を使い、秘密の暗号化/復号の往復を実際に通す。
 */
function makeDeps(opts?: {
  connection?: Record<string, unknown> | null;
  /** webhookSecretEnc に入れる平文の秘密（暗号化して格納）。null/undefined なら webhook 無効。 */
  secret?: string | null;
  /** findByProjectIdAndSourceKey が返す Task（削除イベント時のクローズ検証用）。 */
  existingTask?: { id: string; changeStatus: jest.Mock } | null;
}) {
  const crypto = new CryptoService();
  const secret = opts?.secret;
  const baseConn = {
    id: 'conn1',
    projectId: 'p1',
    provider: 'JIRA' as string,
    projectKey: 'ABC' as string | null,
    webhookSecretEnc:
      secret == null ? null : crypto.encrypt(secret),
  };
  const connection =
    opts?.connection === undefined ? baseConn : opts.connection;

  const prisma = {
    issueTrackerConnection: {
      findUnique: jest.fn(async () => connection),
    },
  };
  const trackerImport = {
    importSingleByKey: jest.fn(async () => 'upserted' as const),
  };
  const taskRepository = {
    findByProjectIdAndSourceKey: jest.fn(
      async () => opts?.existingTask ?? null,
    ),
    save: jest.fn(async () => undefined),
  };

  return { crypto, prisma, trackerImport, taskRepository, connection };
}

function makeUseCase(d: ReturnType<typeof makeDeps>) {
  return new ProcessTrackerWebhookUseCase(
    d.prisma as any,
    d.trackerImport as any,
    d.taskRepository as any,
    d.crypto,
  );
}

/** :token に渡すべき正しい平文の秘密を、格納した暗号文から復号して得る。 */
function tokenFor(d: ReturnType<typeof makeDeps>): string {
  const conn = d.connection as { webhookSecretEnc: string };
  return d.crypto.decrypt(conn.webhookSecretEnc);
}

describe('ProcessTrackerWebhookUseCase', () => {
  it('Jira updated: 正しい token なら importSingleByKey(connectionId, issue.key) を呼ぶ', async () => {
    const d = makeDeps({ secret: 'S1' });
    const uc = makeUseCase(d);

    await uc.execute({
      provider: 'jira',
      connectionId: 'conn1',
      token: tokenFor(d),
      body: { webhookEvent: 'jira:issue_updated', issue: { key: 'ABC-1' } },
    });

    expect(d.trackerImport.importSingleByKey).toHaveBeenCalledWith(
      'conn1',
      'ABC-1',
    );
  });

  it('Jira created: importSingleByKey を呼ぶ', async () => {
    const d = makeDeps({ secret: 'S1' });
    const uc = makeUseCase(d);

    await uc.execute({
      provider: 'jira',
      connectionId: 'conn1',
      token: tokenFor(d),
      body: { webhookEvent: 'jira:issue_created', issue: { key: 'ABC-9' } },
    });

    expect(d.trackerImport.importSingleByKey).toHaveBeenCalledWith(
      'conn1',
      'ABC-9',
    );
  });

  it('Jira deleted: 対応 Task を sourceKey=JIRA:KEY で引き、CLOSED にして save する', async () => {
    const changeStatus = jest.fn();
    const d = makeDeps({
      secret: 'S1',
      existingTask: { id: 't1', changeStatus },
    });
    const uc = makeUseCase(d);

    await uc.execute({
      provider: 'jira',
      connectionId: 'conn1',
      token: tokenFor(d),
      body: { webhookEvent: 'jira:issue_deleted', issue: { key: 'ABC-1' } },
    });

    expect(d.taskRepository.findByProjectIdAndSourceKey).toHaveBeenCalledWith(
      'p1',
      'JIRA:ABC-1',
    );
    expect(changeStatus).toHaveBeenCalledWith('CLOSED');
    expect(d.taskRepository.save).toHaveBeenCalled();
    // 物理削除はしない & import もしない
    expect(d.trackerImport.importSingleByKey).not.toHaveBeenCalled();
  });

  it('Jira deleted: 対応 Task が無ければ無視（例外を投げない／save しない）', async () => {
    const d = makeDeps({ secret: 'S1', existingTask: null });
    const uc = makeUseCase(d);

    await expect(
      uc.execute({
        provider: 'jira',
        connectionId: 'conn1',
        token: tokenFor(d),
        body: { webhookEvent: 'jira:issue_deleted', issue: { key: 'ABC-404' } },
      }),
    ).resolves.toBeUndefined();
    expect(d.taskRepository.save).not.toHaveBeenCalled();
  });

  it('Backlog 更新(type=2): content.key_id と projectKey から KEY を組んで import', async () => {
    const d = makeDeps({
      secret: 'S2',
      connection: {
        id: 'conn2',
        projectId: 'p2',
        provider: 'BACKLOG',
        projectKey: 'IPLOT',
        webhookSecretEnc: new CryptoService().encrypt('S2'),
      },
    });
    const uc = makeUseCase(d);

    await uc.execute({
      provider: 'backlog',
      connectionId: 'conn2',
      token: tokenFor(d),
      body: {
        type: 2,
        project: { projectKey: 'IPLOT' },
        content: { key_id: 9 },
      },
    });

    expect(d.trackerImport.importSingleByKey).toHaveBeenCalledWith(
      'conn2',
      'IPLOT-9',
    );
  });

  it('Backlog 削除(type=3): 対応 Task を BACKLOG:KEY でクローズ', async () => {
    const changeStatus = jest.fn();
    const d = makeDeps({
      secret: 'S2',
      connection: {
        id: 'conn2',
        projectId: 'p2',
        provider: 'BACKLOG',
        projectKey: 'IPLOT',
        webhookSecretEnc: new CryptoService().encrypt('S2'),
      },
      existingTask: { id: 't2', changeStatus },
    });
    const uc = makeUseCase(d);

    await uc.execute({
      provider: 'backlog',
      connectionId: 'conn2',
      token: tokenFor(d),
      body: { type: 3, content: { key_id: 9 } },
    });

    expect(d.taskRepository.findByProjectIdAndSourceKey).toHaveBeenCalledWith(
      'p2',
      'BACKLOG:IPLOT-9',
    );
    expect(changeStatus).toHaveBeenCalledWith('CLOSED');
    expect(d.taskRepository.save).toHaveBeenCalled();
  });

  it('誤 token → UnauthorizedException（import しない）', async () => {
    const d = makeDeps({ secret: 'S1' });
    const uc = makeUseCase(d);

    await expect(
      uc.execute({
        provider: 'jira',
        connectionId: 'conn1',
        token: 'WRONG',
        body: { webhookEvent: 'jira:issue_updated', issue: { key: 'ABC-1' } },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(d.trackerImport.importSingleByKey).not.toHaveBeenCalled();
  });

  it('webhookSecretEnc null（webhook 無効）→ UnauthorizedException', async () => {
    const d = makeDeps({ secret: null });
    const uc = makeUseCase(d);

    await expect(
      uc.execute({
        provider: 'jira',
        connectionId: 'conn1',
        token: 'anything',
        body: { webhookEvent: 'jira:issue_updated', issue: { key: 'ABC-1' } },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('接続が無い → UnauthorizedException（情報を漏らさず一律 401）', async () => {
    const d = makeDeps({ connection: null });
    const uc = makeUseCase(d);

    await expect(
      uc.execute({
        provider: 'jira',
        connectionId: 'missing',
        token: 'anything',
        body: { webhookEvent: 'jira:issue_updated', issue: { key: 'ABC-1' } },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('未知/無関係なイベント（key 不明）は無害化（import も close もしない）', async () => {
    const d = makeDeps({ secret: 'S1' });
    const uc = makeUseCase(d);

    await expect(
      uc.execute({
        provider: 'jira',
        connectionId: 'conn1',
        token: tokenFor(d),
        body: { webhookEvent: 'jira:worklog_updated' },
      }),
    ).resolves.toBeUndefined();
    expect(d.trackerImport.importSingleByKey).not.toHaveBeenCalled();
    expect(d.taskRepository.save).not.toHaveBeenCalled();
  });

  it('import 中の例外はログのみで握る（受信側に例外を伝播しない）', async () => {
    const d = makeDeps({ secret: 'S1' });
    d.trackerImport.importSingleByKey.mockRejectedValueOnce(
      new Error('upstream 500'),
    );
    const uc = makeUseCase(d);

    await expect(
      uc.execute({
        provider: 'jira',
        connectionId: 'conn1',
        token: tokenFor(d),
        body: { webhookEvent: 'jira:issue_updated', issue: { key: 'ABC-1' } },
      }),
    ).resolves.toBeUndefined();
  });
});
