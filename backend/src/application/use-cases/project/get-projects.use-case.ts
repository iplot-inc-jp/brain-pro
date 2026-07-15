import { Inject, Injectable } from '@nestjs/common';
import { ApiKeyRole } from '@prisma/client';
import {
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  ForbiddenError,
} from '../../../domain';
import { AccessPrincipal } from '../../../infrastructure/services/project-access.service';

export interface GetProjectsInput {
  userId: string;
  // リクエスト主体（JWTユーザー / サービスアカウントAPIキー / 管理者発行の会社スコープトークン）。
  // route param :organizationId はガードでスコープ強制されないため、ここで越境を弾く。
  principal: AccessPrincipal;
  organizationId: string;
}

export interface ProjectDto {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * プロジェクト一覧取得ユースケース
 */
@Injectable()
export class GetProjectsUseCase {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetProjectsInput): Promise<ProjectDto[]> {
    // 0. 会社スコープ越境防止（route param :organizationId はガードで強制されない）。
    //    通常ユーザー（scopeOrgId 無し・apiKey 無し）は素通りで従来どおり isMember に委ねる。
    this.assertListOrgScope(input.principal, input.organizationId);

    // 1. 組織へのアクセス権確認（defense-in-depth）
    const isMember = await this.organizationRepository.isMember(
      input.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 2. プロジェクト一覧取得
    const projects = await this.projectRepository.findByOrganizationId(
      input.organizationId,
    );

    // 3. GENERAL_USER キー（紐付けプロジェクトのみ操作可）は結果を紐付け分だけに絞る。
    const visible = this.filterForPrincipal(input.principal, projects);

    // 4. DTOに変換して返却
    return visible.map((project) => ({
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  }

  /**
   * route param :organizationId に対する主体の会社スコープ検査（越境拒否）。
   *   - 管理者発行の会社スコープトークン（scopeOrgId）… 対象組織が一致必須。
   *   - サービスアカウントAPIキー（会社紐付けありの新スコープキー）… キーの会社が一致必須
   *     （COMPANY_ADMIN / GENERAL_USER とも他社の一覧は取得不可）。
   *   - それ以外（通常ユーザー / organizationId 未設定の旧APIキー）… 素通り。
   */
  private assertListOrgScope(
    principal: AccessPrincipal,
    organizationId: string,
  ): void {
    if (principal.scopeOrgId && principal.scopeOrgId !== organizationId) {
      throw new ForbiddenError(
        'This token cannot access the specified organization',
      );
    }
    if (
      principal.apiKeyRole &&
      principal.organizationId &&
      principal.organizationId !== organizationId
    ) {
      throw new ForbiddenError(
        'This API key cannot access the specified organization',
      );
    }
  }

  /**
   * GENERAL_USER サービスアカウントキー（会社紐付けありの新スコープキー）は、
   * 紐付いたプロジェクト（projectIds、空なら単一 projectId にフォールバック）だけを返す。
   * それ以外の主体は絞り込みなし。
   */
  private filterForPrincipal<T extends { id: string }>(
    principal: AccessPrincipal,
    projects: T[],
  ): T[] {
    if (
      principal.apiKeyRole === ApiKeyRole.GENERAL_USER &&
      principal.organizationId
    ) {
      const linkedIds = new Set(
        principal.projectIds && principal.projectIds.length > 0
          ? principal.projectIds
          : principal.projectId
            ? [principal.projectId]
            : [],
      );
      return projects.filter((project) => linkedIds.has(project.id));
    }
    return projects;
  }
}

