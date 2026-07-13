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
import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
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

  // GENERAL_USER のとき必須（紐付けプロジェクト）
  @IsOptional()
  @IsString()
  projectId?: string;
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
  private async assertOrgAdmin(userId: string, organizationId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return;
    const member = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
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
    await this.assertOrgAdmin(user.id, dto.organizationId);

    // 一般ユーザーは projectId 必須＋その会社のプロジェクトであること
    let projectId: string | null = null;
    if (dto.role === ApiKeyRole.GENERAL_USER) {
      if (!dto.projectId) {
        throw new BadRequestException('一般ユーザーのキーには projectId（紐付けプロジェクト）が必要です');
      }
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
        select: { organizationId: true },
      });
      if (!project || project.organizationId !== dto.organizationId) {
        throw new BadRequestException('projectId がこの会社のプロジェクトではありません');
      }
      projectId = dto.projectId;
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
      },
    });
    return {
      id: record.id,
      name: record.name,
      role: record.role,
      organizationId: record.organizationId,
      projectId: record.projectId,
      keyPrefix: record.keyPrefix,
      key, // 平文（このレスポンスでのみ）
      createdAt: record.createdAt,
    };
  }

  @Get()
  @ApiOperation({ summary: 'APIキー一覧（平文は含まない）' })
  async list(@CurrentUser() user: CurrentUserPayload) {
    return this.prisma.apiKey.findMany({
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
      },
      orderBy: { createdAt: 'desc' },
    });
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
