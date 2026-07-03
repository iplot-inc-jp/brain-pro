import { PreviewInviteUseCase } from './preview-invite.use-case';

describe('PreviewInviteUseCase', () => {
  let inviteRepo: any, orgRepo: any, useCase: PreviewInviteUseCase;

  beforeEach(() => {
    inviteRepo = { findByToken: jest.fn() };
    orgRepo = { findById: jest.fn() };
    useCase = new PreviewInviteUseCase(inviteRepo, orgRepo);
  });

  it('有効な招待は会社名とロールを返す', async () => {
    inviteRepo.findByToken.mockResolvedValue({
      id: 'inv-1', organizationId: 'org-1', token: 't', role: 'MEMBER',
      createdByUserId: 'a', expiresAt: null, maxUses: null, useCount: 0, revokedAt: null, createdAt: new Date(),
    });
    orgRepo.findById.mockResolvedValue({ name: 'ACME' });

    const res = await useCase.execute({ token: 't' });
    expect(res).toEqual({ valid: true, reason: null, organizationName: 'ACME', role: 'MEMBER' });
  });

  it('存在しないトークンは notfound・機微情報なし', async () => {
    inviteRepo.findByToken.mockResolvedValue(null);
    const res = await useCase.execute({ token: 'x' });
    expect(res).toEqual({ valid: false, reason: 'notfound', organizationName: null, role: null });
    expect(orgRepo.findById).not.toHaveBeenCalled();
  });
});
