import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ManageTrackerWebhookUseCase } from '../../application/use-cases';
import { CurrentUser, CurrentUserPayload } from '../decorators';
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
 * 受信エンドポイント（公開 POST /trackers/webhook/:provider/:connectionId/:token）は
 * 後続タスクで本コントローラに追記する。
 */
@ApiTags('外部トラッカー連携')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class TrackerWebhookController {
  constructor(
    private readonly manageWebhook: ManageTrackerWebhookUseCase,
  ) {}

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
