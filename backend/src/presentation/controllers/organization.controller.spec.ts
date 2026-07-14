import { OrganizationController } from './organization.controller';
import { ForbiddenError } from '../../domain';

// assertCompanyAdmin は private。スコープ検査ブランチは DB 照会前に throw するので、
// getMembers を「別会社スコープのトークン」で呼ぶと prisma に触れず Forbidden になることで検証する。
describe('OrganizationController scope gate', () => {
  const makeController = () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      organizationMember: { findUnique: jest.fn(), findMany: jest.fn() },
    } as any;
    const ctrl = new OrganizationController(
      {} as any, // CreateOrganizationUseCase
      {} as any, // GetOrganizationsUseCase
      prisma,
      {} as any, // CryptoService
      {} as any, // PasswordHashService
    );
    return { ctrl, prisma };
  };

  it('別会社スコープのトークンは Forbidden（DB照会前に弾く）', async () => {
    const { ctrl, prisma } = makeController();
    const user = { id: 'member-1', email: '', scopeOrgId: 'org-OTHER' } as any;
    await expect(ctrl.getMembers(user, 'org-9')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('自社スコープのトークンはスコープ検査を通過し通常の管理者判定に進む（非管理者は Forbidden）', async () => {
    const { ctrl, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // 非管理者
    const user = { id: 'member-1', email: '', scopeOrgId: 'org-9' } as any;
    await expect(ctrl.getMembers(user, 'org-9')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prisma.user.findUnique).toHaveBeenCalled(); // スコープは通過して管理者判定に進んだ
  });

  it('スコープ無しトークン/ログインユーザーは従来どおり（管理者なら通過）', async () => {
    const { ctrl, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'OWNER' });
    prisma.organizationMember.findMany.mockResolvedValue([]);
    const user = { id: 'admin-1', email: '' } as any; // scopeOrgId 無し
    await expect(ctrl.getMembers(user, 'org-9')).resolves.toEqual([]);
  });
});
