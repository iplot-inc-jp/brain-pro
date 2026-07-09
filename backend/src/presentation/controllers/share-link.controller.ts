import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import {
  SHARE_KINDS,
  SHARE_SCOPES,
  ShareKind,
  ShareLinkService,
} from '../../infrastructure/services/share-link.service';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

class UpsertShareLinkDto {
  @IsIn(SHARE_KINDS as readonly string[])
  kind!: ShareKind;

  @IsString()
  targetId!: string;

  /** 公開範囲。PUBLIC=リンクを知っていれば誰でも / ORG=組織メンバーのみ（要ログイン） */
  @IsIn(SHARE_SCOPES as readonly string[])
  scope!: string;
}

/**
 * 図の共有リンク管理（発行/取得/無効化）。
 * 対象種別（kind）× 対象ID（targetId）につき1本。閲覧側は各図の @Public
 * shared エンドポイント（business-flows/shared/:token, shared/dfd/:token 等）。
 *
 * 認可は ProjectAccessGuard（GET=view / POST・DELETE=edit）に委ねる。
 * targetId がこのプロジェクトに属するかは assertTargetInProject で必ず検証する
 * （別プロジェクトの図を自分のプロジェクト権限で共有される事故を防ぐ）。
 */
@ApiTags('共有リンク')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/share-links')
export class ShareLinkController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shareLinkService: ShareLinkService,
  ) {}

  @Get()
  @ApiOperation({ summary: '共有リンクの現在の発行状態を取得' })
  async get(
    @Param('projectId') projectId: string,
    @Query('kind') kind: string,
    @Query('targetId') targetId: string,
  ): Promise<{ token: string | null; scope: string | null }> {
    this.assertKind(kind);
    if (!targetId) throw new BadRequestException('targetId は必須です');
    const link = await this.prisma.shareLink.findUnique({
      where: { kind_targetId: { kind, targetId } },
    });
    if (!link || link.projectId !== projectId) {
      return { token: null, scope: null };
    }
    return { token: link.token, scope: link.scope };
  }

  @Post()
  @ApiOperation({
    summary: '共有リンクを発行（既にあれば scope のみ更新・トークンは維持）',
  })
  async upsert(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertShareLinkDto,
  ): Promise<{ token: string; scope: string }> {
    this.assertKind(dto.kind);
    await this.assertTargetInProject(projectId, dto.kind, dto.targetId);

    const existing = await this.prisma.shareLink.findUnique({
      where: { kind_targetId: { kind: dto.kind, targetId: dto.targetId } },
    });
    if (existing) {
      if (existing.projectId !== projectId) {
        // kind×targetId は unique なので通常起こらない（targetId 検証済みのため防御的）
        throw new NotFoundException('共有リンクが見つかりません');
      }
      const updated =
        existing.scope === dto.scope
          ? existing
          : await this.prisma.shareLink.update({
              where: { id: existing.id },
              data: { scope: dto.scope },
            });
      return { token: updated.token, scope: updated.scope };
    }

    const created = await this.prisma.shareLink.create({
      data: {
        projectId,
        kind: dto.kind,
        targetId: dto.targetId,
        token: this.shareLinkService.issueToken(),
        scope: dto.scope,
      },
    });
    return { token: created.token, scope: created.scope };
  }

  @Delete()
  @ApiOperation({ summary: '共有リンクを無効化（URLを知っていても開けなくなる）' })
  async revoke(
    @Param('projectId') projectId: string,
    @Query('kind') kind: string,
    @Query('targetId') targetId: string,
  ): Promise<{ success: boolean }> {
    this.assertKind(kind);
    if (!targetId) throw new BadRequestException('targetId は必須です');
    await this.prisma.shareLink.deleteMany({
      where: { projectId, kind, targetId },
    });
    return { success: true };
  }

  private assertKind(kind: string): asserts kind is ShareKind {
    if (!(SHARE_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`不正な kind です: ${kind}`);
    }
  }

  /** targetId が :projectId 配下のエンティティであることを kind 別に検証。 */
  private async assertTargetInProject(
    projectId: string,
    kind: ShareKind,
    targetId: string,
  ): Promise<void> {
    let ok = false;
    switch (kind) {
      case 'FLOW': {
        const row = await this.prisma.businessFlow.findUnique({
          where: { id: targetId },
          select: { projectId: true },
        });
        ok = row?.projectId === projectId;
        break;
      }
      case 'DFD': {
        const row = await this.prisma.dfdDiagram.findUnique({
          where: { id: targetId },
          select: { projectId: true },
        });
        ok = row?.projectId === projectId;
        break;
      }
      case 'OBJECT_MAP': {
        // オブジェクト関係性マップはプロジェクト単位 → targetId はプロジェクトIDそのもの
        ok = targetId === projectId;
        break;
      }
      case 'ISSUE_TREE': {
        const row = await this.prisma.issueTree.findUnique({
          where: { id: targetId },
          select: { projectId: true },
        });
        ok = row?.projectId === projectId;
        break;
      }
    }
    if (!ok) {
      throw new NotFoundException('共有対象が見つかりません');
    }
  }
}
