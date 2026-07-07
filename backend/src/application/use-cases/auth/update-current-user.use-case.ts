import { Inject, Injectable } from '@nestjs/common';
import {
  UserRepository,
  USER_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';

export interface UpdateCurrentUserInput {
  userId: string;
  /** 表示名。undefined=変更しない。null/空=未設定。 */
  name?: string | null;
  /** プロフィールアイコンURL（またはdata URL）。undefined=変更しない。null/空=頭文字デフォルトに戻す。 */
  avatarUrl?: string | null;
}

export interface UpdateCurrentUserOutput {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/**
 * 現在ログイン中ユーザーのプロフィール（表示名・アイコン）を更新するユースケース。
 */
@Injectable()
export class UpdateCurrentUserUseCase {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
  ) {}

  async execute(
    input: UpdateCurrentUserInput,
  ): Promise<UpdateCurrentUserOutput> {
    const user = await this.userRepository.findById(input.userId);
    if (!user) {
      throw new EntityNotFoundError('User', input.userId);
    }

    if (input.name !== undefined) {
      user.changeName(input.name);
    }
    if (input.avatarUrl !== undefined) {
      user.changeAvatarUrl(input.avatarUrl);
    }

    await this.userRepository.save(user);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
  }
}
