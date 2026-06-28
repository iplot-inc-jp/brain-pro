import { LoginWithGoogleUseCase } from './login-with-google.use-case';
import { User, UnauthorizedError } from '../../../domain';

describe('LoginWithGoogleUseCase', () => {
  let verifier: any, userRepo: any, tokenService: any, acceptInvite: any, useCase: LoginWithGoogleUseCase;

  beforeEach(() => {
    verifier = { verifyIdToken: jest.fn() };
    userRepo = {
      findByEmail: jest.fn(),
      generateId: jest.fn().mockReturnValue('new-id'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = { generateAccessToken: jest.fn().mockReturnValue('jwt-xyz') };
    acceptInvite = { execute: jest.fn() };
    useCase = new LoginWithGoogleUseCase(verifier, userRepo, tokenService, acceptInvite);
  });

  it('未確認メールは UnauthorizedError', async () => {
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g', email: 'e@x.com', emailVerified: false, name: null, picture: null });
    await expect(useCase.execute({ idToken: 't' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('検証失敗(null)は UnauthorizedError', async () => {
    verifier.verifyIdToken.mockResolvedValue(null);
    await expect(useCase.execute({ idToken: 't' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('新規メールはユーザー作成して JWT を返す', async () => {
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g1', email: 'new@x.com', emailVerified: true, name: 'New', picture: 'http://p' });
    userRepo.findByEmail.mockResolvedValue(null);

    const res = await useCase.execute({ idToken: 't' });

    expect(userRepo.save).toHaveBeenCalled();
    expect(res.accessToken).toBe('jwt-xyz');
    expect(res.user.email).toBe('new@x.com');
    expect(res.joinedOrganizationId).toBeNull();
  });

  it('既存メールで googleId 未設定なら紐付ける', async () => {
    const existing = User.create({ email: 'old@x.com', password: 'p', name: 'Old' }, 'hashed', 'old-id');
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g2', email: 'old@x.com', emailVerified: true, name: 'Old', picture: null });
    userRepo.findByEmail.mockResolvedValue(existing);

    const res = await useCase.execute({ idToken: 't' });

    expect(existing.googleId).toBe('g2');
    expect(res.user.id).toBe('old-id');
  });

  it('inviteToken があれば AcceptInvite を呼び joinedOrganizationId を返す', async () => {
    verifier.verifyIdToken.mockResolvedValue({ googleId: 'g3', email: 'a@x.com', emailVerified: true, name: null, picture: null });
    userRepo.findByEmail.mockResolvedValue(null);
    acceptInvite.execute.mockResolvedValue({ organizationId: 'org-9', alreadyMember: false });

    const res = await useCase.execute({ idToken: 't', inviteToken: 'inv' });

    expect(acceptInvite.execute).toHaveBeenCalledWith({ token: 'inv', userId: 'new-id' });
    expect(res.joinedOrganizationId).toBe('org-9');
  });

  it('既存メールで googleId が設定済みなら再リンクしない（上書きしない）', async () => {
    const existing = User.createWithGoogle(
      { email: 'g@x.com', name: 'G', avatarUrl: null, googleId: 'g-existing' },
      'gid',
    );
    verifier.verifyIdToken.mockResolvedValue({
      googleId: 'g-new', email: 'g@x.com', emailVerified: true, name: 'G', picture: null,
    });
    userRepo.findByEmail.mockResolvedValue(existing);

    await useCase.execute({ idToken: 't' });

    expect(existing.googleId).toBe('g-existing'); // 上書きされない
  });

  it('既存ユーザーの avatar/name は Google プロフィールで上書きしない', async () => {
    const existing = User.create(
      { email: 'k@x.com', password: 'p', name: '既存名' },
      'hashed',
      'kid',
    );
    existing.changeAvatarUrl('http://existing/avatar.png');
    verifier.verifyIdToken.mockResolvedValue({
      googleId: 'g9', email: 'k@x.com', emailVerified: true, name: 'GoogleName', picture: 'http://google/p.png',
    });
    userRepo.findByEmail.mockResolvedValue(existing);

    await useCase.execute({ idToken: 't' });

    expect(existing.name).toBe('既存名');
    expect(existing.avatarUrl).toBe('http://existing/avatar.png');
    expect(existing.googleId).toBe('g9'); // 未設定だったのでリンクはされる
  });
});
