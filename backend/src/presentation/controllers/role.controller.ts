import { Controller, Post, Get, Put, Patch, Delete, Body, Param, HttpCode, HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsArray, IsString, IsNumber, IsOptional } from 'class-validator';
import {
  CreateRoleUseCase,
  GetRolesUseCase,
  UpdateRoleUseCase,
} from '../../application';
import {
  CreateRoleRequestDto,
  UpdateRoleRequestDto,
  RoleResponseDto,
  RoleTypeDto,
} from '../dto';
import { Inject } from '@nestjs/common';
import { ROLE_REPOSITORY, RoleRepository, EntityNotFoundError, ForbiddenError } from '../../domain';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

class UpdateRoleOrderDto {
  @IsArray()
  @IsString({ each: true })
  roleIds: string[]; // 並び替え後のロールID配列
}

class UpdateRoleLaneHeightDto {
  @IsNumber()
  laneHeight: number;
}

@ApiTags('ロール')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('roles')
export class RoleController {
  constructor(
    private readonly createRoleUseCase: CreateRoleUseCase,
    private readonly getRolesUseCase: GetRolesUseCase,
    private readonly updateRoleUseCase: UpdateRoleUseCase,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepository: RoleRepository,
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** roleId -> projectId を解決して edit 強制（:id 書込用） */
  private async assertRoleEditAccess(id: string, principal: CurrentUserPayload): Promise<void> {
    const row = await this.prisma.role.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!row) throw new EntityNotFoundError('Role', id);
    await this.projectAccess.assertPrincipalAccess(principal, row.projectId, 'edit');
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'ロール一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '成功', type: [RoleResponseDto] })
  async findByProject(
    @Param('projectId') projectId: string,
  ): Promise<RoleResponseDto[]> {
    const result = await this.getRolesUseCase.execute({
      projectId,
    });
    return result.map((r) => ({
      ...r,
      type: r.type as RoleTypeDto,
    }));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ロール作成' })
  @ApiResponse({ status: 201, description: '作成成功', type: RoleResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  @ApiResponse({ status: 409, description: '同名のロールが既に存在します' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateRoleRequestDto,
  ): Promise<RoleResponseDto> {
    await this.projectAccess.assertPrincipalAccess(user, dto.projectId, 'edit');
    const result = await this.createRoleUseCase.execute({
      projectId: dto.projectId,
      name: dto.name,
      type: dto.type,
      description: dto.description,
      color: dto.color,
      responsibility: dto.responsibility,
      decisionScope: dto.decisionScope,
      kpi: dto.kpi,
      systemId: dto.systemId,
      subProjectId: dto.subProjectId,
    });
    return {
      ...result,
      type: result.type as RoleTypeDto,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'ロール更新（責務・決裁範囲・KPI 等）' })
  @ApiParam({ name: 'id', description: 'ロールID' })
  @ApiResponse({ status: 200, description: '更新成功', type: RoleResponseDto })
  @ApiResponse({ status: 404, description: 'ロールが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRoleRequestDto,
  ): Promise<RoleResponseDto> {
    await this.assertRoleEditAccess(id, user);
    const result = await this.updateRoleUseCase.execute({
      id,
      name: dto.name,
      type: dto.type,
      description: dto.description,
      color: dto.color,
      responsibility: dto.responsibility,
      decisionScope: dto.decisionScope,
      kpi: dto.kpi,
      systemId: dto.systemId,
      subProjectId: dto.subProjectId,
    });
    return {
      ...result,
      type: result.type as RoleTypeDto,
    };
  }

  @Put('project/:projectId/order')
  @ApiOperation({ summary: 'ロールの並び順を更新' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateOrder(
    @Param('projectId') projectId: string,
    @Body() dto: UpdateRoleOrderDto,
  ): Promise<RoleResponseDto[]> {
    // 越境防止(IDOR): body の全 roleId が :projectId に属することを検証してから並び替える。
    // ガードは :projectId への edit しか強制しないため、他プロジェクトのロールIDを混ぜて
    // その order を書き換える攻撃を、$transaction 前にここで弾く。
    const roleIds = dto.roleIds ?? [];
    if (roleIds.length > 0) {
      const owned = await this.prisma.role.findMany({
        where: { id: { in: roleIds }, projectId },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((r) => r.id));
      const foreign = roleIds.filter((id) => !ownedIds.has(id));
      if (foreign.length > 0) {
        throw new ForbiddenError(
          '指定されたロールにこのプロジェクト外のものが含まれています',
        );
      }
    }

    // トランザクションで一括更新
    await this.prisma.$transaction(
      dto.roleIds.map((roleId, index) =>
        this.prisma.role.update({
          where: { id: roleId },
          data: { order: index },
        })
      )
    );

    // 更新後のロール一覧を返す
    const roles = await this.prisma.role.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });

    return roles.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      type: r.type as RoleTypeDto,
      description: r.description,
      color: r.color,
      order: r.order,
      laneHeight: r.laneHeight,
      responsibility: r.responsibility,
      decisionScope: r.decisionScope,
      kpi: r.kpi,
      systemId: r.systemId,
      subProjectId: r.subProjectId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  @Put(':id/lane-height')
  @ApiOperation({ summary: 'ロールのレーン高さを更新' })
  @ApiParam({ name: 'id', description: 'ロールID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  async updateLaneHeight(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRoleLaneHeightDto,
  ): Promise<RoleResponseDto> {
    await this.assertRoleEditAccess(id, user);
    const role = await this.prisma.role.update({
      where: { id },
      data: { laneHeight: dto.laneHeight },
    });

    return {
      id: role.id,
      projectId: role.projectId,
      name: role.name,
      type: role.type as RoleTypeDto,
      description: role.description,
      color: role.color,
      order: role.order,
      laneHeight: role.laneHeight,
      responsibility: role.responsibility,
      decisionScope: role.decisionScope,
      kpi: role.kpi,
      systemId: role.systemId,
      subProjectId: role.subProjectId,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ロール削除' })
  @ApiResponse({ status: 200, description: '削除成功' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.assertRoleEditAccess(id, user);
    await this.roleRepository.delete(id);
    return { success: true };
  }
}

