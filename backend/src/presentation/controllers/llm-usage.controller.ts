import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GetLlmUsageSummaryUseCase } from '../../application/use-cases/llm-usage';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('AI使用量')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class LlmUsageController {
  constructor(private readonly getSummary: GetLlmUsageSummaryUseCase) {}

  @Get('projects/:projectId/llm-usage')
  @ApiOperation({
    summary: 'プロジェクトのAI使用量サマリ（モデル別/領域別/概算コスト）',
  })
  async summary(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('period') period?: string,
  ) {
    return this.getSummary.execute({
      projectId,
      userId: user.id,
      period: period === 'all' ? 'all' : 'month',
    });
  }
}
