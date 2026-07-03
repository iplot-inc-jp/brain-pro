import { Controller, Get, Post, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  PreviewInviteUseCase,
  AcceptInviteUseCase,
  CreateInviteUseCase,
  ListInvitesUseCase,
  RevokeInviteUseCase,
} from '../../application';
import { CreateInviteRequestDto } from '../dto';
import { Public } from '../decorators/public.decorator';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';

@ApiTags('招待')
@Controller()
export class InviteController {
  constructor(
    private readonly previewInviteUseCase: PreviewInviteUseCase,
    private readonly acceptInviteUseCase: AcceptInviteUseCase,
    private readonly createInviteUseCase: CreateInviteUseCase,
    private readonly listInvitesUseCase: ListInvitesUseCase,
    private readonly revokeInviteUseCase: RevokeInviteUseCase,
  ) {}

  @Get('invites/:token')
  @Public()
  @ApiOperation({ summary: '招待リンクのプレビュー' })
  async preview(@Param('token') token: string) {
    return this.previewInviteUseCase.execute({ token });
  }

  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '招待リンクを受理して会社に参加' })
  async accept(@Param('token') token: string, @CurrentUser() user: CurrentUserPayload) {
    return this.acceptInviteUseCase.execute({ token, userId: user.id });
  }

  @Get('organizations/:id/invites')
  @ApiOperation({ summary: '会社の招待リンク一覧' })
  async list(@Param('id') organizationId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.listInvitesUseCase.execute({ organizationId, requesterUserId: user.id });
  }

  @Post('organizations/:id/invites')
  @ApiOperation({ summary: '招待リンクを発行' })
  async create(
    @Param('id') organizationId: string,
    @Body() dto: CreateInviteRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.createInviteUseCase.execute({
      organizationId,
      requesterUserId: user.id,
      role: dto.role,
      expiresInDays: dto.expiresInDays,
      maxUses: dto.maxUses,
    });
  }

  @Delete('organizations/:id/invites/:inviteId')
  @ApiOperation({ summary: '招待リンクを無効化' })
  async revoke(
    @Param('id') organizationId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    await this.revokeInviteUseCase.execute({ organizationId, requesterUserId: user.id, inviteId });
    return { success: true };
  }
}
