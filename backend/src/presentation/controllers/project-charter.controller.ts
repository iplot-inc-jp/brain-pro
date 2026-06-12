import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
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

// ========== DTOs ==========

class UpsertProjectCharterDto {
  @ApiProperty({ description: '背景', required: false, nullable: true })
  @IsOptional()
  @IsString()
  background?: string | null;

  @ApiProperty({ description: '目的', required: false, nullable: true })
  @IsOptional()
  @IsString()
  purpose?: string | null;

  @ApiProperty({ description: '成功基準', required: false, nullable: true })
  @IsOptional()
  @IsString()
  successCriteria?: string | null;

  @ApiProperty({ description: 'スコープ内', required: false, nullable: true })
  @IsOptional()
  @IsString()
  scopeIn?: string | null;

  @ApiProperty({ description: 'スコープ外', required: false, nullable: true })
  @IsOptional()
  @IsString()
  scopeOut?: string | null;

  @ApiProperty({ description: '予算メモ', required: false, nullable: true })
  @IsOptional()
  @IsString()
  budgetNote?: string | null;

  @ApiProperty({
    description: '承認者ステークホルダーID',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  approverStakeholderId?: string | null;

  @ApiProperty({
    description: 'スポンサーステークホルダーID',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  sponsorStakeholderId?: string | null;
}

@ApiTags('プロジェクト憲章')
@ApiBearerAuth()
@Controller('projects/:projectId/charter')
export class ProjectCharterController {
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

  // ステークホルダーが存在し、同一プロジェクトに属するか検証
  private async assertStakeholderInProject(
    stakeholderId: string,
    projectId: string,
  ): Promise<void> {
    const stakeholder = await this.prisma.stakeholder.findUnique({
      where: { id: stakeholderId },
      select: { projectId: true },
    });
    if (!stakeholder) {
      throw new EntityNotFoundError('Stakeholder', stakeholderId);
    }
    if (stakeholder.projectId !== projectId) {
      throw new ValidationError(
        'Stakeholder does not belong to this project',
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'プロジェクト憲章取得（未作成なら null）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await this.assertProjectMember(projectId, user.id);

    const charter = await this.prisma.projectCharter.findUnique({
      where: { projectId },
    });
    return charter ?? null;
  }

  @Put()
  @ApiOperation({ summary: 'プロジェクト憲章 upsert（全フィールド任意）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertProjectCharterDto,
  ) {
    await this.assertProjectMember(projectId, user.id);

    if (dto.approverStakeholderId) {
      await this.assertStakeholderInProject(
        dto.approverStakeholderId,
        projectId,
      );
    }
    if (dto.sponsorStakeholderId) {
      await this.assertStakeholderInProject(
        dto.sponsorStakeholderId,
        projectId,
      );
    }

    const data: {
      background?: string | null;
      purpose?: string | null;
      successCriteria?: string | null;
      scopeIn?: string | null;
      scopeOut?: string | null;
      budgetNote?: string | null;
      approverStakeholderId?: string | null;
      sponsorStakeholderId?: string | null;
    } = {};
    if (dto.background !== undefined) data.background = dto.background;
    if (dto.purpose !== undefined) data.purpose = dto.purpose;
    if (dto.successCriteria !== undefined)
      data.successCriteria = dto.successCriteria;
    if (dto.scopeIn !== undefined) data.scopeIn = dto.scopeIn;
    if (dto.scopeOut !== undefined) data.scopeOut = dto.scopeOut;
    if (dto.budgetNote !== undefined) data.budgetNote = dto.budgetNote;
    // 空文字は null に正規化（'' のまま書くと FK 違反で 500 になるため）
    if (dto.approverStakeholderId !== undefined)
      data.approverStakeholderId = dto.approverStakeholderId || null;
    if (dto.sponsorStakeholderId !== undefined)
      data.sponsorStakeholderId = dto.sponsorStakeholderId || null;

    return this.prisma.projectCharter.upsert({
      where: { projectId },
      create: { projectId, ...data },
      update: data,
    });
  }
}
