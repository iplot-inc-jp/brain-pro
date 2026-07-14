import { Injectable } from '@nestjs/common';
import { ApiKeyRole } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { ForbiddenError } from '../../domain';

/** サービスアカウントAPIキーのスコープ（会社・ロール・紐付けプロジェクト）。 */
export interface ApiKeyScope {
  apiKeyRole: ApiKeyRole;
  organizationId: string | null;
  projectId: string | null;
  // GENERAL_USER キーが紐付く全プロジェクト（複数可）。空/未指定なら projectId（単一）にフォールバック。
  projectIds?: string[] | null;
}

/**
 * リクエストの主体（JWTユーザー or サービスアカウントAPIキー）。
 * apiKeyRole があればサービスアカウント。organizationId は紐付いた会社（旧キーは未設定）。
 */
export interface AccessPrincipal {
  id: string;
  apiKeyRole?: ApiKeyRole | null;
  organizationId?: string | null;
  projectId?: string | null;
  projectIds?: string[] | null;
  // 会社スコープ（管理者発行の user-api トークン）。あれば対象プロジェクトの会社と一致必須（越境拒否）。
  scopeOrgId?: string | null;
}

/**
 * プロジェクト単位の実効アクセスレベル。
 *   EDIT … view / edit 両方を満たす
 *   VIEW … view のみ満たす
 */
export type ProjectAccessLevelValue = 'EDIT' | 'VIEW';

/** 要求レベル（エンドポイントが必要とする権限） */
export type RequiredAccess = 'view' | 'edit';

/**
 * プロジェクト単位ユーザー権限（RBAC）の実効権限を解決するサービス。
 *
 * resolveProjectAccess(projectId, userId) のポリシー:
 *   1. project が無ければ null。
 *   2. user.isSuperAdmin が true なら EDIT。
 *   3. その org の OrganizationMember.role が OWNER か ADMIN なら EDIT。
 *   4. ProjectMember 行数(projectId) を数える:
 *      - 0件 → 後方互換: その user が org メンバーなら EDIT、でなければ null。
 *      - 1件以上 → (projectId,userId) の ProjectMember があれば accessLevel、無ければ null。
 *
 * 重要・後方互換: ProjectMember 行が無いプロジェクトでは全 org メンバーが EDIT。
 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 実効アクセスレベル（EDIT/VIEW/null）を返す。
   */
  async resolveProjectAccess(
    projectId: string,
    userId: string,
  ): Promise<ProjectAccessLevelValue | null> {
    // 1. project が無ければ null
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) return null;

    // 2. super-admin は EDIT
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return 'EDIT';

    // 3. その org の OWNER / ADMIN は EDIT
    const orgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
      select: { role: true },
    });
    if (orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN')) {
      return 'EDIT';
    }

    // 4. ProjectMember 行数で分岐
    const memberCount = await this.prisma.projectMember.count({
      where: { projectId },
    });

    if (memberCount === 0) {
      // 後方互換: org メンバーなら EDIT、でなければ null
      return orgMember ? 'EDIT' : null;
    }

    // 1件以上: 明示掲載があればその accessLevel、無ければ権限なし
    const projectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId, userId },
      },
      select: { accessLevel: true },
    });
    if (!projectMember) return null;
    return projectMember.accessLevel as ProjectAccessLevelValue;
  }

  /**
   * サービスアカウントAPIキーの実効アクセスレベル（EDIT/VIEW/null）を返す。
   * 発行ユーザーの会員権限には依存せず、キー自身の会社・ロール・紐付けだけで判定する。
   *   - 他社のプロジェクト … 常に null（越境不可）
   *   - COMPANY_ADMIN     … 自社の全プロジェクトで EDIT
   *   - GENERAL_USER      … 紐付いたプロジェクト（複数可）のみ EDIT、それ以外は null
   */
  async resolveApiKeyProjectAccess(
    scope: ApiKeyScope,
    targetProjectId: string,
  ): Promise<ProjectAccessLevelValue | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: targetProjectId },
      select: { organizationId: true },
    });
    if (!project) return null;
    if (!scope.organizationId || project.organizationId !== scope.organizationId) {
      return null; // 会社が違う（またはキーに会社が無い）
    }
    if (scope.apiKeyRole === ApiKeyRole.COMPANY_ADMIN) return 'EDIT';
    // GENERAL_USER: 紐付いたプロジェクトだけ（複数可）。結合が空なら旧来の単一 projectId にフォールバック。
    const linked =
      scope.projectIds && scope.projectIds.length > 0
        ? scope.projectIds
        : scope.projectId
          ? [scope.projectId]
          : [];
    if (linked.includes(targetProjectId)) return 'EDIT';
    return null;
  }

  /**
   * リクエスト主体（ユーザー or APIキー）の実効アクセスレベルを解決する。
   * これが「JWTユーザーは会員RBAC / サービスアカウントはキーのスコープ」を判定する唯一の入口で、
   * ガード（プロジェクト配下ルート）と by-id コントローラの両方がここを通す（＝スコープ判定が二重実装で食い違わない）。
   *
   * ★後方互換: apiKeyRole はあるが organizationId 未設定のキー（サービスアカウント化の移行前から
   *   存在する旧キー）は、発行者の会員権限にフォールバックする（＝移行前と同じ挙動）。
   *   これを入れないと、移行で全既存キーが role=GENERAL_USER / org=NULL になり、保護ルートで一律 403 になる。
   *   不変条件: 新規キーの発行（api-key.controller の create）は organizationId を必須にしているので、
   *   organizationId 未設定＝移行前の旧キーだけ。新しいスコープ付きキーがこのフォールバックに落ちて
   *   発行者権限に fail-open することはない（＝スコープ境界は緩まない）。
   */
  async resolveForPrincipal(
    principal: AccessPrincipal,
    targetProjectId: string,
  ): Promise<ProjectAccessLevelValue | null> {
    if (principal.apiKeyRole && principal.organizationId) {
      return this.resolveApiKeyProjectAccess(
        {
          apiKeyRole: principal.apiKeyRole,
          organizationId: principal.organizationId,
          projectId: principal.projectId ?? null,
          projectIds: principal.projectIds ?? null,
        },
        targetProjectId,
      );
    }
    // 会社スコープ（管理者発行トークン）: 対象プロジェクトの会社が scopeOrgId と違えば越境拒否。
    // ここで先に弾くことで、以降の live RBAC は「発行会社のプロジェクト」だけに効く。
    if (principal.scopeOrgId) {
      const project = await this.prisma.project.findUnique({
        where: { id: targetProjectId },
        select: { organizationId: true },
      });
      if (!project || project.organizationId !== principal.scopeOrgId) return null;
    }
    // 通常ユーザー、または organization 未設定の旧APIキー（発行者権限にフォールバック）。
    return this.resolveProjectAccess(targetProjectId, principal.id);
  }

  /**
   * 必要レベルを満たさなければ ForbiddenError を throw。
   *   required='view' … EDIT または VIEW で充足
   *   required='edit' … EDIT のみ充足
   */
  async assertProjectAccess(
    projectId: string,
    userId: string,
    required: RequiredAccess,
  ): Promise<void> {
    const level = await this.resolveProjectAccess(projectId, userId);
    if (this.satisfies(level, required)) return;
    throw new ForbiddenError(
      required === 'edit'
        ? 'You do not have edit access to this project'
        : 'You do not have access to this project',
    );
  }

  /**
   * resolveForPrincipal 版の assert（主体がユーザーでもAPIキーでも正しくスコープ判定する）。
   * by-id ルート（URL に projectId が無く、行から projectId を解決するルート）はこれを使うこと。
   */
  async assertPrincipalAccess(
    principal: AccessPrincipal,
    targetProjectId: string,
    required: RequiredAccess,
  ): Promise<void> {
    const level = await this.resolveForPrincipal(principal, targetProjectId);
    if (this.satisfies(level, required)) return;
    throw new ForbiddenError(
      required === 'edit'
        ? 'You do not have edit access to this project'
        : 'You do not have access to this project',
    );
  }

  /**
   * 実効レベルが要求レベルを満たすか。
   */
  satisfies(
    level: ProjectAccessLevelValue | null,
    required: RequiredAccess,
  ): boolean {
    if (level === 'EDIT') return true;
    if (level === 'VIEW') return required === 'view';
    return false;
  }

  /**
   * メンバー管理の管理者ゲート。
   * super-admin、または その org の OWNER/ADMIN なら true。
   */
  async isProjectAdmin(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) return false;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return true;

    const orgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
      select: { role: true },
    });
    return !!orgMember && (orgMember.role === 'OWNER' || orgMember.role === 'ADMIN');
  }
}
