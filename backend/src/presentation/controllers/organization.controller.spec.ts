import { OrganizationController } from './organization.controller';
import { ForbiddenError } from '../../domain';
import { UserApiTokenService } from '../../infrastructure/services/user-api-token.service';

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
      {} as any, // UserApiTokenService
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

describe('OrganizationController member api-tokens', () => {
  const makeController = () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      organizationMember: { findUnique: jest.fn() },
    } as any;
    const tokenSvc = {
      mint: jest.fn().mockResolvedValue({ id: 'tok-1', name: 'ipro', token: 'a.b.c', createdAt: new Date(0) }),
      listForOrgMember: jest.fn().mockResolvedValue([]),
      revokeForOrgMember: jest.fn().mockResolvedValue(undefined),
    };
    const ctrl = new OrganizationController(
      {} as any,
      {} as any,
      prisma,
      {} as any,
      {} as any,
      tokenSvc as any,
    );
    return { ctrl, prisma, tokenSvc };
  };

  // 管理者本人（admin-1 が org-9 の OWNER・super-admin でない）を模す共通セットアップ。
  const asAdmin = (prisma: any) => {
    prisma.user.findUnique.mockImplementation(({ where, select }: any) => {
      // assertCompanyAdmin の isSuperAdmin 照会
      if (select?.isSuperAdmin) return Promise.resolve({ isSuperAdmin: where.id === 'admin-1' ? false : false });
      return Promise.resolve(null);
    });
    prisma.organizationMember.findUnique.mockImplementation(({ where }: any) => {
      const uid = where.organizationId_userId.userId;
      if (uid === 'admin-1') return Promise.resolve({ role: 'OWNER' }); // 発行者は管理者
      if (uid === 'member-1') return Promise.resolve({ role: 'MEMBER' }); // 対象は会社メンバー
      return Promise.resolve(null); // それ以外は非メンバー
    });
  };

  const admin = { id: 'admin-1', email: '' } as any;

  it('非管理者は発行できない（403）', async () => {
    const { ctrl, prisma } = makeController();
    prisma.user.findUnique.mockResolvedValue({ isSuperAdmin: false });
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'MEMBER' }); // 呼び出し元が非管理者
    const notAdmin = { id: 'member-2', email: '' } as any;
    await expect(
      ctrl.issueMemberApiToken(notAdmin, 'org-9', 'member-1', { name: 'ipro' }),
    ).rejects.toBeDefined();
  });

  it('対象が会社メンバーでなければ拒否', async () => {
    const { ctrl, prisma } = makeController();
    asAdmin(prisma);
    // 対象 outsider は org-9 の非メンバー
    await expect(
      ctrl.issueMemberApiToken(admin, 'org-9', 'outsider', { name: 'ipro' }),
    ).rejects.toBeDefined();
  });

  it('対象が super-admin なら発行禁止', async () => {
    const { ctrl, prisma, tokenSvc } = makeController();
    asAdmin(prisma);
    // 対象 member-1 は org-9 のメンバーだが super-admin
    prisma.user.findUnique.mockImplementation(({ where, select }: any) => {
      if (select?.isSuperAdmin) return Promise.resolve({ isSuperAdmin: where.id === 'member-1' });
      return Promise.resolve(null);
    });
    await expect(
      ctrl.issueMemberApiToken(admin, 'org-9', 'member-1', { name: 'ipro' }),
    ).rejects.toBeDefined();
    expect(tokenSvc.mint).not.toHaveBeenCalled();
  });

  it('正常: scopeOrgId と issuedByUserId を付けて mint し、平文トークンを返す', async () => {
    const { ctrl, prisma, tokenSvc } = makeController();
    asAdmin(prisma);
    const out = await ctrl.issueMemberApiToken(admin, 'org-9', 'member-1', { name: 'ipro' });
    expect(tokenSvc.mint).toHaveBeenCalledWith('member-1', 'ipro', expect.any(Number), {
      scopeOrgId: 'org-9',
      issuedByUserId: 'admin-1',
    });
    expect(out.token).toBe('a.b.c');
  });

  it('失効: revokeForOrgMember に (対象, 会社, tokenId) を渡す', async () => {
    const { ctrl, prisma, tokenSvc } = makeController();
    asAdmin(prisma);
    await ctrl.revokeMemberApiToken(admin, 'org-9', 'member-1', 'tok-1');
    expect(tokenSvc.revokeForOrgMember).toHaveBeenCalledWith('member-1', 'org-9', 'tok-1');
  });
});
