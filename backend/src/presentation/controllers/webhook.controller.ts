import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  IsUrl,
} from 'class-validator';
import { Prisma, Webhook } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { JobService } from '../../infrastructure/services/job.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import {
  assertSafeOutboundUrl,
  UnsafeUrlError,
} from '../../infrastructure/services/url-safety';

/** 購読可能なタスクイベントの許可リスト（DTO バリデーションに使用）。 */
const WEBHOOK_EVENTS = [
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.deleted',
] as const;

// ========== DTOs ==========
class CreateWebhookDto {
  @IsString()
  @IsUrl({ require_tld: false })
  targetUrl: string;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsArray()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events: string[];

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  targetUrl?: string;

  /**
   * secret の扱い:
   *   - 省略（undefined） … 変更なし
   *   - 空文字 ''        … 変更なし（誤クリア防止）
   *   - null             … 署名シークレットを解除
   *   - 非空文字列        … 再暗号化して差し替え
   */
  @IsOptional()
  @IsString()
  secret?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events?: string[];

  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

/**
 * タスク Webhook（outbound）の管理 API。
 *
 * 方向は Brain Pro → 外部（ipro-kun 等）。実際の配信は JobService の
 * WEBHOOK_DELIVERY ジョブが行い、ここはあくまで設定 CRUD とテスト起票を担う。
 *
 * 認可: @ProjectScopedAccess で view/edit を担保したうえで、CRUD/一覧/test は
 * すべて「プロジェクト管理者(isProjectAdmin)」に限定する（外部送信の設定は管理者ゲート）。
 * /webhooks/:id 系は params に projectId が無く ProjectAccessGuard が素通りするため、
 * Webhook から projectId を引いて明示的に admin チェックする。
 *
 * 秘匿情報: secret はレスポンスで返さない（hasSecret:boolean のみ）。
 */
@ApiTags('タスクWebhook')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jobService: JobService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('projects/:projectId/webhooks')
  @ApiOperation({ summary: 'プロジェクトのWebhook一覧（secretは返さない）' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await this.assertAdmin(projectId, user);
    const webhooks = await this.prisma.webhook.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return webhooks.map((w) => this.toResponse(w));
  }

  @Post('projects/:projectId/webhooks')
  @ApiOperation({ summary: 'Webhookを作成（secretは暗号化して保存）' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWebhookDto,
  ) {
    await this.assertAdmin(projectId, user);
    await this.assertSafeTargetUrl(dto.targetUrl);
    const secretEnc =
      dto.secret && dto.secret.length > 0
        ? this.crypto.encrypt(dto.secret)
        : null;

    const webhook = await this.prisma.webhook.create({
      data: {
        projectId,
        targetUrl: dto.targetUrl,
        secretEnc,
        events: dto.events as unknown as Prisma.InputJsonValue,
        label: dto.label ?? null,
        active: dto.active ?? true,
      },
    });
    return this.toResponse(webhook);
  }

  @Patch('webhooks/:id')
  @ApiOperation({ summary: 'Webhookを更新（secret空文字は変更なし・明示nullで解除）' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateWebhookDto,
  ) {
    const existing = await this.requireWebhook(id);
    await this.assertAdmin(existing.projectId, user);
    if (dto.targetUrl !== undefined) {
      await this.assertSafeTargetUrl(dto.targetUrl);
    }

    const data: Prisma.WebhookUpdateInput = {};
    if (dto.targetUrl !== undefined) data.targetUrl = dto.targetUrl;
    if (dto.events !== undefined) {
      data.events = dto.events as unknown as Prisma.InputJsonValue;
    }
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.active !== undefined) data.active = dto.active;
    // secret: 省略/空文字は変更なし、明示 null で解除、非空文字列で再暗号化。
    if (dto.secret === null) {
      data.secretEnc = null;
    } else if (typeof dto.secret === 'string' && dto.secret.length > 0) {
      data.secretEnc = this.crypto.encrypt(dto.secret);
    }

    const webhook = await this.prisma.webhook.update({ where: { id }, data });
    return this.toResponse(webhook);
  }

  @Delete('webhooks/:id')
  @ApiOperation({ summary: 'Webhookを削除' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const existing = await this.requireWebhook(id);
    await this.assertAdmin(existing.projectId, user);
    await this.prisma.webhook.delete({ where: { id } });
    return { success: true };
  }

  @Post('webhooks/:id/test')
  @ApiOperation({ summary: 'テスト配信を1件起票（動作確認用）' })
  async test(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const webhook = await this.requireWebhook(id);
    await this.assertAdmin(webhook.projectId, user);

    // 内部発火のみ（外部からは type 許可リストに無いため直接 enqueue 不可）。
    const job = await this.jobService.enqueue(
      'WEBHOOK_DELIVERY',
      {
        webhookId: webhook.id,
        event: 'task.updated',
        occurredAt: new Date().toISOString(),
        task: {
          id: 'test',
          projectId: webhook.projectId,
          title: 'Webhook テスト配信',
          status: 'OPEN',
          priority: 'MEDIUM',
          assigneeName: null,
          dueDate: null,
        },
      },
      { projectId: webhook.projectId, createdById: user.id },
    );
    return { jobId: job.id, status: job.status };
  }

  // ========== Private Methods ==========

  /**
   * プロジェクト管理者ゲート。主体（ユーザー or サービスアカウント）のスコープを効かせたうえで
   * 管理者権限を要求する。
   *
   * /webhooks/:id 系は URL に projectId が無く ProjectAccessGuard が素通りするため、
   *   1. assertPrincipalAccess で scopeOrgId 越境拒否 + apiKey（org/projectIds）スコープの
   *      カバレッジ + RBAC(edit) を強制し（isProjectAdmin だけでは無視されるスコープを効かせる）、
   *   2. さらに isProjectAdmin で OWNER/ADMIN（or super-admin）の管理者ゲートを課す。
   */
  private async assertAdmin(
    projectId: string,
    principal: CurrentUserPayload,
  ): Promise<void> {
    // (a) scopeOrgId 越境拒否 + (b) apiKey スコープ（org/projectIds）カバレッジ + RBAC。
    await this.projectAccess.assertPrincipalAccess(principal, projectId, 'edit');
    const isAdmin = await this.projectAccess.isProjectAdmin(
      projectId,
      principal.id,
    );
    if (!isAdmin) {
      throw new HttpException(
        'Webhook の管理にはプロジェクト管理者権限が必要です',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  /**
   * SSRF 対策: 送信先 URL が内部/メタデータ宛でないことを設定時に検証する。
   * 実配信直前にも再検証する（TOCTOU/DNS リバインディング対策）が、ここでの
   * 早期拒否で管理者に即時フィードバックを返す。
   */
  private async assertSafeTargetUrl(targetUrl: string): Promise<void> {
    try {
      await assertSafeOutboundUrl(targetUrl);
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        throw new HttpException(e.message, HttpStatus.BAD_REQUEST);
      }
      throw e;
    }
  }

  private async requireWebhook(id: string): Promise<Webhook> {
    const webhook = await this.prisma.webhook.findUnique({ where: { id } });
    if (!webhook) {
      throw new HttpException('Webhookが見つかりません', HttpStatus.NOT_FOUND);
    }
    return webhook;
  }

  /** secret(secretEnc) は決して返さず、存在有無だけ hasSecret で示す。 */
  private toResponse(w: Webhook) {
    return {
      id: w.id,
      projectId: w.projectId,
      targetUrl: w.targetUrl,
      events: Array.isArray(w.events) ? (w.events as unknown[]).map(String) : [],
      label: w.label,
      active: w.active,
      hasSecret: !!w.secretEnc,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    };
  }
}
