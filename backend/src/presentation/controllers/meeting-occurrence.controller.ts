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
import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// 実会議（MeetingOccurrence）= 会議帯(Meeting)の「1回分の開催実体」。議事録・決定事項・
// ネクストアクションを持つ。会議帯に紐づく（meetingId）のが基本だが、単発/例外会議は meetingId 省略で作れる。
// API は Swagger（@ApiTags）に載るので ipro-agent の brainpro_list_capabilities から発見・利用できる。
// 画面（frontend）からの手動追加もこの API を使う。

// ========== DTO ==========
class CreateMeetingOccurrenceDto {
  @ApiPropertyOptional({ description: '会議名/タイトル' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: '紐づく会議帯(Meeting)ID。省略＝単発/例外会議' })
  @IsOptional()
  @IsString()
  meetingId?: string;

  @ApiPropertyOptional({ description: '開催日時(ISO8601)' })
  @IsOptional()
  @IsDateString()
  heldAt?: string;

  @ApiPropertyOptional({ description: '出席者' })
  @IsOptional()
  @IsString()
  attendees?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() agenda?: string;
  @ApiPropertyOptional({ description: '議事録本文' }) @IsOptional() @IsString() minutes?: string;
  @ApiPropertyOptional({ description: '決定事項' }) @IsOptional() @IsString() decisions?: string;
  @ApiPropertyOptional({ description: 'ネクストアクション（生テキスト）' }) @IsOptional() @IsString() nextActions?: string;
  @ApiPropertyOptional({ description: '出典（例: ipro-db:recording:42）' }) @IsOptional() @IsString() source?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceRef?: string;
}

class PatchMeetingOccurrenceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() meetingId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() heldAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() attendees?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() agenda?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() minutes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() decisions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() nextActions?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() order?: number;
}

type OccRow = {
  id: string;
  projectId: string;
  meetingId: string | null;
  title: string;
  heldAt: Date | null;
  attendees: string | null;
  agenda: string | null;
  minutes: string | null;
  decisions: string | null;
  nextActions: string | null;
  source: string | null;
  sourceRef: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
};

function toResponse(o: OccRow) {
  return {
    id: o.id,
    projectId: o.projectId,
    meetingId: o.meetingId,
    title: o.title,
    heldAt: o.heldAt ? o.heldAt.toISOString() : null,
    attendees: o.attendees,
    agenda: o.agenda,
    minutes: o.minutes,
    decisions: o.decisions,
    nextActions: o.nextActions,
    source: o.source,
    sourceRef: o.sourceRef,
    order: o.order,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

// ========================================================================
// プロジェクト配下（一覧 / 新規作成）
// ========================================================================
@ApiTags('実会議（議事録）')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/meeting-occurrences')
export class MeetingOccurrenceController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '実会議（議事録）一覧。会議帯IDでフィルタ可' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async list(@Param('projectId') projectId: string, @Query('meetingId') meetingId?: string) {
    const where: Prisma.MeetingOccurrenceWhereInput = { projectId };
    if (meetingId) where.meetingId = meetingId;
    const rows = await this.prisma.meetingOccurrence.findMany({
      where,
      orderBy: [{ heldAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((r) => toResponse(r as OccRow));
  }

  @Post()
  @ApiOperation({ summary: '実会議（議事録）を作成。meetingId 省略で単発/例外会議' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async create(@Param('projectId') projectId: string, @Body() dto: CreateMeetingOccurrenceDto) {
    if (!dto.title?.trim()) throw new BadRequestException('title は必須です');
    // 会議帯を指定するなら同一プロジェクトのものか検証（誤紐付け/クロステナント防止）。
    if (dto.meetingId) await this.assertMeetingInProject(dto.meetingId, projectId);
    const row = await this.prisma.meetingOccurrence.create({
      data: {
        projectId,
        meetingId: dto.meetingId ?? null,
        title: dto.title.trim(),
        heldAt: dto.heldAt ? new Date(dto.heldAt) : null,
        attendees: dto.attendees ?? null,
        agenda: dto.agenda ?? null,
        minutes: dto.minutes ?? null,
        decisions: dto.decisions ?? null,
        nextActions: dto.nextActions ?? null,
        source: dto.source ?? null,
        sourceRef: dto.sourceRef ?? null,
      },
    });
    return toResponse(row as OccRow);
  }

  private async assertMeetingInProject(meetingId: string, projectId: string) {
    const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, projectId }, select: { id: true } });
    if (!m) throw new BadRequestException('会議帯が見つからないか、別プロジェクトです');
  }
}

// ========================================================================
// 単一（:id）。occ→projectId をロードして明示認可。
// ========================================================================
@ApiTags('実会議（議事録）')
@ApiBearerAuth()
@Controller('meeting-occurrences')
export class MeetingOccurrenceByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: '実会議（議事録）1件' })
  async get(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.assertAccess(id, user.id, 'view');
    const row = await this.load(id);
    return toResponse(row as OccRow);
  }

  @Patch(':id')
  @ApiOperation({ summary: '実会議（議事録）を更新' })
  async patch(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string, @Body() dto: PatchMeetingOccurrenceDto) {
    const { projectId } = await this.assertAccess(id, user.id, 'edit');
    if (dto.meetingId) await this.assertMeetingInProject(dto.meetingId, projectId);
    const row = await this.prisma.meetingOccurrence.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.meetingId !== undefined ? { meetingId: dto.meetingId || null } : {}),
        ...(dto.heldAt !== undefined ? { heldAt: dto.heldAt ? new Date(dto.heldAt) : null } : {}),
        ...(dto.attendees !== undefined ? { attendees: dto.attendees } : {}),
        ...(dto.agenda !== undefined ? { agenda: dto.agenda } : {}),
        ...(dto.minutes !== undefined ? { minutes: dto.minutes } : {}),
        ...(dto.decisions !== undefined ? { decisions: dto.decisions } : {}),
        ...(dto.nextActions !== undefined ? { nextActions: dto.nextActions } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    return toResponse(row as OccRow);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '実会議（議事録）を削除' })
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.assertAccess(id, user.id, 'edit');
    await this.prisma.meetingOccurrence.delete({ where: { id } });
  }

  private async load(id: string): Promise<OccRow> {
    const row = await this.prisma.meetingOccurrence.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('実会議が見つかりません');
    return row as OccRow;
  }

  // 実会議→projectId をロードしてプロジェクトアクセスを明示検証（by-id ルートの認可）。
  private async assertAccess(id: string, userId: string, required: 'view' | 'edit'): Promise<{ projectId: string }> {
    const row = await this.prisma.meetingOccurrence.findUnique({ where: { id }, select: { projectId: true } });
    if (!row) throw new NotFoundException('実会議が見つかりません');
    await this.projectAccess.assertProjectAccess(row.projectId, userId, required);
    return row;
  }

  private async assertMeetingInProject(meetingId: string, projectId: string) {
    const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, projectId }, select: { id: true } });
    if (!m) throw new BadRequestException('会議帯が見つからないか、別プロジェクトです');
  }
}
