import { CreateInviteUseCase } from './create-invite.use-case';
import { ForbiddenError } from '../../../domain';

describe('CreateInviteUseCase', () => {
  let userRepo: any, orgRepo: any, inviteRepo: any, useCase: CreateInviteUseCase;

  beforeEach(() => {
    userRepo = { findById: jest.fn() };
    orgRepo = { getMemberRole: jest.fn() };
    inviteRepo = {
      generateId: jest.fn().mockReturnValue('inv-1'),
      generateToken: jest.fn().mockReturnValue('tok-1'),
      create: jest.fn().mockImplementation(async (d) => ({
        ...d, useCount: 0, revokedAt: null, createdAt: new Date('2026-06-28'),
      })),
    };
    useCase = new CreateInviteUseCase(userRepo, orgRepo, inviteRepo);
  });

  it('ADMIN は作成でき、role 既定は MEMBER', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: false });
    orgRepo.getMemberRole.mockResolvedValue('ADMIN');

    const view = await useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1' });

    expect(inviteRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', token: 'tok-1', role: 'MEMBER', maxUses: null, expiresAt: null }),
    );
    expect(view.token).toBe('tok-1');
    expect(view.valid).toBe(true);
  });

  it('expiresInDays から expiresAt を計算する', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: true });
    orgRepo.getMemberRole.mockResolvedValue(null);

    await useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', expiresInDays: 7, maxUses: 5, role: 'VIEWER' });

    const arg = inviteRepo.create.mock.calls[0][0];
    expect(arg.role).toBe('VIEWER');
    expect(arg.maxUses).toBe(5);
    expect(arg.expiresAt).toBeInstanceOf(Date);
  });

  it('権限が無ければ ForbiddenError', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: false });
    orgRepo.getMemberRole.mockResolvedValue('MEMBER');
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
