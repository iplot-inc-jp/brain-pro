import { RevokeInviteUseCase } from './revoke-invite.use-case';
import { EntityNotFoundError, ForbiddenError } from '../../../domain';

describe('RevokeInviteUseCase', () => {
  let userRepo: any, orgRepo: any, inviteRepo: any, useCase: RevokeInviteUseCase;

  beforeEach(() => {
    userRepo = { findById: jest.fn().mockResolvedValue({ isSuperAdmin: true }) };
    orgRepo = { getMemberRole: jest.fn() };
    inviteRepo = { findById: jest.fn(), revoke: jest.fn().mockResolvedValue(undefined) };
    useCase = new RevokeInviteUseCase(userRepo, orgRepo, inviteRepo);
  });

  it('対象会社の招待なら revoke する', async () => {
    inviteRepo.findById.mockResolvedValue({ id: 'inv-1', organizationId: 'org-1' });
    await useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'inv-1' });
    expect(inviteRepo.revoke).toHaveBeenCalledWith('inv-1');
  });

  it('存在しなければ EntityNotFoundError', async () => {
    inviteRepo.findById.mockResolvedValue(null);
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'x' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('別会社の招待は EntityNotFoundError（漏洩防止）', async () => {
    inviteRepo.findById.mockResolvedValue({ id: 'inv-9', organizationId: 'org-OTHER' });
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'inv-9' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('権限が無ければ ForbiddenError', async () => {
    userRepo.findById.mockResolvedValue({ isSuperAdmin: false });
    orgRepo.getMemberRole.mockResolvedValue('VIEWER');
    await expect(useCase.execute({ organizationId: 'org-1', requesterUserId: 'u-1', inviteId: 'inv-1' })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
