import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { ForbiddenError, ValidationError } from '../../domain';

class UpdateIproBotConnectionDto {
  @IsOptional() @IsString() baseUrl?: string;
  @IsOptional() @IsString() apiToken?: string; // 空/未指定なら変更しない（伏字運用）
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() strict?: boolean;
}

interface IproBotConnectionView {
  configured: boolean;
  baseUrl?: string;
  enabled?: boolean;
  strict?: boolean;
  hasApiToken?: boolean;
}

// 組織ごとの ipro-bot AIゲートウェイ接続設定。会社管理者（superAdmin/OWNER/ADMIN）のみ。
@ApiTags('ipro-bot連携')
@ApiBearerAuth()
@Controller('organizations/:organizationId/ipro-bot')
export class IproBotConnectionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async assertCompanyAdmin(organizationId: string, user: CurrentUserPayload): Promise<void> {
    // 会社スコープトークン: 対象会社が違えば即拒否（DB照会不要）。
    if (user.scopeOrgId && user.scopeOrgId !== organizationId) {
      throw new ForbiddenError('この会社を管理する権限がありません');
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
    if (member && (member.role === 'OWNER' || member.role === 'ADMIN')) {
      return;
    }
    throw new ForbiddenError('この会社を管理する権限がありません');
  }

  private toView(
    conn: { baseUrl: string; apiTokenEnc: string; enabled: boolean; strict: boolean } | null,
  ): IproBotConnectionView {
    if (!conn) return { configured: false };
    return {
      configured: true,
      baseUrl: conn.baseUrl,
      enabled: conn.enabled,
      strict: conn.strict,
      hasApiToken: !!conn.apiTokenEnc,
    };
  }

  @Get()
  @ApiOperation({ summary: 'ipro-bot 接続設定を取得（秘密は返さない）' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
  ): Promise<IproBotConnectionView> {
    await this.assertCompanyAdmin(organizationId, user);
    const conn = await this.prisma.iproBotConnection.findUnique({ where: { organizationId } });
    return this.toView(conn);
  }

  @Put()
  @ApiOperation({ summary: 'ipro-bot 接続設定を作成/更新（apiToken は空なら変更しない）' })
  async upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: UpdateIproBotConnectionDto,
  ): Promise<IproBotConnectionView> {
    await this.assertCompanyAdmin(organizationId, user);
    const existing = await this.prisma.iproBotConnection.findUnique({ where: { organizationId } });
    if (!existing && (!dto.baseUrl || !dto.apiToken)) {
      throw new ValidationError('初回設定には baseUrl と apiToken が必要です');
    }
    // 保存済みトークンの流出防止: baseUrl だけ差し替えると、伏字で見えないトークンが
    // 新URL（攻撃者サーバー含む）へ Bearer 送信されてしまうため、URL変更時は再入力を必須にする。
    if (existing && dto.baseUrl !== undefined && dto.baseUrl !== existing.baseUrl && !dto.apiToken) {
      throw new ValidationError('ゲートウェイURLを変更する場合は apiToken の再入力が必要です');
    }

    const tokenUpdate = dto.apiToken ? { apiTokenEnc: this.crypto.encrypt(dto.apiToken) } : {};
    const saved = await this.prisma.iproBotConnection.upsert({
      where: { organizationId },
      update: {
        ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.strict !== undefined ? { strict: dto.strict } : {}),
        ...tokenUpdate,
      },
      create: {
        organizationId,
        baseUrl: dto.baseUrl!,
        apiTokenEnc: this.crypto.encrypt(dto.apiToken!),
        enabled: dto.enabled ?? true,
        strict: dto.strict ?? false,
      },
    });
    return this.toView(saved);
  }

  @Post('test')
  @ApiOperation({ summary: '接続テスト（ipro-bot の /api/ai/health を叩く）' })
  async test(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
  ): Promise<{ ok: boolean; detail?: string; error?: string }> {
    await this.assertCompanyAdmin(organizationId, user);
    const conn = await this.prisma.iproBotConnection.findUnique({ where: { organizationId } });
    if (!conn) return { ok: false, error: '未設定です' };
    try {
      const res = await fetch(`${conn.baseUrl.replace(/\/$/, '')}/api/ai/health`, {
        headers: { Authorization: `Bearer ${this.crypto.decrypt(conn.apiTokenEnc)}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as { ok?: boolean; companyId?: string };
      return { ok: true, detail: `companyId=${data.companyId ?? '不明'}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
