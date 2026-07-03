import { Inject, Injectable } from '@nestjs/common';
import {
  User,
  UserRepository, USER_REPOSITORY,
  TokenService, TOKEN_SERVICE,
  GoogleVerifierService, GOOGLE_VERIFIER_SERVICE,
  UnauthorizedError,
} from '../../../domain';
import { AcceptInviteUseCase } from '../invite/accept-invite.use-case';

export interface LoginWithGoogleInput {
  idToken: string;
  inviteToken?: string;
}

export interface LoginWithGoogleOutput {
  accessToken: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    isSuperAdmin: boolean;
    avatarUrl: string | null;
  };
  joinedOrganizationId: string | null;
}

/**
 * SUPER_ADMIN_EMAILS に含まれるか判定。
 */
function isBootstrapSuperAdminEmail(email: string): boolean {
  const list = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return list.includes(email.trim().toLowerCase());
}

/**
 * Google ID トークンでログイン/サインアップし、既存と同じ JWT を発行する。
 * inviteToken があればそのまま会社に参加させる。
 */
@Injectable()
export class LoginWithGoogleUseCase {
  constructor(
    @Inject(GOOGLE_VERIFIER_SERVICE) private readonly googleVerifier: GoogleVerifierService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
  ) {}

  async execute(input: LoginWithGoogleInput): Promise<LoginWithGoogleOutput> {
    const profile = await this.googleVerifier.verifyIdToken(input.idToken);
    if (!profile) {
      throw new UnauthorizedError('Google認証に失敗しました');
    }
    if (!profile.emailVerified) {
      throw new UnauthorizedError('Googleアカウントのメールが未確認です');
    }

    let user = await this.userRepository.findByEmail(profile.email);
    if (!user) {
      user = User.createWithGoogle(
        {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
          googleId: profile.googleId,
        },
        this.userRepository.generateId(),
      );
    } else if (!user.googleId) {
      user.linkGoogle(profile.googleId);
      if (!user.avatarUrl && profile.picture) user.changeAvatarUrl(profile.picture);
      if (!user.name && profile.name) user.changeName(profile.name);
    }

    if (!user.isSuperAdmin && isBootstrapSuperAdminEmail(user.email)) {
      user.promoteToSuperAdmin();
    }

    await this.userRepository.save(user);

    let joinedOrganizationId: string | null = null;
    if (input.inviteToken) {
      const result = await this.acceptInviteUseCase.execute({
        token: input.inviteToken,
        userId: user.id,
      });
      joinedOrganizationId = result.organizationId;
    }

    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isSuperAdmin: user.isSuperAdmin,
        avatarUrl: user.avatarUrl,
      },
      joinedOrganizationId,
    };
  }
}
