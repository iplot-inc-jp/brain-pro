import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsString, IsOptional, IsIn, IsDateString } from 'class-validator';
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
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

// ========== 定数 ==========

const ADOPTION_STAGES = [
  'NOT_STARTED',
  'INFORMED',
  'TRAINED',
  'TRIAL',
  'LIVE',
  'ESTABLISHED',
] as const;

// ========== DTOs ==========

class UpsertAdoptionStatusDto {
  @ApiProperty({ description: 'ステークホルダーID' })
  @IsString()
  stakeholderId: string;

  @ApiProperty({
    description: '対象システムID（null = プロジェクト全体）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  systemId?: string | null;

  @ApiProperty({
    description:
      '定着度（NOT_STARTED=未着手 / INFORMED=説明済 / TRAINED=トレーニング済 / TRIAL=試行中 / LIVE=本稼働 / ESTABLISHED=定着）',
    required: false,
    enum: ADOPTION_STAGES,
  })
  @IsOptional()
  @IsIn([...ADOPTION_STAGES])
  stage?: string;

  @ApiProperty({ description: '阻害要因', required: false, nullable: true })
  @IsOptional()
  @IsString()
  blockers?: string | null;

  @ApiProperty({
    description: '次のアクション',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  nextAction?: string | null;

  @ApiProperty({ description: 'メモ', required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiProperty({
    description: '最終接触日時（ISO 8601）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  lastContactAt?: string | null;
}

// ========== 共通認可ヘルパー ==========

// project → org メンバー確認（スーパー管理者は常に許可）
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

@ApiTags('導入状況')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/adoption-statuses')
export class AdoptionStatusController {
  constructor(private readonly prisma: PrismaService) {}

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
      throw new ValidationError('Stakeholder does not belong to this project');
    }
  }

  // システムが存在し、同一プロジェクトに属するか検証
  private async assertSystemInProject(
    systemId: string,
    projectId: string,
  ): Promise<void> {
    const system = await this.prisma.system.findUnique({
      where: { id: systemId },
      select: { projectId: true },
    });
    if (!system) {
      throw new EntityNotFoundError('System', systemId);
    }
    if (system.projectId !== projectId) {
      throw new ValidationError('System does not belong to this project');
    }
  }

  @Get()
  @ApiOperation({ summary: 'プロジェクトの導入状況一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);

    return this.prisma.adoptionStatus.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Put('upsert')
  @ApiOperation({
    summary: '導入状況 upsert（(projectId, stakeholderId, systemId) で一意）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: UpsertAdoptionStatusDto,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);
    await this.assertStakeholderInProject(dto.stakeholderId, projectId);

    // 空文字は null に正規化（'' のまま書くと FK 違反で 500 になるため）
    const systemId = dto.systemId || null;
    if (systemId) {
      await this.assertSystemInProject(systemId, projectId);
    }

    const data: {
      stage?: string;
      blockers?: string | null;
      nextAction?: string | null;
      note?: string | null;
      lastContactAt?: Date | null;
    } = {};
    if (dto.stage !== undefined) data.stage = dto.stage;
    if (dto.blockers !== undefined) data.blockers = dto.blockers;
    if (dto.nextAction !== undefined) data.nextAction = dto.nextAction;
    if (dto.note !== undefined) data.note = dto.note;
    if (dto.lastContactAt !== undefined)
      data.lastContactAt = dto.lastContactAt
        ? new Date(dto.lastContactAt)
        : null;

    // systemId が null の場合 Prisma の複合ユニーク where が使えないため
    // findFirst → update / create で upsert する。
    // 重複が存在しても常に同じ行を更新するよう createdAt 昇順で先頭を取る。
    // NOTE: systemId IS NULL の行は Postgres の @@unique では重複を防げない
    // （NULL 同士は distinct 扱い）。後続のマイグレーションフェーズで部分
    // ユニークインデックス (project_id, stakeholder_id) WHERE system_id IS NULL
    // を追加予定。
    const findExisting = () =>
      this.prisma.adoptionStatus.findFirst({
        where: { projectId, stakeholderId: dto.stakeholderId, systemId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });

    const existing = await findExisting();
    if (existing) {
      return this.prisma.adoptionStatus.update({
        where: { id: existing.id },
        data,
      });
    }

    try {
      return await this.prisma.adoptionStatus.create({
        data: {
          projectId,
          stakeholderId: dto.stakeholderId,
          systemId,
          ...data,
        },
      });
    } catch (e) {
      // 同時 upsert 競合: 別リクエストが先に create して一意制約違反（P2002）
      // になった場合は、既存行への update に切り替えて再試行する
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const raced = await findExisting();
        if (raced) {
          return this.prisma.adoptionStatus.update({
            where: { id: raced.id },
            data,
          });
        }
      }
      throw e;
    }
  }
}

@ApiTags('導入状況')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('adoption-statuses')
export class AdoptionStatusByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '導入状況削除' })
  @ApiParam({ name: 'id', description: '導入状況ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '導入状況が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    const record = await this.prisma.adoptionStatus.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!record) {
      throw new EntityNotFoundError('AdoptionStatus', id);
    }
    await this.projectAccess.assertPrincipalAccess(user, record.projectId, 'edit');

    await this.prisma.adoptionStatus.delete({ where: { id } });
    return { success: true };
  }
}
