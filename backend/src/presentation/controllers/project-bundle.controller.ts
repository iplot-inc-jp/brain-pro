import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Inject,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsIn } from 'class-validator';
import {
  ProjectBundleService,
  ProjectBundle,
  ImportMode,
} from '../../infrastructure/services/project-bundle.service';
import { ApiKeyRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import {
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  ForbiddenError,
  EntityNotFoundError,
} from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { Public } from '../decorators/public.decorator';

// ========== DTOs ==========

class ImportIntoProjectDto {
  @IsObject()
  bundle: ProjectBundle;

  @IsOptional()
  @IsIn(['replace', 'merge'])
  mode?: ImportMode;
}

class ImportNewProjectDto {
  @IsObject()
  bundle: ProjectBundle;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['replace', 'merge'])
  mode?: ImportMode;
}

// slug 化（英数とハイフン）。衝突時は後段でサフィックス付与。
function slugify(input: string): string {
  const base = (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return base || 'imported-project';
}

/**
 * 既存プロジェクト配下への export / import。
 * GET  /api/projects/:projectId/export  （view）
 * POST /api/projects/:projectId/import  （edit）
 */
@ApiTags('プロジェクトバンドル')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId')
export class ProjectBundleController {
  constructor(private readonly bundleService: ProjectBundleService) {}

  @Get('export')
  @ApiOperation({
    summary: 'プロジェクト全体エクスポート（独自JSONバンドル）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: 'バンドルJSON' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async export(
    @Param('projectId') projectId: string,
  ): Promise<ProjectBundle> {
    const bundle = await this.bundleService.export(projectId);
    return { ...bundle, exportedAt: new Date().toISOString() };
  }

  @Post('import')
  @ApiOperation({
    summary:
      'このプロジェクトへバンドルを取り込み（mode: replace=全消し再構築 / merge=追加）',
  })
  @ApiParam({ name: 'projectId', description: '取り込み先プロジェクトID' })
  @ApiResponse({ status: 201, description: '取り込んだ section ごとの件数サマリ' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async import(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: ImportIntoProjectDto,
  ) {
    const mode: ImportMode = dto.mode ?? 'merge';
    return this.bundleService.import(projectId, dto.bundle, mode, user.id);
  }
}

/**
 * 組織配下に「新規プロジェクトを作成して取り込み」。
 * POST /api/organizations/:organizationId/projects/import （組織メンバー認可）
 */
@ApiTags('プロジェクトバンドル')
@ApiBearerAuth()
@Controller('organizations/:organizationId/projects')
export class OrganizationProjectImportController {
  constructor(
    private readonly bundleService: ProjectBundleService,
    private readonly prisma: PrismaService,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  @Post('import')
  @ApiOperation({
    summary: '新規プロジェクトを作成してバンドルを取り込み',
  })
  @ApiParam({ name: 'organizationId', description: '取り込み先組織ID' })
  @ApiResponse({ status: 201, description: '作成したプロジェクトと件数サマリ' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async importNew(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: ImportNewProjectDto,
  ) {
    // 会社スコープ越境防止（route param :organizationId はガードで強制されない）。
    // 通常ユーザー（scopeOrgId 無し・apiKey 無し）は素通りで従来どおり isMember に委ねる。
    this.assertCreateOrgScope(user, organizationId);
    // 組織メンバー（または super-admin）のみ。isMember は super-admin を許可する。
    const isMember = await this.organizationRepository.isMember(
      organizationId,
      user.id,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new EntityNotFoundError('Organization', organizationId);
    }

    const name =
      (dto.name?.trim() || dto.bundle?.project?.name || 'Imported Project').slice(
        0,
        200,
      );

    // slug は (organizationId, slug) ユニーク。衝突時はサフィックスでリネーム。
    const baseSlug = slugify(dto.bundle?.project?.slug || name);
    let slug = baseSlug;
    for (let i = 2; i < 1000; i++) {
      const exists = await this.prisma.project.findFirst({
        where: { organizationId, slug },
        select: { id: true },
      });
      if (!exists) break;
      slug = `${baseSlug}-${i}`;
    }

    const created = await this.prisma.project.create({
      data: {
        organizationId,
        name,
        slug,
        description: dto.bundle?.project?.description ?? null,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
        description: true,
      },
    });

    // import は内部で別トランザクションを張る。project.create はその外なので、
    // import が失敗（FK 解決不能 / タイムアウト / 検証エラー等）すると「中身が空の
    // プロジェクト」が孤立して残る。失敗時は作成したプロジェクトを補償削除する
    // （配下リレーションは onDelete: Cascade で消える）。
    // 新規プロジェクトなので merge / replace は実質同じ。merge で取り込む。
    let result;
    try {
      result = await this.bundleService.import(
        created.id,
        dto.bundle,
        'merge',
        user.id,
      );
    } catch (err) {
      try {
        await this.prisma.project.delete({ where: { id: created.id } });
      } catch {
        // 補償削除に失敗してもオリジナルのエラーを優先して投げる。
      }
      throw err;
    }

    return { project: created, import: result };
  }

  /**
   * route param :organizationId に対する主体の会社スコープ検査（越境拒否）。
   * ProjectAccessGuard は projectId 非依存ルートを素通りさせるため、ここで自前強制する
   * （create-project.use-case.ts の assertCreateOrgScope と同一ポリシー）。
   */
  private assertCreateOrgScope(
    principal: CurrentUserPayload,
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

/**
 * 機械可読 JSON Schema（draft-07）。AI が事前に形式取得できるよう @Public。
 * GET /api/export-schema
 */
@ApiTags('プロジェクトバンドル')
@Controller('export-schema')
export class ExportSchemaController {
  constructor(private readonly bundleService: ProjectBundleService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'プロジェクトバンドルの機械可読 JSON Schema（draft-07）',
  })
  @ApiResponse({ status: 200, description: 'JSON Schema' })
  getSchema(): Record<string, unknown> {
    return this.bundleService.getBundleSchema();
  }
}
