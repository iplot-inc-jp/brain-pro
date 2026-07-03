import { Inject, Injectable } from '@nestjs/common';
import {
  Organization,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  UserRepository,
  USER_REPOSITORY,
  EntityAlreadyExistsError,
  EntityNotFoundError,
} from '../../../domain';

export interface CreateOrganizationInput {
  userId: string;
  name: string;
  slug: string;
  description?: string;
}

export interface CreateOrganizationOutput {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

/**
 * 組織作成ユースケース
 */
@Injectable()
export class CreateOrganizationUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepository: UserRepository,
  ) {}

  async execute(input: CreateOrganizationInput): Promise<CreateOrganizationOutput> {
    // 0. 作成者ユーザーの存在確認（認証済みユーザーは誰でも会社を作成でき、
    //    作成者は下記ステップ5で自動的に OWNER メンバーになる＝セルフサーブ）
    const actor = await this.userRepository.findById(input.userId);
    if (!actor) {
      throw new EntityNotFoundError('User', input.userId);
    }

    // 1. スラッグ重複チェック
    const exists = await this.organizationRepository.existsBySlug(input.slug);
    if (exists) {
      throw new EntityAlreadyExistsError('Organization', 'slug', input.slug);
    }

    // 2. ID生成
    const id = this.organizationRepository.generateId();

    // 3. 組織エンティティ生成（ドメインロジック）
    const organization = Organization.create(
      {
        name: input.name,
        slug: input.slug,
        description: input.description,
      },
      id,
    );

    // 4. 永続化
    await this.organizationRepository.save(organization);

    // 5. 作成者をオーナーとして追加
    await this.organizationRepository.addMember(organization.id, {
      userId: input.userId,
      role: 'OWNER',
    });

    // 6. 出力返却
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      description: organization.description,
    };
  }
}

