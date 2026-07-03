import { RegisterUserUseCase } from './register-user.use-case';
import { User, EntityAlreadyExistsError } from '../../../domain';

describe('RegisterUserUseCase', () => {
  let userRepository: any;
  let passwordHashService: any;
  let tokenService: any;
  let useCase: RegisterUserUseCase;

  beforeEach(() => {
    userRepository = {
      findByEmail: jest.fn(),
      generateId: jest.fn().mockReturnValue('new-id'),
      save: jest.fn().mockResolvedValue(undefined),
    };
    passwordHashService = { hash: jest.fn().mockResolvedValue('hashed-pw') };
    tokenService = { generateAccessToken: jest.fn().mockReturnValue('jwt-abc') };
    useCase = new RegisterUserUseCase(userRepository, passwordHashService, tokenService);
  });

  it('Google 連携アカウントへの乗っ取り登録を拒否する', async () => {
    const googleUser = User.createWithGoogle(
      { email: 'google@x.com', name: 'G User', googleId: 'g-1' },
      'u-1',
    );
    userRepository.findByEmail.mockResolvedValue(googleUser);

    await expect(
      useCase.execute({ email: 'google@x.com', password: 'attacker-pw' }),
    ).rejects.toBeInstanceOf(EntityAlreadyExistsError);

    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('招待ユーザー（googleId なし）は本登録に成功する', async () => {
    const invitedUser = User.reconstruct({
      id: 'u-2',
      email: 'invited@x.com',
      password: '',
      name: null,
      avatarUrl: null,
      isSuperAdmin: false,
      googleId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userRepository.findByEmail.mockResolvedValue(invitedUser);

    const result = await useCase.execute({
      email: 'invited@x.com',
      password: 'my-password',
      name: 'New Name',
    });

    expect(userRepository.save).toHaveBeenCalled();
    expect(result.accessToken).toBe('jwt-abc');
    expect(result.user.email).toBe('invited@x.com');
  });

  it('新規メールはユーザー作成して JWT を返す', async () => {
    userRepository.findByEmail.mockResolvedValue(null);

    const result = await useCase.execute({
      email: 'brand-new@x.com',
      password: 'secure-pw',
      name: 'Brand New',
    });

    expect(userRepository.save).toHaveBeenCalled();
    expect(result.accessToken).toBe('jwt-abc');
    expect(result.user.email).toBe('brand-new@x.com');
  });
});
