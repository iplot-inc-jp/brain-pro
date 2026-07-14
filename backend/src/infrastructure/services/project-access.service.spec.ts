import { ProjectAccessService } from './project-access.service';

// resolveForPrincipal の会社スコープ挙動を、prisma をモックして検証する。
describe('ProjectAccessService.resolveForPrincipal (scopeOrgId)', () => {
  // project.organizationId を返し、super-admin でない一般会員(EDIT)を模す最小モック。
  const makePrisma = (projectOrgId: string) =>
    ({
      project: { findUnique: jest.fn().mockResolvedValue({ organizationId: projectOrgId }) },
      user: { findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: false }) },
      organizationMember: { findUnique: jest.fn().mockResolvedValue({ role: 'MEMBER' }) },
      projectMember: {
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    }) as any;

  it('scopeOrgId 一致: 本人の live RBAC で解決（org メンバー→EDIT）', async () => {
    const svc = new ProjectAccessService(makePrisma('org-9'));
    const level = await svc.resolveForPrincipal({ id: 'member-1', scopeOrgId: 'org-9' }, 'proj-1');
    expect(level).toBe('EDIT');
  });

  it('scopeOrgId 不一致: 対象案件が別会社なら null（越境拒否・RBAC を見ない）', async () => {
    const prisma = makePrisma('org-OTHER');
    const svc = new ProjectAccessService(prisma);
    const level = await svc.resolveForPrincipal({ id: 'member-1', scopeOrgId: 'org-9' }, 'proj-1');
    expect(level).toBe(null);
    // 越境時は会員 RBAC の照会に進まない（早期 deny）。
    expect(prisma.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('scopeOrgId 無し: 従来どおり本人の RBAC（自己発行トークン/ログインユーザー）', async () => {
    const svc = new ProjectAccessService(makePrisma('org-9'));
    const level = await svc.resolveForPrincipal({ id: 'member-1' }, 'proj-1');
    expect(level).toBe('EDIT');
  });

  it('存在しないプロジェクトは null', async () => {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(null) },
    } as any;
    const svc = new ProjectAccessService(prisma);
    expect(await svc.resolveForPrincipal({ id: 'member-1', scopeOrgId: 'org-9' }, 'nope')).toBe(null);
  });
});
