import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ClaudeService, RequirementParseResult } from '../../infrastructure/services/claude.service';
import { CompanyKeyService } from '../../infrastructure/services/company-key.service';
import { v4 as uuid } from 'uuid';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

// DTOs
class CreateRequirementDto {
  @IsString()
  projectId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  originalText?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

class UpdateRequirementDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

class ParseRequirementsDto {
  @IsString()
  projectId: string;

  @IsString()
  text: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

class LinkFlowDto {
  @IsString()
  flowId: string;

  @IsOptional()
  @IsString()
  flowNodeId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class LinkCrudDto {
  @IsString()
  crudMappingId: string;

  @IsOptional()
  @IsString()
  description?: string;
}

@ApiTags('Requirements')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('requirements')
export class RequirementController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claudeService: ClaudeService,
    private readonly companyKeyService: CompanyKeyService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** requirement.id -> projectId を解決して指定レベルを強制（:id 系の view/edit 用） */
  private async assertRequirementAccess(
    id: string,
    userId: string,
    required: 'view' | 'edit',
  ): Promise<{ projectId: string }> {
    const row = await this.prisma.requirement.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!row) {
      throw new HttpException('Requirement not found', HttpStatus.NOT_FOUND);
    }
    await this.projectAccess.assertProjectAccess(row.projectId, userId, required);
    return { projectId: row.projectId };
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'プロジェクトの要求一覧を取得' })
  async getByProjectId(
    @Param('projectId') projectId: string,
    @Query('parentId') parentId?: string,
  ) {
    const where: any = { projectId };
    if (parentId === 'null' || parentId === undefined) {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parentId;
    }

    const requirements = await this.prisma.requirement.findMany({
      where,
      include: {
        children: {
          include: {
            children: true,
          },
          orderBy: { order: 'asc' },
        },
        flowMappings: {
          include: {
            flow: true,
            flowNode: true,
          },
        },
        crudMappings: {
          include: {
            crudMapping: {
              include: {
                column: {
                  include: { table: true },
                },
              },
            },
          },
        },
      },
      orderBy: { order: 'asc' },
    });

    return requirements.map((r) => this.toResponse(r));
  }

  @Get(':id')
  @ApiOperation({ summary: '要求詳細を取得' })
  async getById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.assertRequirementAccess(id, user.id, 'view');
    const requirement = await this.prisma.requirement.findUnique({
      where: { id },
      include: {
        parent: true,
        children: {
          include: {
            children: true,
          },
          orderBy: { order: 'asc' },
        },
        flowMappings: {
          include: {
            flow: true,
            flowNode: true,
          },
        },
        crudMappings: {
          include: {
            crudMapping: {
              include: {
                column: {
                  include: { table: true },
                },
              },
            },
          },
        },
      },
    });

    if (!requirement) {
      throw new HttpException('Requirement not found', HttpStatus.NOT_FOUND);
    }

    return this.toResponse(requirement);
  }

  @Post()
  @ApiOperation({ summary: '要求を作成' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateRequirementDto,
  ) {
    await this.projectAccess.assertProjectAccess(dto.projectId, user.id, 'edit');
    // 親要求がある場合はdepthを計算
    let depth = 0;
    if (dto.parentId) {
      const parent = await this.prisma.requirement.findUnique({
        where: { id: dto.parentId },
      });
      if (parent) {
        depth = parent.depth + 1;
      }
    }

    // orderを計算（同じ親の中での順番）
    const siblings = await this.prisma.requirement.count({
      where: {
        projectId: dto.projectId,
        parentId: dto.parentId || null,
      },
    });

    // 要求番号を生成
    const reqCount = await this.prisma.requirement.count({
      where: { projectId: dto.projectId },
    });
    const code = `REQ-${String(reqCount + 1).padStart(3, '0')}`;

    const requirement = await this.prisma.requirement.create({
      data: {
        id: uuid(),
        projectId: dto.projectId,
        parentId: dto.parentId,
        depth,
        order: siblings,
        code,
        title: dto.title,
        description: dto.description,
        originalText: dto.originalText,
        type: (dto.type as any) || 'FUNCTIONAL',
        priority: (dto.priority as any) || 'MEDIUM',
        status: (dto.status as any) || 'DRAFT',
      },
      include: {
        children: true,
        flowMappings: true,
        crudMappings: true,
      },
    });

    return this.toResponse(requirement);
  }

  @Put(':id')
  @ApiOperation({ summary: '要求を更新' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    await this.assertRequirementAccess(id, user.id, 'edit');
    const requirement = await this.prisma.requirement.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type as any,
        priority: dto.priority as any,
        status: dto.status as any,
        order: dto.order,
      },
      include: {
        children: true,
        flowMappings: true,
        crudMappings: true,
      },
    });

    return this.toResponse(requirement);
  }

  @Delete(':id')
  @ApiOperation({ summary: '要求を削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.assertRequirementAccess(id, user.id, 'edit');
    await this.prisma.requirement.delete({ where: { id } });
    return { success: true };
  }

  // ========== AI変換機能 ==========

  @Post('parse')
  @ApiOperation({ summary: '自然言語から要求を生成（AI）' })
  async parseRequirements(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ParseRequirementsDto,
  ) {
    await this.projectAccess.assertProjectAccess(dto.projectId, user.id, 'edit');
    // APIキーを取得（会社(Organization)キー > ユーザー設定 > 環境変数）
    const apiKey = await this.companyKeyService.resolveForProject(
      dto.projectId,
      user.id,
    );
    if (!apiKey) {
      throw new HttpException(
        'Anthropic APIキーが未設定です',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Claude APIで要求を解析
    const result = await this.claudeService.parseRequirements(dto.text, apiKey, {
      projectId: dto.projectId,
      area: 'REQUIREMENT',
      userId: user.id,
    });

    // 解析結果をDBに保存
    const savedRequirements = await this.saveRequirements(
      result.requirements,
      dto.projectId,
      dto.parentId,
      dto.text,
    );

    return {
      parsed: result,
      saved: savedRequirements,
    };
  }

  @Post(':id/refine')
  @ApiOperation({ summary: '要求を詳細化（AI）' })
  async refineRequirement(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() body: { context?: string },
  ) {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id },
    });

    if (!requirement) {
      throw new HttpException('Requirement not found', HttpStatus.NOT_FOUND);
    }

    await this.projectAccess.assertProjectAccess(
      requirement.projectId,
      user.id,
      'edit',
    );

    // 会社(Organization)キー > ユーザー設定 > 環境変数 の順で解決
    const apiKey = await this.companyKeyService.resolveForProject(
      requirement.projectId,
      user.id,
    );
    if (!apiKey) {
      throw new HttpException(
        'Anthropic APIキーが未設定です',
        HttpStatus.BAD_REQUEST,
      );
    }

    const refined = await this.claudeService.refineRequirement(
      { title: requirement.title, description: requirement.description || '' },
      body.context || '',
      apiKey,
      { projectId: requirement.projectId, area: 'REQUIREMENT', userId: user.id },
    );

    // 更新
    const updated = await this.prisma.requirement.update({
      where: { id },
      data: {
        description: refined.description,
        metadata: {
          ...(requirement.metadata as object),
          acceptanceCriteria: refined.acceptanceCriteria,
        },
      },
    });

    return this.toResponse(updated);
  }

  // ========== 紐付け機能 ==========

  @Post(':id/link-flow')
  @ApiOperation({ summary: '業務フローと紐付け' })
  async linkFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: LinkFlowDto,
  ) {
    await this.assertRequirementAccess(id, user.id, 'edit');
    const mapping = await this.prisma.requirementFlowMapping.create({
      data: {
        id: uuid(),
        requirementId: id,
        flowId: dto.flowId,
        flowNodeId: dto.flowNodeId,
        description: dto.description,
      },
      include: {
        flow: true,
        flowNode: true,
      },
    });

    return mapping;
  }

  @Delete(':id/link-flow/:mappingId')
  @ApiOperation({ summary: '業務フローとの紐付けを解除' })
  async unlinkFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('mappingId') mappingId: string,
  ) {
    await this.assertRequirementAccess(id, user.id, 'edit');
    await this.prisma.requirementFlowMapping.delete({
      where: { id: mappingId },
    });
    return { success: true };
  }

  @Post(':id/link-crud')
  @ApiOperation({ summary: 'CRUDマッピングと紐付け' })
  async linkCrud(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: LinkCrudDto,
  ) {
    await this.assertRequirementAccess(id, user.id, 'edit');
    const mapping = await this.prisma.requirementCrudMapping.create({
      data: {
        id: uuid(),
        requirementId: id,
        crudMappingId: dto.crudMappingId,
        description: dto.description,
      },
      include: {
        crudMapping: {
          include: {
            column: {
              include: { table: true },
            },
          },
        },
      },
    });

    return mapping;
  }

  @Delete(':id/link-crud/:mappingId')
  @ApiOperation({ summary: 'CRUDマッピングとの紐付けを解除' })
  async unlinkCrud(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Param('mappingId') mappingId: string,
  ) {
    await this.assertRequirementAccess(id, user.id, 'edit');
    await this.prisma.requirementCrudMapping.delete({
      where: { id: mappingId },
    });
    return { success: true };
  }

  // ========== Private Methods ==========

  private async saveRequirements(
    requirements: RequirementParseResult['requirements'],
    projectId: string,
    parentId: string | undefined,
    originalText: string,
    depth: number = 0,
  ): Promise<any[]> {
    const saved: any[] = [];

    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i];

      // 要求番号を生成
      const reqCount = await this.prisma.requirement.count({
        where: { projectId },
      });
      const code = `REQ-${String(reqCount + 1).padStart(3, '0')}`;

      const created = await this.prisma.requirement.create({
        data: {
          id: uuid(),
          projectId,
          parentId: parentId || null,
          depth,
          order: i,
          code,
          title: req.title,
          description: req.description,
          originalText: depth === 0 ? originalText : null,
          type: req.type,
          priority: req.priority,
          status: 'DRAFT',
        },
      });

      // 子要求を再帰的に保存
      let children: any[] = [];
      if (req.children && req.children.length > 0) {
        children = await this.saveRequirements(
          req.children,
          projectId,
          created.id,
          originalText,
          depth + 1,
        );
      }

      saved.push({
        ...created,
        children,
      });
    }

    return saved;
  }

  private toResponse(requirement: any) {
    return {
      id: requirement.id,
      projectId: requirement.projectId,
      parentId: requirement.parentId,
      depth: requirement.depth,
      order: requirement.order,
      code: requirement.code,
      title: requirement.title,
      description: requirement.description,
      originalText: requirement.originalText,
      type: requirement.type,
      priority: requirement.priority,
      status: requirement.status,
      metadata: requirement.metadata,
      parent: requirement.parent,
      children: requirement.children?.map((c: any) => this.toResponse(c)),
      flowMappings: requirement.flowMappings,
      crudMappings: requirement.crudMappings,
      createdAt: requirement.createdAt,
      updatedAt: requirement.updatedAt,
    };
  }
}

