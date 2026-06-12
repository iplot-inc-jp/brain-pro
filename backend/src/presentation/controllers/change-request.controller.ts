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
import {
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

const CHANGE_REQUEST_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'APPLIED',
] as const;

// ========== DTOs ==========

class CreateChangeRequestDto {
  @ApiProperty({ description: '変更要求タイトル', example: '帳票レイアウト変更' })
  @IsString()
  title: string;

  @ApiProperty({ description: '変更理由', required: false, nullable: true })
  @IsOptional()
  @IsString()
  reason?: string | null;

  @ApiProperty({ description: 'スコープへの影響', required: false, nullable: true })
  @IsOptional()
  @IsString()
  impactScope?: string | null;

  @ApiProperty({ description: 'スケジュールへの影響', required: false, nullable: true })
  @IsOptional()
  @IsString()
  impactSchedule?: string | null;

  @ApiProperty({ description: 'コストへの影響', required: false, nullable: true })
  @IsOptional()
  @IsString()
  impactCost?: string | null;

  @ApiProperty({
    description: 'ステータス',
    required: false,
    enum: CHANGE_REQUEST_STATUSES,
  })
  @IsOptional()
  @IsIn([...CHANGE_REQUEST_STATUSES])
  status?: string;

  @ApiProperty({ description: '承認者ステークホルダーID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  approverStakeholderId?: string | null;

  @ApiProperty({ description: '備考', required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateChangeRequestDto {
  @ApiProperty({ description: '変更要求タイトル', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '変更理由', required: false, nullable: true })
  @IsOptional()
  @IsString()
  reason?: string | null;

  @ApiProperty({ description: 'スコープへの影響', required: false, nullable: true })
  @IsOptional()
  @IsString()
  impactScope?: string | null;

  @ApiProperty({ description: 'スケジュールへの影響', required: false, nullable: true })
  @IsOptional()
  @IsString()
  impactSchedule?: string | null;

  @ApiProperty({ description: 'コストへの影響', required: false, nullable: true })
  @IsOptional()
  @IsString()
  impactCost?: string | null;

  @ApiProperty({
    description: 'ステータス',
    required: false,
    enum: CHANGE_REQUEST_STATUSES,
  })
  @IsOptional()
  @IsIn([...CHANGE_REQUEST_STATUSES])
  status?: string;

  @ApiProperty({ description: '承認者ステークホルダーID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  approverStakeholderId?: string | null;

  @ApiProperty({ description: '備考', required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

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

async function assertStakeholderInProject(
  prisma: PrismaService,
  stakeholderId: string,
  projectId: string,
): Promise<void> {
  const stakeholder = await prisma.stakeholder.findUnique({
    where: { id: stakeholderId },
    select: { projectId: true },
  });
  if (!stakeholder) {
    throw new EntityNotFoundError('Stakeholder', stakeholderId);
  }
  if (stakeholder.projectId !== projectId) {
    throw new ValidationError('Stakeholder does not belong to this project');
  }
}

@ApiTags('変更要求')
@ApiBearerAuth()
@Controller('projects/:projectId/change-requests')
export class ChangeRequestController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトの変更要求一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);

    return this.prisma.changeRequest.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '変更要求作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateChangeRequestDto,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);

    if (dto.approverStakeholderId) {
      await assertStakeholderInProject(
        this.prisma,
        dto.approverStakeholderId,
        projectId,
      );
    }

    const status = dto.status ?? 'REQUESTED';

    return this.prisma.changeRequest.create({
      data: {
        projectId,
        title: dto.title,
        reason: dto.reason ?? null,
        impactScope: dto.impactScope ?? null,
        impactSchedule: dto.impactSchedule ?? null,
        impactCost: dto.impactCost ?? null,
        status,
        // 空文字は null に正規化（FK 違反 500 の回避）
        approverStakeholderId: dto.approverStakeholderId || null,
        // 作成時点で承認/却下なら決定日時を記録
        decidedAt:
          status === 'APPROVED' || status === 'REJECTED' ? new Date() : null,
        note: dto.note ?? null,
        order: dto.order ?? 0,
      },
    });
  }
}

@ApiTags('変更要求')
@ApiBearerAuth()
@Controller('change-requests')
export class ChangeRequestByIdController {
  constructor(private readonly prisma: PrismaService) {}

  private async findWithAuth(id: string, userId: string) {
    const changeRequest = await this.prisma.changeRequest.findUnique({
      where: { id },
    });
    if (!changeRequest) {
      throw new EntityNotFoundError('ChangeRequest', id);
    }
    await assertProjectMember(this.prisma, changeRequest.projectId, userId);
    return changeRequest;
  }

  @Patch(':id')
  @ApiOperation({ summary: '変更要求更新' })
  @ApiParam({ name: 'id', description: '変更要求ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '変更要求が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateChangeRequestDto,
  ) {
    const existing = await this.findWithAuth(id, user.id);

    if (dto.approverStakeholderId) {
      await assertStakeholderInProject(
        this.prisma,
        dto.approverStakeholderId,
        existing.projectId,
      );
    }

    const data: {
      title?: string;
      reason?: string | null;
      impactScope?: string | null;
      impactSchedule?: string | null;
      impactCost?: string | null;
      status?: string;
      approverStakeholderId?: string | null;
      decidedAt?: Date | null;
      note?: string | null;
      order?: number;
    } = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.reason !== undefined) data.reason = dto.reason;
    if (dto.impactScope !== undefined) data.impactScope = dto.impactScope;
    if (dto.impactSchedule !== undefined)
      data.impactSchedule = dto.impactSchedule;
    if (dto.impactCost !== undefined) data.impactCost = dto.impactCost;
    if (dto.status !== undefined) {
      data.status = dto.status;
      // ステータスが APPROVED / REJECTED に変わるタイミングで決定日時を記録。
      // 申請(REQUESTED)へ差し戻したら決定日時はクリアする（古い決定日が残らないように）。
      if (
        dto.status !== existing.status &&
        (dto.status === 'APPROVED' || dto.status === 'REJECTED')
      ) {
        data.decidedAt = new Date();
      } else if (dto.status !== existing.status && dto.status === 'REQUESTED') {
        data.decidedAt = null;
      }
    }
    if (dto.approverStakeholderId !== undefined)
      // 空文字は null に正規化（'' のまま書くと FK 違反で 500 になるため）
      data.approverStakeholderId = dto.approverStakeholderId || null;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.order !== undefined) data.order = dto.order;

    return this.prisma.changeRequest.update({
      where: { id },
      data,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '変更要求削除' })
  @ApiParam({ name: 'id', description: '変更要求ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '変更要求が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.findWithAuth(id, user.id);
    await this.prisma.changeRequest.delete({ where: { id } });
    return { success: true };
  }
}
