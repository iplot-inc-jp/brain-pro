import { ForbiddenError } from '../../../domain';
import { GetAllAccessibleIngestionBatchesUseCase } from './get-all-accessible-ingestion-batches.use-case';

function batch(id: string, projectId: string, createdAtIso: string) {
  return {
    id, projectId, name: `b-${id}`, status: 'SUCCEEDED',
    totalFiles: 1, succeededFiles: 1, failedFiles: 0, pendingFiles: 0,
    options: null, createdById: null,
    createdAt: new Date(createdAtIso), updatedAt: new Date(createdAtIso),
    startedAt: null, finishedAt: null,
  };
}
function makeDeps(opts: {
  orgs: Array<{ id: string }>;
  projectsByOrg: Record<string, Array<{ id: string; name: string }>>;
  accessByProject: Record<string, 'EDIT' | 'VIEW' | null>;
  batchesByProject: Record<string, ReturnType<typeof batch>[]>;
}) {
  return {
    orgRepo: { findByUserId: jest.fn(async () => opts.orgs) },
    projectRepo: { findByOrganizationId: jest.fn(async (orgId: string) => opts.projectsByOrg[orgId] ?? []) },
    batchRepo: { findByProjectId: jest.fn(async (pid: string) => opts.batchesByProject[pid] ?? []) },
    projectAccess: { resolveProjectAccess: jest.fn(async (pid: string) => opts.accessByProject[pid] ?? null) },
  };
}
function makeUseCase(d: ReturnType<typeof makeDeps>) {
  return new GetAllAccessibleIngestionBatchesUseCase(
    d.orgRepo as any, d.projectRepo as any, d.batchRepo as any, d.projectAccess as any,
  );
}

describe('GetAllAccessibleIngestionBatchesUseCase', () => {
  it('excludes projects the user cannot access (resolveProjectAccess null)', async () => {
    const d = makeDeps({
      orgs: [{ id: 'o1' }],
      projectsByOrg: { o1: [{ id: 'pA', name: 'Project A' }, { id: 'pB', name: 'Project B' }] },
      accessByProject: { pA: 'VIEW', pB: null },
      batchesByProject: { pA: [batch('1', 'pA', '2026-06-10T00:00:00Z')], pB: [batch('2', 'pB', '2026-06-11T00:00:00Z')] },
    });
    const out = await makeUseCase(d).execute({ userId: 'u1' });
    expect(out.map((b) => b.id)).toEqual(['1']);
    expect(out[0].projectName).toBe('Project A');
    expect(out[0].projectId).toBe('pA');
  });

  it('aggregates across projects/orgs sorted by createdAt desc', async () => {
    const d = makeDeps({
      orgs: [{ id: 'o1' }, { id: 'o2' }],
      projectsByOrg: { o1: [{ id: 'pA', name: 'A' }], o2: [{ id: 'pB', name: 'B' }] },
      accessByProject: { pA: 'EDIT', pB: 'VIEW' },
      batchesByProject: {
        pA: [batch('old', 'pA', '2026-06-01T00:00:00Z'), batch('new', 'pA', '2026-06-15T00:00:00Z')],
        pB: [batch('mid', 'pB', '2026-06-10T00:00:00Z')],
      },
    });
    const out = await makeUseCase(d).execute({ userId: 'u1' });
    expect(out.map((b) => b.id)).toEqual(['new', 'mid', 'old']);
  });

  it('caps the result at 200 (newest first)', async () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      batch(`b${i}`, 'pA', new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()),
    );
    const d = makeDeps({
      orgs: [{ id: 'o1' }],
      projectsByOrg: { o1: [{ id: 'pA', name: 'A' }] },
      accessByProject: { pA: 'VIEW' },
      batchesByProject: { pA: many },
    });
    const out = await makeUseCase(d).execute({ userId: 'u1' });
    expect(out).toHaveLength(200);
    expect(out[0].id).toBe('b249');
  });

  it('会社スコープトークンは candidate を scopeOrgId の会社に閉じ込める', async () => {
    const d = makeDeps({
      orgs: [{ id: 'o1' }, { id: 'o2' }],
      projectsByOrg: { o1: [{ id: 'pA', name: 'A' }], o2: [{ id: 'pB', name: 'B' }] },
      accessByProject: { pA: 'EDIT', pB: 'EDIT' },
      batchesByProject: {
        pA: [batch('a', 'pA', '2026-06-01T00:00:00Z')],
        pB: [batch('b', 'pB', '2026-06-02T00:00:00Z')],
      },
    });
    const out = await makeUseCase(d).execute({ userId: 'u1', scopeOrgId: 'o1' });
    // o2 のプロジェクト（pB）は集約されない。
    expect(out.map((b) => b.id)).toEqual(['a']);
    expect(d.projectRepo.findByOrganizationId).toHaveBeenCalledWith('o1');
    expect(d.projectRepo.findByOrganizationId).not.toHaveBeenCalledWith('o2');
  });

  it('returns empty when the user is in no orgs', async () => {
    const d = makeDeps({ orgs: [], projectsByOrg: {}, accessByProject: {}, batchesByProject: {} });
    expect(await makeUseCase(d).execute({ userId: 'u1' })).toEqual([]);
  });

  it('rejects API-key callers (cross-project aggregate is browser-only)', async () => {
    const d = makeDeps({
      orgs: [{ id: 'o1' }],
      projectsByOrg: { o1: [{ id: 'pA', name: 'A' }] },
      accessByProject: { pA: 'VIEW' },
      batchesByProject: { pA: [batch('1', 'pA', '2026-06-10T00:00:00Z')] },
    });
    await expect(
      makeUseCase(d).execute({ userId: 'u1', apiKeyId: 'k1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(d.orgRepo.findByUserId).not.toHaveBeenCalled();
  });
});
