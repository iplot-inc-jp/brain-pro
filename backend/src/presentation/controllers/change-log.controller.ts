import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { EntityNotFoundError, ForbiddenError } from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

const DEFAULT_LIMIT = 100;
const MIN_LIMIT = 1;
const MAX_LIMIT = 300;

@ApiTags('変更履歴')
@ApiBearerAuth()
@Controller('projects/:projectId/change-logs')
export class ChangeLogController {
  constructor(private readonly prisma: PrismaService) {}

  // project → org メンバー確認（スーパー管理者は常に許可）
  private async assertProjectMember(
    projectId: string,
    userId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) {
      throw new EntityNotFoundError('Project', projectId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin) return;

    const member = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: project.organizationId,
          userId,
        },
      },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenError('You are not a member of this organization');
    }
  }

  @Get()
  @ApiOperation({ summary: 'プロジェクトの変更履歴一覧取得（新しい順）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `取得件数（${MIN_LIMIT}〜${MAX_LIMIT}、既定 ${DEFAULT_LIMIT}）`,
  })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
  ) {
    await this.assertProjectMember(projectId, user.id);

    const parsed = Number.parseInt(limit ?? '', 10);
    const take = Number.isNaN(parsed)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(parsed, MIN_LIMIT), MAX_LIMIT);

    return this.prisma.changeLog.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
