import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn, IsNumber } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { ScreenshotImportService } from '../../infrastructure/services/screenshot-import.service';
import { BlobStorageService } from '../../infrastructure/services/blob-storage.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

const LINK_SOURCES = ['IMAGE_URL', 'FIGMA'] as const;
type LinkSource = (typeof LINK_SOURCES)[number];

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel Functions のボディ上限対策（~4.5MB）
const UPLOAD_OPTIONS = { limits: { fileSize: MAX_UPLOAD_BYTES } };

// slug を正規化（先頭スラッシュ付与・末尾スラッシュ除去・空なら "/"）。
function normalizeSlug(raw: string): string {
  let s = (raw ?? '').trim();
  if (!s) return '/';
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

class CreateLinkDto {
  @IsIn(LINK_SOURCES)
  source: LinkSource;

  @IsString()
  slug: string;

  @IsString()
  linkUrl: string;

  @IsOptional()
  @IsString()
  caption?: string;
}

class UpdateScreenshotDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  linkUrl?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

type Row = {
  id: string;
  projectId: string;
  source: string;
  slug: string;
  caption: string;
  blobUrl: string | null;
  linkUrl: string | null;
  mimeType: string | null;
  filePath: string | null;
  order: number;
  importedAt: Date;
};

function toResponse(r: Row) {
  return {
    id: r.id,
    projectId: r.projectId,
    source: r.source,
    slug: r.slug,
    caption: r.caption,
    blobUrl: r.blobUrl,
    linkUrl: r.linkUrl,
    mimeType: r.mimeType,
    filePath: r.filePath,
    order: r.order,
    importedAt: r.importedAt.toISOString(),
  };
}

// ========================================================================
// プロジェクト配下ルート（一覧 / 取り込み / リンク追加 / アップロード）
// ========================================================================
@ApiTags('ページ別スクリーンショット')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/page-screenshots')
export class PageScreenshotController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importer: ScreenshotImportService,
    private readonly blob: BlobStorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ページ別スクリーンショット一覧（GitHub連携の有無も返す）' })
  async list(@Param('projectId') projectId: string) {
    const [items, connection] = await Promise.all([
      this.prisma.pageScreenshot.findMany({
        where: { projectId },
        orderBy: [{ slug: 'asc' }, { order: 'asc' }, { caption: 'asc' }],
      }),
      this.prisma.githubConnection.findFirst({
        where: { projectId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      connected: !!connection,
      repoFullName: connection?.repoFullName ?? null,
      branch: connection?.branch ?? null,
      items: items.map((i) => toResponse(i as Row)),
    };
  }

  @Post('import')
  @ApiOperation({ summary: 'GitHub連携の docs/screenshots/ から取り込み' })
  async import(@Param('projectId') projectId: string) {
    try {
      const summary = await this.importer.importForProject(projectId);
      return summary;
    } catch (err) {
      throw new BadRequestException((err as Error)?.message ?? '取り込みに失敗しました');
    }
  }

  @Post('link')
  @ApiOperation({ summary: '画像URL / Figma リンクをページに追加' })
  async createLink(
    @Param('projectId') projectId: string,
    @Body() dto: CreateLinkDto,
  ) {
    const url = dto.linkUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      throw new BadRequestException('http(s) の URL を指定してください');
    }
    if (dto.source === 'FIGMA' && !/figma\.com/.test(url)) {
      throw new BadRequestException('Figma の共有URL（figma.com）を指定してください');
    }
    const order = await this.prisma.pageScreenshot.count({
      where: { projectId, slug: normalizeSlug(dto.slug) },
    });
    const row = await this.prisma.pageScreenshot.create({
      data: {
        projectId,
        source: dto.source,
        slug: normalizeSlug(dto.slug),
        caption: dto.caption?.trim() || '',
        linkUrl: url,
        order,
      },
    });
    return toResponse(row as Row);
  }

  @Post('upload')
  @ApiOperation({ summary: '画像を直接アップロードしてページに追加' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { slug?: string; caption?: string },
  ) {
    if (!file) throw new BadRequestException('ファイルがありません');
    if (!file.mimetype.startsWith('image/')) {
      throw new BadRequestException('画像ファイルをアップロードしてください');
    }
    const slug = normalizeSlug(body.slug ?? '/');
    const filename = file.originalname || 'upload.png';
    const key = `screenshots/${projectId}/upload/${Date.now()}-${filename}`;
    const { url } = await this.blob.save(key, file.buffer, file.mimetype);
    const order = await this.prisma.pageScreenshot.count({ where: { projectId, slug } });
    const row = await this.prisma.pageScreenshot.create({
      data: {
        projectId,
        source: 'UPLOAD',
        slug,
        caption: (body.caption ?? '').trim() || filename.replace(/\.[^.]+$/, ''),
        blobUrl: url,
        mimeType: file.mimetype,
        size: file.size,
        order,
      },
    });
    return toResponse(row as Row);
  }
}

// ========================================================================
// 単一ルート（:id）。screenshot→projectId をロードして明示認可。
// ========================================================================
@ApiTags('ページ別スクリーンショット')
@ApiBearerAuth()
@Controller('page-screenshots')
export class PageScreenshotByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'スクリーンショットを更新（slug/caption/linkUrl/order）' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateScreenshotDto,
  ) {
    await this.assertAccess(id, user.id, 'edit');
    const data: {
      slug?: string;
      caption?: string;
      linkUrl?: string;
      order?: number;
    } = {};
    if (dto.slug !== undefined) data.slug = normalizeSlug(dto.slug);
    if (dto.caption !== undefined) data.caption = dto.caption;
    if (dto.linkUrl !== undefined) data.linkUrl = dto.linkUrl;
    if (dto.order !== undefined) data.order = dto.order;
    const updated = await this.prisma.pageScreenshot.update({ where: { id }, data });
    return toResponse(updated as Row);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'スクリーンショットを削除' })
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.assertAccess(id, user.id, 'edit');
    await this.prisma.pageScreenshot.delete({ where: { id } });
  }

  private async assertAccess(id: string, userId: string, required: 'view' | 'edit') {
    const row = await this.prisma.pageScreenshot.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!row) throw new NotFoundException('スクリーンショットが見つかりません');
    await this.projectAccess.assertProjectAccess(row.projectId, userId, required);
  }
}
