import { ImportJiraTasksUseCase } from './import-jira-tasks.use-case';

// 既存テストに合わせたモック生成ヘルパ。ITaskRepository / ProjectRepository /
// OrganizationRepository / ProjectAccessService の最小モックを返す。
function makeDeps(opts?: { existingBySourceKey?: Record<string, any> }) {
  const saved: any[] = [];
  const byId = new Map<string, any>();
  const bySourceKey = new Map<string, any>(
    Object.entries(opts?.existingBySourceKey ?? {}),
  );
  let seq = 0;
  const taskRepository = {
    generateId: () => `t${++seq}`,
    save: async (t: any) => {
      saved.push(t);
      byId.set(t.id, t);
    },
    findById: async (id: string) => byId.get(id) ?? null,
    findByProjectIdAndSourceKey: async (_p: string, sk: string) =>
      bySourceKey.get(sk) ?? null,
  };
  const projectRepository = {
    findById: async () => ({ id: 'p1', organizationId: 'o1' }),
  };
  const organizationRepository = { isMember: async () => true };
  const projectAccess = { assertProjectAccess: async () => {} };
  return {
    taskRepository,
    projectRepository,
    organizationRepository,
    projectAccess,
    saved,
    byId,
    bySourceKey,
  };
}

const JIRA_CSV = [
  'Summary,Issue key,Status,Priority,Assignee,Due date,Original Estimate,Parent',
  '親タスク,PROJ-1,To Do,High,山田,2026-07-01,3600,',
  '子タスク,PROJ-2,In Progress,Lowest,田中,,7200,PROJ-1',
].join('\n');

describe('ImportJiraTasksUseCase', () => {
  it('Jira CSV を取り込み、列マッピング/status/priority写像/秒→時間/親解決が効く', async () => {
    const d = makeDeps();
    const uc = new ImportJiraTasksUseCase(
      d.taskRepository as any,
      d.projectRepository as any,
      d.organizationRepository as any,
      d.projectAccess as any,
    );
    const out = await uc.execute({
      userId: 'u1',
      projectId: 'p1',
      csv: JIRA_CSV,
    });
    expect(out.created).toBe(2);
    const parent = d.saved.find((t) => t.title === '親タスク');
    const child = d.saved.find((t) => t.title === '子タスク');
    expect(parent.status).toBe('OPEN'); // To Do
    expect(parent.priority).toBe('HIGH'); // High
    expect(parent.estimatedHours).toBe(1); // 3600s → 1h
    expect(parent.sourceKey).toBe('JIRA:PROJ-1');
    expect(child.status).toBe('IN_PROGRESS'); // In Progress
    expect(child.priority).toBe('LOW'); // Lowest
    expect(child.parentId).toBe(parent.id); // PROJ-1 を親解決
  });

  it('同じ Issue key を再取込すると新規作成でなく更新（冪等 upsert）', async () => {
    // 既存 Task（sourceKey=JIRA:PROJ-1）がある状態
    const existing: any = {
      id: 'old1',
      title: '旧件名',
      sourceKey: 'JIRA:PROJ-1',
      parentId: null,
      update(p: any) {
        Object.assign(this, p);
      },
      reparent(pid: string | null) {
        this.parentId = pid;
      },
    };
    const d = makeDeps({ existingBySourceKey: { 'JIRA:PROJ-1': existing } });
    const uc = new ImportJiraTasksUseCase(
      d.taskRepository as any,
      d.projectRepository as any,
      d.organizationRepository as any,
      d.projectAccess as any,
    );
    const out = await uc.execute({
      userId: 'u1',
      projectId: 'p1',
      csv: 'Summary,Issue key\n新件名,PROJ-1',
    });
    expect(out.created).toBe(0);
    expect(out.updated).toBe(1);
    expect(existing.title).toBe('新件名'); // 既存を更新（重複作成しない）
  });
});
