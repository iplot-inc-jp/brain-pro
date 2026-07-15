import { Inject, Injectable } from '@nestjs/common';
import { ApiKeyRole } from '@prisma/client';
import {
  Project,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityAlreadyExistsError,
  ForbiddenError,
} from '../../../domain';
import { AccessPrincipal } from '../../../infrastructure/services/project-access.service';

export interface CreateProjectInput {
  userId: string;
  // リクエスト主体（JWTユーザー / サービスアカウントAPIキー / 管理者発行の会社スコープトークン）。
  // route param :organizationId はガードでスコープ強制されないため、ここで越境を弾く。
  principal: AccessPrincipal;
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
}

export interface CreateProjectOutput {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * プロジェクト作成ユースケース
 */
@Injectable()
export class CreateProjectUseCase {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateProjectInput): Promise<CreateProjectOutput> {
    // 0. 会社スコープ越境防止（route param :organizationId はガードで強制されない）。
    //    通常ユーザー（scopeOrgId 無し・apiKey 無し）は素通りで従来どおり isMember に委ねる。
    this.assertCreateOrgScope(input.principal, input.organizationId);

    // 1. 組織へのアクセス権確認（defense-in-depth: 会社スコープ通過後も発行ユーザーの会員性を要求）
    const isMember = await this.organizationRepository.isMember(
      input.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 2. スラッグ重複チェック（組織内）
    const exists = await this.projectRepository.existsByOrganizationIdAndSlug(
      input.organizationId,
      input.slug,
    );
    if (exists) {
      throw new EntityAlreadyExistsError('Project', 'slug', input.slug);
    }

    // 3. ID生成
    const id = this.projectRepository.generateId();

    // 4. プロジェクトエンティティ生成（ドメインロジック）
    const project = Project.create(
      {
        organizationId: input.organizationId,
        name: input.name,
        slug: input.slug,
        description: input.description,
      },
      id,
    );

    // 5. 永続化
    await this.projectRepository.save(project);

    // 6. 出力返却
    return {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  /**
   * route param :organizationId に対する主体の会社スコープ検査（越境拒否）。
   * ProjectAccessGuard は projectId 非依存ルートを素通りさせるため、ここで自前強制する。
   *   - 管理者発行の会社スコープトークン（scopeOrgId）… 対象組織が一致必須。
   *   - サービスアカウントAPIキー（会社が紐付いた新スコープキー = organizationId 設定済み）…
   *       COMPANY_ADMIN は自社のみ作成可、GENERAL_USER は作成不可（紐付けプロジェクトのみ操作可のキー）。
   *   - それ以外（通常ユーザー / organizationId 未設定の旧APIキー）… 素通り（従来どおり isMember に委ねる）。
   */
  private assertCreateOrgScope(
    principal: AccessPrincipal,
    organizationId: string,
  ): void {
    // 管理者発行トークンの会社スコープ: 対象組織が一致必須。
    if (principal.scopeOrgId && principal.scopeOrgId !== organizationId) {
      throw new ForbiddenError(
        'This token cannot access the specified organization',
      );
    }
    // サービスアカウントAPIキー（会社紐付けありの新スコープキーのみ判定。
    // organizationId 未設定＝移行前の旧キーは発行者権限に委ねるため素通り）。
    if (principal.apiKeyRole && principal.organizationId) {
      if (principal.apiKeyRole === ApiKeyRole.COMPANY_ADMIN) {
        if (principal.organizationId !== organizationId) {
          throw new ForbiddenError(
            'This API key cannot create projects in the specified organization',
          );
        }
      } else {
        // GENERAL_USER: 紐付けプロジェクトのみ操作可のキー。プロジェクト作成は不可。
        throw new ForbiddenError(
          'This API key is not permitted to create projects',
        );
      }
    }
  }
}

