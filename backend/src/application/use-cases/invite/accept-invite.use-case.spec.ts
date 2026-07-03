import { AcceptInviteUseCase } from './accept-invite.use-case';
import { EntityNotFoundError, ValidationError } from '../../../domain';

function makeInvite(over: Partial<any> = {}) {
  return {
    id: 'inv-1', organizationId: 'org-1', token: 'tok', role: 'MEMBER',
    createdByUserId: 'admin-1', expiresAt: null, maxUses: null, useCount: 0,
    revokedAt: null, createdAt: new Date('2026-06-01'), ...over,
  };
}

describe('AcceptInviteUseCase', () => {
  let inviteRepo: any;
  let orgRepo: any;
  let useCase: AcceptInviteUseCase;

  beforeEach(() => {
    inviteRepo = {
      findByToken: jest.fn(),
      incrementUseCount: jest.fn().mockResolvedValue(undefined),
    };
    orgRepo = {
      getMemberRole: jest.fn(),
      addMember: jest.fn().mockResolvedValue(undefined),
    };
    useCase = new AcceptInviteUseCase(inviteRepo, orgRepo);
  });

  it('未所属なら addMember して useCount を増やす', async () => {
    inviteRepo.findByToken.mockResolvedValue(makeInvite());
    orgRepo.getMemberRole.mockResolvedValue(null);

    const res = await useCase.execute({ token: 'tok', userId: 'u-1' });

    expect(orgRepo.addMember).toHaveBeenCalledWith('org-1', { userId: 'u-1', role: 'MEMBER' });
    expect(inviteRepo.incrementUseCount).toHaveBeenCalledWith('inv-1');
    expect(res).toEqual({ organizationId: 'org-1', alreadyMember: false });
  });

  it('既に所属していれば冪等（追加も増加もしない）', async () => {
    inviteRepo.findByToken.mockResolvedValue(makeInvite());
    orgRepo.getMemberRole.mockResolvedValue('MEMBER');

    const res = await useCase.execute({ token: 'tok', userId: 'u-1' });

    expect(orgRepo.addMember).not.toHaveBeenCalled();
    expect(inviteRepo.incrementUseCount).not.toHaveBeenCalled();
    expect(res).toEqual({ organizationId: 'org-1', alreadyMember: true });
  });

  it('存在しないトークンは EntityNotFoundError', async () => {
    inviteRepo.findByToken.mockResolvedValue(null);
    await expect(useCase.execute({ token: 'x', userId: 'u-1' })).rejects.toBeInstanceOf(EntityNotFoundError);
  });

  it('revoke 済みは ValidationError', async () => {
    inviteRepo.findByToken.mockResolvedValue(makeInvite({ revokedAt: new Date('2026-06-02') }));
    await expect(useCase.execute({ token: 'tok', userId: 'u-1' })).rejects.toBeInstanceOf(ValidationError);
  });
});
