import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { DriveService } from '../../infrastructure/knowledge/drive.service';
import { FileExtractionService } from '../../infrastructure/knowledge/file-extraction.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

const DOC_KINDS = ['INTERNAL', 'GOOGLE_DOC'] as const;
type DocKind = (typeof DOC_KINDS)[number];

// ========== DTOs ==========

class CreateMeetingDocumentDto {
  @ApiPropertyOptional({ description: '会議ID（このドキュメントが属する会議）' })
  @IsString()
  meetingId: string;

  @ApiPropertyOptional({ description: 'INTERNAL | GOOGLE_DOC' })
  @IsOptional()
  @IsIn(DOC_KINDS)
  kind?: DocKind;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ nullable: true, description: 'GOOGLE_DOC の URL' })
  @IsOptional()
  @IsString()
  googleDocUrl?: string | null;
}

class PatchMeetingDocumentDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ nullable: true, description: 'GOOGLE_DOC の URL' })
  @IsOptional()
  @IsString()
  googleDocUrl?: string | null;

  @ApiPropertyOptional({ description: '別の会議へ移動する場合の会議ID' })
  @IsOptional()
  @IsString()
  meetingId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order?: number;
}

type DocRow = {
  id: string;
  projectId: string;
  meetingId: string;
  kind: string;
  title: string;
  googleDocUrl: string | null;
  fetchedContent: string | null;
  fetchedTitle: string | null;
  fetchedMime: string | null;
  fetchedAt: Date | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

// includeContent=false（一覧）では巨大になりうる fetchedContent 本文は返さず、
// 取得済みかどうか（fetched* メタ）だけ返す。単体取得/取り込み時のみ本文を含める。
function docToResponse(d: DocRow, includeContent = false) {
  return {
    id: d.id,
    projectId: d.projectId,
    meetingId: d.meetingId,
    kind: d.kind,
    title: d.title,
    googleDocUrl: d.googleDocUrl,
    order: d.order,
    // Liveblocks のルームID（INTERNAL の本文はこのルームの Yjs が真実源）。
    roomId: `meetingdoc:${d.id}`,
    // 取得済みGoogle本文のメタ（一覧でも「取り込み済み」表示に使う）。
    hasFetchedContent: !!d.fetchedContent,
    fetchedTitle: d.fetchedTitle,
    fetchedMime: d.fetchedMime,
    fetchedAt: d.fetchedAt ? d.fetchedAt.toISOString() : null,
    ...(includeContent ? { fetchedContent: d.fetchedContent } : {}),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

// Google ドキュメント/シート/スライド/Drive の共有URLから Drive ファイルIDを抽出。
function parseDriveFileId(url: string): string | null {
  const byPath = url.match(/\/d\/([A-Za-z0-9_-]+)/);
  if (byPath) return byPath[1];
  const byQuery = url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (byQuery) return byQuery[1];
  return null;
}

// ========================================================================
// プロジェクト配下ルート（一覧 / 新規作成）
// ========================================================================
@ApiTags('ミーティングドキュメント')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/meeting-documents')
export class MeetingDocumentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'ミーティングドキュメント一覧（会議別フィルタ可）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async list(
    @Param('projectId') projectId: string,
    @Query('meetingId') meetingId?: string,
  ) {
    const where: Prisma.MeetingDocumentWhereInput = { projectId };
    if (meetingId) where.meetingId = meetingId;
    const docs = await this.prisma.meetingDocument.findMany({
      where,
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return docs.map((d) => docToResponse(d as DocRow));
  }

  @Post()
  @ApiOperation({ summary: 'ミーティングドキュメントを新規作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateMeetingDocumentDto,
  ) {
    // 会議が同一プロジェクトに属することを検証（クロステナント/誤紐付け防止）。
    await this.assertMeetingInProject(dto.meetingId, projectId);
    const doc = await this.prisma.meetingDocument.create({
      data: {
        projectId,
        meetingId: dto.meetingId,
        kind: dto.kind ?? 'INTERNAL',
        title: dto.title ?? '',
        googleDocUrl: dto.googleDocUrl ?? null,
      },
    });
    return docToResponse(doc as DocRow);
  }

  private async assertMeetingInProject(meetingId: string, projectId: string) {
    const m = await this.prisma.meeting.findFirst({
      where: { id: meetingId, projectId },
      select: { id: true },
    });
    if (!m) throw new BadRequestException('会議が見つからないか、別プロジェクトです');
  }
}

// ========================================================================
// 単一ドキュメントルート（:id）。doc→projectId をロードして明示認可。
// ========================================================================
@ApiTags('ミーティングドキュメント')
@ApiBearerAuth()
@Controller('meeting-documents')
export class MeetingDocumentByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly drive: DriveService,
    private readonly fileExtraction: FileExtractionService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'ミーティングドキュメント取得' })
  @ApiParam({ name: 'id', description: 'ドキュメントID' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.assertDocAccess(id, user.id, 'view');
    const doc = await this.prisma.meetingDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ドキュメントが見つかりません');
    return docToResponse(doc as DocRow, true);
  }

  @Post(':id/fetch')
  @ApiOperation({
    summary: 'GOOGLE_DOC の本文を Drive 連携経由で取得し DB に保存（要プロジェクトの Drive 連携）',
  })
  @ApiParam({ name: 'id', description: 'ドキュメントID' })
  async fetch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const { projectId } = await this.assertDocAccess(id, user.id, 'edit');
    const doc = await this.prisma.meetingDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('ドキュメントが見つかりません');
    if (doc.kind !== 'GOOGLE_DOC' || !doc.googleDocUrl) {
      throw new BadRequestException('GOOGLE_DOC のドキュメントのみ本文を取得できます');
    }
    const fileId = parseDriveFileId(doc.googleDocUrl);
    if (!fileId) {
      throw new BadRequestException('URL から Google ファイルIDを特定できませんでした');
    }

    let download;
    try {
      // Google ネイティブ形式は DriveService が Office 形式（docx/xlsx/pptx）へ変換して返す。
      download = await this.drive.downloadFile(projectId, fileId);
    } catch {
      throw new BadRequestException(
        'Google Drive からの取得に失敗しました。プロジェクトの Drive 連携と、対象ファイルの共有設定を確認してください。',
      );
    }

    const kind = this.fileExtraction.classify(download.mimeType, download.filename);
    const extracted = await this.fileExtraction.extractText(kind, download.bytes);
    const text =
      typeof extracted.text === 'string' && extracted.text.trim() !== ''
        ? extracted.text
        : null;
    if (text === null) {
      // 画像/PDF や未対応形式は本文抽出できない（メタだけ更新して理由を返す）。
      throw new BadRequestException(
        'この形式のファイルからは本文テキストを抽出できませんでした（画像/PDF/未対応形式）。',
      );
    }

    const updated = await this.prisma.meetingDocument.update({
      where: { id },
      data: {
        fetchedContent: text,
        fetchedTitle: download.filename,
        fetchedMime: download.mimeType,
        fetchedAt: new Date(),
      },
    });
    return docToResponse(updated as DocRow, true);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'ドキュメント更新（title/googleDocUrl/meetingId/order）' })
  @ApiParam({ name: 'id', description: 'ドキュメントID' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: PatchMeetingDocumentDto,
  ) {
    const doc = await this.assertDocAccess(id, user.id, 'edit');
    const data: Prisma.MeetingDocumentUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.googleDocUrl !== undefined) data.googleDocUrl = dto.googleDocUrl;
    if (dto.order !== undefined) data.order = dto.order;
    if (dto.meetingId !== undefined) {
      // 移動先の会議も同一プロジェクトであること。
      const m = await this.prisma.meeting.findFirst({
        where: { id: dto.meetingId, projectId: doc.projectId },
        select: { id: true },
      });
      if (!m) throw new BadRequestException('会議が見つからないか、別プロジェクトです');
      data.meeting = { connect: { id: dto.meetingId } };
    }
    const updated = await this.prisma.meetingDocument.update({
      where: { id },
      data,
    });
    return docToResponse(updated as DocRow);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ドキュメント削除' })
  @ApiParam({ name: 'id', description: 'ドキュメントID' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.assertDocAccess(id, user.id, 'edit');
    await this.prisma.meetingDocument.delete({ where: { id } });
  }

  /** doc をロードして projectId を求め、明示的に認可する。 */
  private async assertDocAccess(
    id: string,
    userId: string,
    required: 'view' | 'edit',
  ): Promise<{ projectId: string }> {
    const doc = await this.prisma.meetingDocument.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!doc) throw new NotFoundException('ドキュメントが見つかりません');
    await this.projectAccess.assertProjectAccess(doc.projectId, userId, required);
    return doc;
  }
}
