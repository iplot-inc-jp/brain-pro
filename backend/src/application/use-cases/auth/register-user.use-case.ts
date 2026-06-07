import { Inject, Injectable } from '@nestjs/common';
import {
  User,
  UserRepository,
  USER_REPOSITORY,
  PasswordHashService,
  PASSWORD_HASH_SERVICE,
  TokenService,
  TOKEN_SERVICE,
  EntityAlreadyExistsError,
} from '../../../domain';

export interface RegisterUserInput {
  email: string;
  password: string;
  name?: string;
}

export interface RegisterUserOutput {
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
 * ユーザー登録ユースケース
 * オーケストレーションのみ、ビジネスロジックはドメイン層に委譲
 */
@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
    @Inject(PASSWORD_HASH_SERVICE)
    private readonly passwordHashService: PasswordHashService,
    @Inject(TOKEN_SERVICE)
    private readonly tokenService: TokenService,
  ) {}

  async execute(input: RegisterUserInput): Promise<RegisterUserOutput> {
    // 1. パスワードハッシュ化（インフラサービス）
    const hashedPassword = await this.passwordHashService.hash(input.password);

    // 2. 既存ユーザー確認：招待枠（パスワード未設定）なら引き継ぎ、本登録済みなら重複エラー
    const existing = await this.userRepository.findByEmail(input.email);
    let user: User;
    if (existing) {
      if (existing.password) {
        throw new EntityAlreadyExistsError('User', 'email', input.email);
      }
      // 招待ユーザーを本登録（パスワード・氏名を設定）
      existing.changePassword(hashedPassword);
      if (input.name) existing.changeName(input.name);
      user = existing;
    } else {
      const id = this.userRepository.generateId();
      user = User.create(
        { email: input.email, password: input.password, name: input.name },
        hashedPassword,
        id,
      );
    }

    // 3. 全体管理者ブートストラップ（SUPER_ADMIN_EMAILS）
    if (!user.isSuperAdmin && isBootstrapSuperAdminEmail(user.email)) {
      user.promoteToSuperAdmin();
    }

    // 4. 永続化
    await this.userRepository.save(user);

    // 7. トークン生成
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    // 8. 出力DTO返却
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

