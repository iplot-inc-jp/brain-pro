import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ManageTrackerWebhookUseCase,
  ProcessTrackerWebhookUseCase,
} from '../../application/use-cases';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { Public } from '../decorators/public.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

/**
 * トラッカー接続ごとの Webhook 秘密トークンの管理 API（admin 限定）。
 *
 * 認可: tracker-connection.controller と同様に @ProjectScopedAccess + ProjectAccessGuard を
 * 付けたうえで、各 endpoint の実体である ManageTrackerWebhookUseCase が
 * 接続→projectId を引いて isProjectAdmin を検証する（非adminは Forbidden）。
 *
 * レスポンスの url には秘密が含まれる（管理者のみが取得できる）。
 * Jira/Backlog 側の Webhook 設定にこの URL を貼り付けて使う。
 *
 * 受信エンドポイント（公開 POST /trackers/webhook/:provider/:connectionId/:token）も
 * 本コントローラに同居する（@Public()。JwtAuthGuard / ProjectAccessGuard は @Public・user 不在で
 * 素通りするため、クラスのガード付与下でも認証なしで受信できる）。
 */
@ApiTags('外部トラッカー連携')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class TrackerWebhookController {
  constructor(
    private readonly manageWebhook: ManageTrackerWebhookUseCase,
    private readonly processWebhook: ProcessTrackerWebhookUseCase,
  ) {}

  /**
   * Jira/Backlog からの webhook 受信（公開）。
   * URL に埋め込まれた秘密トークンを use-case 側で timing-safe 照合し、検証後に当該 1 課題を
   * 取り込む（created/updated → import、deleted → Task を CLOSED）。token 不一致は 401。
   * それ以外の失敗は use-case 側でログに握り、受信は常に素早く 2xx を返す。
   */
  @Public()
  @Post('trackers/webhook/:provider/:connectionId/:token')
  @ApiOperation({ summary: 'Webhook 受信（公開・URL に秘密トークン）' })
  async receive(
    @Param('provider') provider: string,
    @Param('connectionId') connectionId: string,
    @Param('token') token: string,
    @Body() body: unknown,
  ): Promise<{ ok: true }> {
    await this.processWebhook.execute({ provider, connectionId, token, body });
    return { ok: true };
  }

  @Post('tracker-connections/:id/webhook/enable')
  @ApiOperation({ summary: 'Webhook を有効化（秘密を生成し、秘密入り URL を返す）' })
  async enable(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.manageWebhook.enable(id, user.id);
  }

  @Post('tracker-connections/:id/webhook/regenerate')
  @ApiOperation({ summary: 'Webhook URL を再生成（旧 URL は無効化）' })
  async regenerate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.manageWebhook.regenerate(id, user.id);
  }

  @Post('tracker-connections/:id/webhook/disable')
  @ApiOperation({ summary: 'Webhook を無効化（秘密を破棄）' })
  async disable(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.manageWebhook.disable(id, user.id);
  }

  @Get('tracker-connections/:id/webhook/url')
  @ApiOperation({ summary: '現在の Webhook URL を取得（無効なら url=null）' })
  async getUrl(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    return this.manageWebhook.getUrl(id, user.id);
  }
}
