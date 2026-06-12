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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, IsIn } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { EntityNotFoundError, ForbiddenError } from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

const LESSON_KINDS = ['WENT_WELL', 'PROBLEM', 'IMPROVEMENT'] as const;

// ========== DTOs ==========

class CreateLessonLearnedDto {
  @ApiProperty({
    description: '種別（WENT_WELL=うまくいった / PROBLEM=問題 / IMPROVEMENT=改善）',
    required: false,
    enum: LESSON_KINDS,
  })
  @IsOptional()
  @IsIn([...LESSON_KINDS])
  kind?: string;

  @ApiProperty({ description: '教訓の内容', example: '週次レビューで早期に課題を発見できた' })
  @IsString()
  content: string;

  @ApiProperty({ description: '推奨事項', required: false, nullable: true })
  @IsOptional()
  @IsString()
  recommendation?: string | null;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateLessonLearnedDto {
  @ApiProperty({
    description: '種別（WENT_WELL=うまくいった / PROBLEM=問題 / IMPROVEMENT=改善）',
    required: false,
    enum: LESSON_KINDS,
  })
  @IsOptional()
  @IsIn([...LESSON_KINDS])
  kind?: string;

  @ApiProperty({ description: '教訓の内容', required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ description: '推奨事項', required: false, nullable: true })
  @IsOptional()
  @IsString()
  recommendation?: string | null;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

// ========== 共通ヘルパー ==========

async function assertProjectMember(
  prisma: PrismaService,
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!project) {
    throw new EntityNotFoundError('Project', projectId);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  if (user?.isSuperAdmin) return;

  const member = await prisma.organizationMember.findUnique({
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

@ApiTags('教訓（レッスンズラーンド）')
@ApiBearerAuth()
@Controller('projects/:projectId/lessons')
export class LessonLearnedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトの教訓一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);

    return this.prisma.lessonLearned.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '教訓作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateLessonLearnedDto,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);

    return this.prisma.lessonLearned.create({
      data: {
        projectId,
        kind: dto.kind ?? 'WENT_WELL',
        content: dto.content,
        recommendation: dto.recommendation ?? null,
        subProjectId: dto.subProjectId ?? null,
        order: dto.order ?? 0,
      },
    });
  }
}

@ApiTags('教訓（レッスンズラーンド）')
@ApiBearerAuth()
@Controller('lessons')
export class LessonLearnedByIdController {
  constructor(private readonly prisma: PrismaService) {}

  private async findWithAuth(id: string, userId: string) {
    const lesson = await this.prisma.lessonLearned.findUnique({
      where: { id },
    });
    if (!lesson) {
      throw new EntityNotFoundError('LessonLearned', id);
    }
    await assertProjectMember(this.prisma, lesson.projectId, userId);
    return lesson;
  }

  @Patch(':id')
  @ApiOperation({ summary: '教訓更新' })
  @ApiParam({ name: 'id', description: '教訓ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '教訓が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateLessonLearnedDto,
  ) {
    await this.findWithAuth(id, user.id);

    const data: {
      kind?: string;
      content?: string;
      recommendation?: string | null;
      subProjectId?: string | null;
      order?: number;
    } = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.content !== undefined) data.content = dto.content;
    if (dto.recommendation !== undefined)
      data.recommendation = dto.recommendation;
    if (dto.subProjectId !== undefined) data.subProjectId = dto.subProjectId;
    if (dto.order !== undefined) data.order = dto.order;

    return this.prisma.lessonLearned.update({
      where: { id },
      data,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '教訓削除' })
  @ApiParam({ name: 'id', description: '教訓ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '教訓が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.findWithAuth(id, user.id);
    await this.prisma.lessonLearned.delete({ where: { id } });
    return { success: true };
  }
}
