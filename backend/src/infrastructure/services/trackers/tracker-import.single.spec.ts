/**
 * TrackerImportService.importSingleByKey の単体検証（webhook 受信時の単一課題 import）。
 *
 * webhook で「変更された 1 課題だけ」を既存の正規化+upsert 経路で取り込めることを固定する。
 * 外部 API（jira-api / backlog-api）と repository / prisma / crypto はモックする。
 *   - 既存タスクが無ければ create、有れば update（sourceKey='PROVIDER:KEY' で冪等）。
 *   - 該当課題が外部に無ければ 'not_found' を返し、Task を作らない。
 */
import { TrackerImportService } from './tracker-import.service';
import * as jiraApi from './jira-api';
import * as backlogApi from './backlog-api';
import { NormalizedIssue } from './types';

jest.mock('./jira-api');
jest.mock('./backlog-api');

const mockedJiraGet = jiraApi.jiraGetIssue as jest.MockedFunction<
  typeof jiraApi.jiraGetIssue
>;
const mockedBacklogGet = backlogApi.backlogGetIssue as jest.MockedFunction<
  typeof backlogApi.backlogGetIssue
>;

function makeIssue(overrides: Partial<NormalizedIssue> = {}): NormalizedIssue {
  return {
    externalKey: 'ABC-1',
    title: 'タイトル',
    description: '本文',
    status: 'In Progress',
    priority: 'High',
    assigneeName: 'Taro',
    startDate: null,
    dueDate: null,
    estimatedHours: null,
    actualHours: null,
    parentExternalKey: null,
    issueType: 'Task',
    epicExternalKey: null,
    storyPoints: null,
    sprint: null,
    comments: undefined,
    ...overrides,
  };
}

interface Mocks {
  taskRepository: {
    findByProjectIdAndSourceKey: jest.Mock;
    findById: jest.Mock;
    save: jest.Mock;
    generateId: jest.Mock;
  };
  taskCommentRepository: {
    findByTaskId: jest.Mock;
    save: jest.Mock;
    generateId: jest.Mock;
  };
  prisma: {
    issueTrackerConnection: { findUnique: jest.Mock };
  };
  crypto: { decrypt: jest.Mock };
}

function buildService(connection: Record<string, unknown> | null): {
  service: TrackerImportService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    taskRepository: {
      findByProjectIdAndSourceKey: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue(undefined),
      generateId: jest.fn().mockReturnValue('new-task-id'),
    },
    taskCommentRepository: {
      findByTaskId: jest.fn().mockResolvedValue([]),
      save: jest.fn().mockResolvedValue(undefined),
      generateId: jest.fn().mockReturnValue('new-comment-id'),
    },
    prisma: {
      issueTrackerConnection: {
        findUnique: jest.fn().mockResolvedValue(connection),
      },
    },
    crypto: { decrypt: jest.fn().mockReturnValue('decrypted-credential') },
  };
  const service = new TrackerImportService(
    mocks.taskRepository as never,
    mocks.taskCommentRepository as never,
    mocks.prisma as never,
    mocks.crypto as never,
  );
  return { service, mocks };
}

describe('TrackerImportService.importSingleByKey', () => {
  beforeEach(() => {
    mockedJiraGet.mockReset();
    mockedBacklogGet.mockReset();
  });

  it('Jira: 既存タスクが無ければ create（sourceKey=JIRA:KEY で upsert）', async () => {
    const { service, mocks } = buildService({
      id: 'conn-1',
      provider: 'JIRA',
      host: 'https://x.atlassian.net',
      email: 'a@b.com',
      credentialEnc: 'enc',
      projectKey: 'ABC',
      projectId: 'proj-1',
    });
    mockedJiraGet.mockResolvedValue(makeIssue({ externalKey: 'ABC-1' }));

    const r = await service.importSingleByKey('conn-1', 'ABC-1');

    expect(r).toBe('upserted');
    // 単一 key に絞って Jira を呼ぶ
    expect(mockedJiraGet).toHaveBeenCalledTimes(1);
    // 既存が無いので新規作成（save が呼ばれ、id は generateId）
    expect(mocks.taskRepository.save).toHaveBeenCalledTimes(1);
    const saved = mocks.taskRepository.save.mock.calls[0][0];
    expect(saved.sourceKey).toBe('JIRA:ABC-1');
    expect(saved.projectId).toBe('proj-1');
    expect(saved.title).toBe('タイトル');
  });

  it('Jira: 既存タスクが有れば update（重複作成しない）', async () => {
    const { service, mocks } = buildService({
      id: 'conn-1',
      provider: 'JIRA',
      host: 'https://x.atlassian.net',
      email: 'a@b.com',
      credentialEnc: 'enc',
      projectKey: 'ABC',
      projectId: 'proj-1',
    });
    const existing = {
      id: 'existing-id',
      update: jest.fn(),
    };
    mocks.taskRepository.findByProjectIdAndSourceKey.mockResolvedValue(existing);
    mockedJiraGet.mockResolvedValue(makeIssue({ externalKey: 'ABC-1', title: '更新後' }));

    const r = await service.importSingleByKey('conn-1', 'ABC-1');

    expect(r).toBe('upserted');
    expect(existing.update).toHaveBeenCalledTimes(1);
    expect(existing.update.mock.calls[0][0].title).toBe('更新後');
    expect(mocks.taskRepository.save).toHaveBeenCalledWith(existing);
    expect(mocks.taskRepository.generateId).not.toHaveBeenCalled();
  });

  it('Backlog: 単一 key を取り込む', async () => {
    const { service, mocks } = buildService({
      id: 'conn-2',
      provider: 'BACKLOG',
      host: 'iplot.backlog.com',
      email: null,
      credentialEnc: 'enc',
      projectKey: 'IPLOT',
      projectId: 'proj-2',
    });
    mockedBacklogGet.mockResolvedValue(makeIssue({ externalKey: 'IPLOT-9', status: '処理中', priority: '高' }));

    const r = await service.importSingleByKey('conn-2', 'IPLOT-9');

    expect(r).toBe('upserted');
    expect(mockedBacklogGet).toHaveBeenCalledTimes(1);
    const saved = mocks.taskRepository.save.mock.calls[0][0];
    expect(saved.sourceKey).toBe('BACKLOG:IPLOT-9');
    expect(saved.projectId).toBe('proj-2');
  });

  it('外部に該当課題が無ければ not_found（Task を作らない）', async () => {
    const { service, mocks } = buildService({
      id: 'conn-1',
      provider: 'JIRA',
      host: 'https://x.atlassian.net',
      email: 'a@b.com',
      credentialEnc: 'enc',
      projectKey: 'ABC',
      projectId: 'proj-1',
    });
    mockedJiraGet.mockResolvedValue(null);

    const r = await service.importSingleByKey('conn-1', 'ABC-404');

    expect(r).toBe('not_found');
    expect(mocks.taskRepository.save).not.toHaveBeenCalled();
  });

  it('接続が見つからなければ例外', async () => {
    const { service } = buildService(null);
    await expect(service.importSingleByKey('missing', 'ABC-1')).rejects.toThrow();
  });
});
