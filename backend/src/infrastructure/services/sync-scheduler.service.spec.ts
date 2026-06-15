/**
 * SyncSchedulerService のトラッカー auto-sync 間引きの単体検証。
 *
 * webhook 有効接続(webhookSecretEnc != null)は webhook で即時反映されるため、ポーリングは
 * 日次バックストップ(最低1440分)に間引かれ、高頻度では再 enqueue されないことを固定する。
 * webhook 無効接続は従来どおり syncIntervalMinutes を尊重する。
 * 依存(prisma / sync / company-key / job)はモックする。
 */
import { SyncSchedulerService } from './sync-scheduler.service';

interface Mocks {
  prisma: {
    githubConnection: { findMany: jest.Mock };
    issueTrackerConnection: { findMany: jest.Mock };
  };
  syncService: { runSync: jest.Mock };
  companyKeyService: { resolveForProject: jest.Mock };
  jobService: { enqueue: jest.Mock };
}

function build(trackerConnections: Record<string, unknown>[]): {
  service: SyncSchedulerService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    prisma: {
      githubConnection: { findMany: jest.fn().mockResolvedValue([]) },
      issueTrackerConnection: {
        findMany: jest.fn().mockResolvedValue(trackerConnections),
      },
    },
    syncService: { runSync: jest.fn().mockResolvedValue(undefined) },
    companyKeyService: { resolveForProject: jest.fn().mockResolvedValue('key') },
    jobService: { enqueue: jest.fn().mockResolvedValue(undefined) },
  };
  const service = new SyncSchedulerService(
    mocks.prisma as never,
    mocks.syncService as never,
    mocks.companyKeyService as never,
    mocks.jobService as never,
  );
  return { service, mocks };
}

describe('SyncSchedulerService.runAutoSync (tracker backstop)', () => {
  const now = Date.now();
  // 2時間前。通常の syncIntervalMinutes(60) なら due だが、日次バックストップ(1440)では未満。
  const twoHoursAgo = new Date(now - 120 * 60_000);

  it('webhook 有効接続は日次バックストップに間引かれ、2時間経過では enqueue しない', async () => {
    const { service, mocks } = build([
      {
        id: 'conn-webhook',
        provider: 'JIRA',
        projectId: 'proj-1',
        autoSync: true,
        syncIntervalMinutes: 60,
        webhookSecretEnc: 'enc-secret',
        lastSyncedAt: twoHoursAgo,
      },
    ]);

    const result = await service.runAutoSync();

    expect(mocks.jobService.enqueue).not.toHaveBeenCalled();
    expect(result.trackers.checked).toBe(1);
    expect(result.trackers.synced).toBe(0);
    expect(result.trackers.skipped).toBe(1);
  });

  it('webhook 無効接続は従来どおり syncIntervalMinutes を尊重して enqueue する', async () => {
    const { service, mocks } = build([
      {
        id: 'conn-poll',
        provider: 'BACKLOG',
        projectId: 'proj-2',
        autoSync: true,
        syncIntervalMinutes: 60,
        webhookSecretEnc: null,
        lastSyncedAt: twoHoursAgo,
      },
    ]);

    const result = await service.runAutoSync();

    expect(mocks.jobService.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.jobService.enqueue).toHaveBeenCalledWith(
      'TRACKER_IMPORT',
      { connectionId: 'conn-poll', mode: 'incremental' },
      { projectId: 'proj-2', createdById: null },
    );
    expect(result.trackers.synced).toBe(1);
    expect(result.trackers.skipped).toBe(0);
  });

  it('webhook 有効接続でも日次バックストップ超過(2日経過)なら補修同期を enqueue する', async () => {
    const twoDaysAgo = new Date(now - 2 * 1440 * 60_000);
    const { service, mocks } = build([
      {
        id: 'conn-webhook-stale',
        provider: 'JIRA',
        projectId: 'proj-3',
        autoSync: true,
        syncIntervalMinutes: 60,
        webhookSecretEnc: 'enc-secret',
        lastSyncedAt: twoDaysAgo,
      },
    ]);

    const result = await service.runAutoSync();

    expect(mocks.jobService.enqueue).toHaveBeenCalledTimes(1);
    expect(result.trackers.synced).toBe(1);
  });
});
