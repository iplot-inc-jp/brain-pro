import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

/** 取り込みソースとして選択できる既存添付（フロント契約と一致）。 */
interface IngestionAttachmentSource {
  id: string;
  filename: string;
  displayName: string | null;
  mimeType: string;
  size: number;
  kind: string;
}

/**
 * 取り込みソース一覧。バッチ作成の「既存添付から選択」用。
 *
 * `GET projects/:projectId/ingestion-sources/attachments` は
 * プロジェクトの **全**添付（phase/task/informationType/flow 直下も含む）を返す。
 * スコープ限定（プロジェクト直下のみ等）はしない。
 */
@ApiTags('取り込みソース')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/ingestion-sources')
export class IngestionSourceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('attachments')
  @ApiOperation({
    summary: '取り込みソースとして選択可能な既存添付一覧（プロジェクトの全添付）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '添付一覧' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async attachments(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<IngestionAttachmentSource[]> {
    await this.projectAccess.assertProjectAccess(projectId, user.id, 'view');

    // プロジェクトに属する全添付（直下限定にしない＝phase/task/informationType/flow 配下も含む）。
    const rows = await this.prisma.attachment.findMany({
      where: { projectId },
      select: {
        id: true,
        filename: true,
        displayName: true,
        mimeType: true,
        size: true,
        kind: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((a) => ({
      id: a.id,
      filename: a.filename,
      displayName: a.displayName,
      mimeType: a.mimeType,
      size: a.size,
      kind: a.kind as string,
    }));
  }
}
