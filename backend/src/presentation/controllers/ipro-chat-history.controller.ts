import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ChatHistoryFacets,
  ChatHistoryPage,
  ChatMessageContext,
  IproChatHistoryService,
} from '../../infrastructure/services/ipro-chat-history.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { QueryChatHistoryDto } from '../dto/ipro-chat-history';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('ipro-dbチャット履歴')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/chat-history')
export class IproChatHistoryController {
  constructor(
    private readonly service: IproChatHistoryService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get()
  @ApiOperation({ summary: '活動ログを検索・カーソルページング' })
  async search(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query() query: QueryChatHistoryDto,
  ): Promise<ChatHistoryPage> {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'view');
    return this.service.search(projectId, query);
  }

  @Get('facets')
  @ApiOperation({ summary: '現在の検索条件に対するfacet件数を取得' })
  async facets(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query() query: QueryChatHistoryDto,
  ): Promise<ChatHistoryFacets> {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'view');
    return this.service.facets(projectId, query);
  }

  @Get('messages/:id/context')
  @ApiOperation({ summary: '選択メッセージの前後10件を取得' })
  async context(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
  ): Promise<ChatMessageContext> {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'view');
    return this.service.context(projectId, id);
  }
}
