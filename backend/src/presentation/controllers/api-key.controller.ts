import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Inject,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsArray, MaxLength } from 'class-validator';
import { ApiKeyRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ApiKeyService } from '../../infrastructure/services/api-key.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';

class CreateApiKeyDto {
  @IsString()
  @MaxLength(100)
  name: string;

  // サービスアカウントのロール（企業管理者=自社フル / 一般ユーザー=紐付けプロジェクトのみ）
  @IsEnum(ApiKeyRole)
  role: ApiKeyRole;

  // 属する会社（キーの中に会社が入る）
  @IsString()
  organizationId: string;

  // GENERAL_USER のとき必須（紐付けプロジェクト・単一）。後方互換のため残す。
  @IsOptional()
  @IsString()
  projectId?: string;

  // GENERAL_USER のとき紐付けプロジェクト（複数可）。projectIds があればこちらを優先。
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  projectIds?: string[];
}

/**
 * 公開API / MCP 用のサービスアカウントAPIキー管理。JWTログイン中のユーザーが、
 * 自分が管理者(OWNER/ADMIN)の会社に対してキーを発行できる。
 *   - COMPANY_ADMIN … その会社の全プロジェクトにフルアクセス
 *   - GENERAL_USER  … その会社のうち projectId に紐付いたプロジェクトのみ
 * 平文キーは作成レスポンスでのみ返す（以後は keyPrefix のみ）。認可は ProjectAccessGuard が判定。
 */
@ApiTags('APIキー')
@ApiBearerAuth()
@Controller('api-keys')
export class ApiKeyController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ApiKeyService) private readonly apiKeyService: ApiKeyService,
  ) {}

  /** 発行者がその会社の管理者（OWNER/ADMIN）か super-admin であることを保証。 */
  private async assertOrgAdmin(user: CurrentUserPayload, organizationId: string): Promise<void> {
    // 会社スコープトークン: 対象会社が違えば即拒否（DB照会不要）。
    if (user.scopeOrgId && user.scopeOrgId !== organizationId) {
      throw new ForbiddenException('この会社を操作する権限がありません');
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { isSuperAdmin: true },
    });
    if (dbUser?.isSuperAdmin) return;
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      select: { role: true },
    });
    if (member && (member.role === 'OWNER' || member.role === 'ADMIN')) return;
    throw new ForbiddenException('この会社のAPIキーを発行する権限がありません（会社の管理者のみ）');
  }

  @Post()
  @ApiOperation({ summary: 'サービスアカウントAPIキーを発行（平文キーは一度だけ返却）' })
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateApiKeyDto) {
    // 会社の存在＋発行者が会社管理者であること
    const org = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
      select: { id: true },
    });
    if (!org) throw new BadRequestException('会社が見つかりません');
    await this.assertOrgAdmin(user, dto.organizationId);

    // 一般ユーザーは紐付けプロジェクト（1つ以上）必須＋すべてその会社のプロジェクトであること。
    let projectId: string | null = null; // 後方互換の単一フィールド（先頭を入れる）
    let linkedProjectIds: string[] = [];
    if (dto.role === ApiKeyRole.GENERAL_USER) {
      // projectIds があればそれを、無ければ単一 projectId を使う（後方互換）。重複・空白は除去。
      const requested =
        dto.projectIds && dto.projectIds.length > 0
          ? dto.projectIds
          : dto.projectId
            ? [dto.projectId]
            : [];
      const ids = [...new Set(requested.map((s) => s.trim()).filter(Boolean))];
      if (ids.length === 0) {
        throw new BadRequestException('一般ユーザーのキーには紐付けプロジェクト（1つ以上）が必要です');
      }
      // すべて実在し、かつこの会社のプロジェクトであることを検証（越境紐付けを防ぐ）。
      const projects = await this.prisma.project.findMany({
        where: { id: { in: ids } },
        select: { id: true, organizationId: true },
      });
      if (
        projects.length !== ids.length ||
        projects.some((p) => p.organizationId !== dto.organizationId)
      ) {
        throw new BadRequestException(
          '紐付けプロジェクトに、この会社以外のものか存在しないものが含まれています',
        );
      }
      linkedProjectIds = ids;
      projectId = ids[0];
    }

    const { key, keyHash, keyPrefix } = this.apiKeyService.generate();
    const record = await this.prisma.apiKey.create({
      data: {
        userId: user.id,
        organizationId: dto.organizationId,
        role: dto.role,
        projectId,
        name: dto.name,
        keyHash,
        keyPrefix,
        ...(linkedProjectIds.length > 0
          ? { projects: { create: linkedProjectIds.map((pid) => ({ projectId: pid })) } }
          : {}),
      },
    });
    return {
      id: record.id,
      name: record.name,
      role: record.role,
      organizationId: record.organizationId,
      projectId: record.projectId,
      projectIds: linkedProjectIds,
      keyPrefix: record.keyPrefix,
      key, // 平文（このレスポンスでのみ）
      createdAt: record.createdAt,
    };
  }

  @Get()
  @ApiOperation({ summary: 'APIキー一覧（平文は含まない）' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId: user.id, revokedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        organizationId: true,
        projectId: true,
        keyPrefix: true,
        lastUsedAt: true,
        createdAt: true,
        projects: { select: { projectId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // projectIds は結合テーブル優先、無ければ旧来の単一 projectId にフォールバック（後方互換）。
    return keys.map(({ projects, ...k }) => ({
      ...k,
      projectIds:
        projects.length > 0
          ? projects.map((p) => p.projectId)
          : k.projectId
            ? [k.projectId]
            : [],
    }));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'APIキーを失効' })
  async revoke(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.prisma.apiKey.updateMany({
      where: { id, userId: user.id },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }
}
