import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository,
  USER_REPOSITORY,
  PasswordHashService,
  PASSWORD_HASH_SERVICE,
  TokenService,
  TOKEN_SERVICE,
  UnauthorizedError,
} from '../../../domain';

export interface LoginUserInput {
  email: string;
  password: string;
}

export interface LoginUserOutput {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    isSuperAdmin: boolean;
  };
}

/**
 * SUPER_ADMIN_EMAILS（カンマ区切り・大文字小文字無視）に
 * 含まれるメールアドレスかどうか判定。
 */
function isBootstrapSuperAdminEmail(email: string): boolean {
  const list = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return list.includes(email.trim().toLowerCase());
}

/**
 * ユーザーログインユースケース
 */
@Injectable()
export class LoginUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(PASSWORD_HASH_SERVICE)
    private readonly passwordHashService: PasswordHashService,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: LoginUserInput): Promise<LoginUserOutput> {
    // 1. ユーザー検索
    const user = await this.userRepository.findByEmail(input.email);
    if (!user) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // 招待中（パスワード未設定）アカウントはログイン不可
    if (!user.password) {
      throw new UnauthorizedError(
        '招待中のアカウントです。サインアップ（登録）でパスワードを設定してください',
      );
    }

    // 2. パスワード検証
    const isValid = await this.passwordHashService.compare(
      input.password,
      user.password,
    );
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    // 3. 全体管理者ブートストラップ（既存アカウントも次回ログインで昇格）
    if (!user.isSuperAdmin && isBootstrapSuperAdminEmail(user.email)) {
      user.promoteToSuperAdmin();
      await this.userRepository.save(user);
    }

    // 4. トークン生成
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    // 5. 出力返却
    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
      },
    };
  }
}

