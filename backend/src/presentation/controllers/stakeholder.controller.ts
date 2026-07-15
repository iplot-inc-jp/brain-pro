import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { randomUUID } from 'crypto';
import {
  CreateStakeholderUseCase,
  GetStakeholdersUseCase,
  UpdateStakeholderUseCase,
  DeleteStakeholderUseCase,
  StakeholderOutput,
} from '../../application';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ForbiddenError } from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

/**
 * 組織メンバーシップ認可（use-case 層の isMember と同じ判定）。
 * 全体管理者（isSuperAdmin）は全組織のリソースにアクセス可能。
 * メンバーでなければ ForbiddenError（403）を投げる。
 */
async function assertOrganizationMember(
  prisma: PrismaService,
  organizationId: string,
  userId: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  if (user?.isSuperAdmin) return;

  const count = await prisma.organizationMember.count({
    where: { organizationId, userId },
  });
  if (count === 0) {
    throw new ForbiddenError('You are not a member of this organization');
  }
}

// ========== DTOs ==========

class CreateStakeholderDto {
  @ApiProperty({ description: 'ステークホルダー名', example: '営業部長' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '所属' })
  @IsOptional()
  @IsString()
  affiliation?: string | null;

  @ApiPropertyOptional({ description: '役割' })
  @IsOptional()
  @IsString()
  role?: string | null;

  @ApiPropertyOptional({ description: '関心事' })
  @IsOptional()
  @IsString()
  interest?: string | null;

  @ApiPropertyOptional({ description: '懸念' })
  @IsOptional()
  @IsString()
  concern?: string | null;

  @ApiPropertyOptional({ description: '影響度' })
  @IsOptional()
  @IsString()
  influence?: string | null;

  @ApiPropertyOptional({ description: '支持度' })
  @IsOptional()
  @IsString()
  support?: string | null;

  @ApiPropertyOptional({ description: 'エンゲージメント方針' })
  @IsOptional()
  @IsString()
  engagement?: string | null;

  @ApiPropertyOptional({ description: '報告頻度' })
  @IsOptional()
  @IsString()
  reportFrequency?: string | null;

  @ApiPropertyOptional({ description: '連絡手段' })
  @IsOptional()
  @IsString()
  contactMethod?: string | null;

  @ApiPropertyOptional({ description: '担当（オーナー）' })
  @IsOptional()
  @IsString()
  owner?: string | null;

  @ApiPropertyOptional({ description: 'レポートライン' })
  @IsOptional()
  @IsString()
  reportLine?: string | null;

  @ApiPropertyOptional({ description: 'ASISヒアリング' })
  @IsOptional()
  @IsString()
  asisHearing?: string | null;

  @ApiPropertyOptional({ description: 'TOBE壁打ち' })
  @IsOptional()
  @IsString()
  tobeSparring?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({
    description: '内部/外部区分',
    enum: ['INTERNAL', 'EXTERNAL'],
  })
  @IsOptional()
  @IsIn(['INTERNAL', 'EXTERNAL'])
  side?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateStakeholderDto {
  @ApiPropertyOptional({ description: 'ステークホルダー名' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '所属' })
  @IsOptional()
  @IsString()
  affiliation?: string | null;

  @ApiPropertyOptional({ description: '役割' })
  @IsOptional()
  @IsString()
  role?: string | null;

  @ApiPropertyOptional({ description: '関心事' })
  @IsOptional()
  @IsString()
  interest?: string | null;

  @ApiPropertyOptional({ description: '懸念' })
  @IsOptional()
  @IsString()
  concern?: string | null;

  @ApiPropertyOptional({ description: '影響度' })
  @IsOptional()
  @IsString()
  influence?: string | null;

  @ApiPropertyOptional({ description: '支持度' })
  @IsOptional()
  @IsString()
  support?: string | null;

  @ApiPropertyOptional({ description: 'エンゲージメント方針' })
  @IsOptional()
  @IsString()
  engagement?: string | null;

  @ApiPropertyOptional({ description: '報告頻度' })
  @IsOptional()
  @IsString()
  reportFrequency?: string | null;

  @ApiPropertyOptional({ description: '連絡手段' })
  @IsOptional()
  @IsString()
  contactMethod?: string | null;

  @ApiPropertyOptional({ description: '担当（オーナー）' })
  @IsOptional()
  @IsString()
  owner?: string | null;

  @ApiPropertyOptional({ description: 'レポートライン' })
  @IsOptional()
  @IsString()
  reportLine?: string | null;

  @ApiPropertyOptional({ description: 'ASISヒアリング' })
  @IsOptional()
  @IsString()
  asisHearing?: string | null;

  @ApiPropertyOptional({ description: 'TOBE壁打ち' })
  @IsOptional()
  @IsString()
  tobeSparring?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({
    description: '内部/外部区分',
    enum: ['INTERNAL', 'EXTERNAL'],
  })
  @IsOptional()
  @IsIn(['INTERNAL', 'EXTERNAL'])
  side?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class DomainAssignmentItemDto {
  @ApiProperty({ description: 'サブプロジェクト（領域）ID' })
  @IsString()
  subProjectId: string;

  @ApiProperty({ description: 'RACI', enum: ['R', 'A', 'C', 'I'] })
  @IsIn(['R', 'A', 'C', 'I'])
  raci: string;
}

class SetDomainAssignmentsDto {
  @ApiProperty({
    description: '割当一覧（まるごと置き換え）',
    type: [DomainAssignmentItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DomainAssignmentItemDto)
  items: DomainAssignmentItemDto[];
}

@ApiTags('ステークホルダー')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/stakeholders')
export class StakeholderController {
  constructor(
    private readonly createStakeholderUseCase: CreateStakeholderUseCase,
    private readonly getStakeholdersUseCase: GetStakeholdersUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ステークホルダー一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<StakeholderOutput[]> {
    return this.getStakeholdersUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ステークホルダー作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateStakeholderDto,
  ): Promise<StakeholderOutput> {
    return this.createStakeholderUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      affiliation: dto.affiliation,
      role: dto.role,
      interest: dto.interest,
      concern: dto.concern,
      influence: dto.influence,
      support: dto.support,
      engagement: dto.engagement,
      reportFrequency: dto.reportFrequency,
      contactMethod: dto.contactMethod,
      owner: dto.owner,
      reportLine: dto.reportLine,
      asisHearing: dto.asisHearing,
      tobeSparring: dto.tobeSparring,
      note: dto.note,
      side: dto.side,
      order: dto.order,
    });
  }
}

@ApiTags('ステークホルダー')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('stakeholders')
export class StakeholderByIdController {
  constructor(
    private readonly updateStakeholderUseCase: UpdateStakeholderUseCase,
    private readonly deleteStakeholderUseCase: DeleteStakeholderUseCase,
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'ステークホルダー更新' })
  @ApiParam({ name: 'id', description: 'ステークホルダーID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ステークホルダーが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateStakeholderDto,
  ): Promise<StakeholderOutput> {
    return this.updateStakeholderUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      name: dto.name,
      affiliation: dto.affiliation,
      role: dto.role,
      interest: dto.interest,
      concern: dto.concern,
      influence: dto.influence,
      support: dto.support,
      engagement: dto.engagement,
      reportFrequency: dto.reportFrequency,
      contactMethod: dto.contactMethod,
      owner: dto.owner,
      reportLine: dto.reportLine,
      asisHearing: dto.asisHearing,
      tobeSparring: dto.tobeSparring,
      note: dto.note,
      side: dto.side,
      order: dto.order,
    });
  }

  @Put(':id/domain-assignments')
  @ApiOperation({
    summary: '担当領域（サブプロジェクト×RACI）をまるごと置き換え',
  })
  @ApiParam({ name: 'id', description: 'ステークホルダーID' })
  @ApiResponse({ status: 400, description: '別プロジェクトの領域が含まれています' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ステークホルダー/領域が見つかりません' })
  async setDomainAssignments(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SetDomainAssignmentsDto,
  ): Promise<{
    stakeholderId: string;
    items: { subProjectId: string; raci: string | null }[];
  }> {
    const stakeholder = await this.prisma.stakeholder.findUnique({
      where: { id },
      select: { id: true, projectId: true },
    });
    if (!stakeholder) {
      throw new NotFoundException(`Stakeholder not found: ${id}`);
    }

    // 組織メンバーシップ認可（stakeholder.projectId → project.organizationId）
    const project = await this.prisma.project.findUnique({
      where: { id: stakeholder.projectId },
      select: { organizationId: true },
    });
    if (!project) {
      throw new NotFoundException(`Project not found: ${stakeholder.projectId}`);
    }
    await assertOrganizationMember(this.prisma, project.organizationId, user.id);
    // プロジェクト単位 RBAC: 担当領域の置換は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      user,
      stakeholder.projectId,
      'edit',
    );

    // subProjectId の重複は後勝ちで畳む
    const deduped = new Map<string, string>();
    for (const item of dto.items) {
      deduped.set(item.subProjectId, item.raci);
    }
    const subProjectIds = Array.from(deduped.keys());

    // 存在＋同一プロジェクト検証
    if (subProjectIds.length > 0) {
      const subProjects = await this.prisma.subProject.findMany({
        where: { id: { in: subProjectIds } },
        select: { id: true, projectId: true },
      });
      const found = new Map(subProjects.map((s) => [s.id, s.projectId]));
      for (const subProjectId of subProjectIds) {
        const projectId = found.get(subProjectId);
        if (projectId === undefined) {
          throw new NotFoundException(`SubProject not found: ${subProjectId}`);
        }
        if (projectId !== stakeholder.projectId) {
          throw new BadRequestException(
            'SubProject does not belong to the same project as the stakeholder',
          );
        }
      }
    }

    // join行の置き換え
    await this.prisma.$transaction([
      this.prisma.stakeholderSubProject.deleteMany({
        where: { stakeholderId: id },
      }),
      ...(subProjectIds.length > 0
        ? [
            this.prisma.stakeholderSubProject.createMany({
              data: subProjectIds.map((subProjectId) => ({
                id: randomUUID(),
                stakeholderId: id,
                subProjectId,
                raci: deduped.get(subProjectId),
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ]);

    const rows = await this.prisma.stakeholderSubProject.findMany({
      where: { stakeholderId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      stakeholderId: id,
      items: rows.map((r) => ({
        subProjectId: r.subProjectId,
        raci: r.raci,
      })),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ステークホルダー削除' })
  @ApiParam({ name: 'id', description: 'ステークホルダーID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ステークホルダーが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteStakeholderUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
    return { success: true };
  }
}

@ApiTags('ステークホルダー')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/stakeholder-assignments')
export class StakeholderAssignmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'プロジェクト全体のステークホルダー×領域 RACI 割当一覧',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<
    {
      stakeholderId: string;
      subProjectId: string;
      raci: string | null;
    }[]
  > {
    // 組織メンバーシップ認可（projectId → project.organizationId）
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true },
    });
    if (!project) {
      throw new NotFoundException(`Project not found: ${projectId}`);
    }
    await assertOrganizationMember(this.prisma, project.organizationId, user.id);

    const rows = await this.prisma.stakeholderSubProject.findMany({
      where: { stakeholder: { projectId } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      stakeholderId: r.stakeholderId,
      subProjectId: r.subProjectId,
      raci: r.raci,
    }));
  }
}
