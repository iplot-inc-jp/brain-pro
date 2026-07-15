import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, HttpCode, Inject,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiProperty } from '@nestjs/swagger';
import {
  IsArray, IsIn, IsNumber, IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GetFlowDfdUseCase,
  GenerateFlowDfdUseCase,
  GetProjectDfdUseCase,
  GenerateProjectDfdUseCase,
  AddDfdNodeUseCase,
  UpdateDfdNodeUseCase,
  DeleteDfdNodeUseCase,
  AddDfdFlowUseCase,
  UpdateDfdFlowUseCase,
  DeleteDfdFlowUseCase,
  SaveDfdPositionsUseCase,
} from '../../application';
import {
  DFD_REPOSITORY, IDfdRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../domain';
import { DfdNodeKindValue } from '../../domain/entities/dfd-node.entity';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

const KINDS = ['FUNCTION', 'EXTERNAL_ENTITY', 'DATA_STORE'];

class AddNodeDto {
  @IsIn(KINDS) kind!: DfdNodeKindValue;
  @IsString() label!: string;
  @IsOptional() @IsString() number?: string | null;
  @IsOptional() @IsString() refFlowId?: string | null;
  @IsOptional() @IsString() refNodeId?: string | null;
  @IsOptional() @IsString() dataObjectId?: string | null;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
}

class UpdateNodeDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() number?: string | null;
  @IsOptional() @IsIn(KINDS) kind?: DfdNodeKindValue;
  @IsOptional() @IsString() dataObjectId?: string | null;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
}

class AddFlowDto {
  @IsString() sourceNodeId!: string;
  @IsString() targetNodeId!: string;
  @IsOptional() @IsString() sourceHandle?: string | null;
  @IsOptional() @IsString() targetHandle?: string | null;
  @IsOptional() @IsString() dataItem?: string;
  @IsOptional() @IsString() informationTypeId?: string | null;
  @IsOptional() @IsString() pathStyle?: string | null;
  @IsOptional() @IsNumber() labelT?: number | null;
  @IsOptional() @IsNumber() infoT?: number | null;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateFlowDto {
  @IsOptional() @IsString() dataItem?: string;
  @IsOptional() @IsString() informationTypeId?: string | null;
  @IsOptional() @IsString() pathStyle?: string | null;
  @IsOptional() @IsNumber() labelT?: number | null;
  @IsOptional() @IsNumber() infoT?: number | null;
  @IsOptional() @IsString() sourceNodeId?: string;
  @IsOptional() @IsString() targetNodeId?: string;
  @IsOptional() @IsString() sourceHandle?: string | null;
  @IsOptional() @IsString() targetHandle?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class PositionItemDto {
  @IsString() id!: string;
  @IsNumber() positionX!: number;
  @IsNumber() positionY!: number;
}

class SavePositionsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PositionItemDto)
  positions!: PositionItemDto[];
}

// ===== 注釈（付箋・コメント）DTOs（business-flow の FlowAnnotation と同形） =====

const ANNOTATION_KINDS = ['STICKY', 'COMMENT', 'ICON', 'SCOPE'] as const;
type DfdAnnotationKind = (typeof ANNOTATION_KINDS)[number];

class CreateDfdAnnotationDto {
  @ApiProperty({ description: '注釈種別', enum: ANNOTATION_KINDS, required: false })
  @IsOptional() @IsIn(ANNOTATION_KINDS as readonly string[])
  kind?: DfdAnnotationKind;

  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;

  @ApiProperty({ description: '幅（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional() @IsNumber() width?: number | null;

  @ApiProperty({ description: '高さ（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional() @IsNumber() height?: number | null;

  @ApiProperty({ description: '色（任意）', required: false, nullable: true })
  @IsOptional() @IsString() color?: string | null;

  @ApiProperty({ description: 'アイコン名（kind=ICONのとき）', required: false, nullable: true })
  @IsOptional() @IsString() icon?: string | null;

  @ApiProperty({
    description: '枠線スタイル（kind=SCOPEのとき）',
    enum: ['dashed', 'solid'],
    required: false,
    nullable: true,
  })
  @IsOptional() @IsIn(['dashed', 'solid'])
  borderStyle?: 'dashed' | 'solid' | null;

  @ApiProperty({
    description: '背景塗りの不透明度 0〜1（kind=SCOPEのとき）',
    required: false,
    nullable: true,
  })
  @IsOptional() @IsNumber() @Min(0) @Max(1)
  fillOpacity?: number | null;
}

class UpdateDfdAnnotationDto {
  @ApiProperty({ description: '注釈種別', enum: ANNOTATION_KINDS, required: false })
  @IsOptional() @IsIn(ANNOTATION_KINDS as readonly string[])
  kind?: DfdAnnotationKind;

  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;

  @ApiProperty({ description: '幅（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional() @IsNumber() width?: number | null;

  @ApiProperty({ description: '高さ（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional() @IsNumber() height?: number | null;

  @ApiProperty({ description: '色（任意）', required: false, nullable: true })
  @IsOptional() @IsString() color?: string | null;

  @ApiProperty({ description: 'アイコン名（kind=ICONのとき）', required: false, nullable: true })
  @IsOptional() @IsString() icon?: string | null;

  @ApiProperty({
    description: '枠線スタイル（kind=SCOPEのとき）',
    enum: ['dashed', 'solid'],
    required: false,
    nullable: true,
  })
  @IsOptional() @IsIn(['dashed', 'solid'])
  borderStyle?: 'dashed' | 'solid' | null;

  @ApiProperty({
    description: '背景塗りの不透明度 0〜1（kind=SCOPEのとき）',
    required: false,
    nullable: true,
  })
  @IsOptional() @IsNumber() @Min(0) @Max(1)
  fillOpacity?: number | null;
}

@ApiTags('DFD（データフロー図）')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class DfdController {
  constructor(
    private readonly getFlowDfd: GetFlowDfdUseCase,
    private readonly generateFlowDfd: GenerateFlowDfdUseCase,
    private readonly getProjectDfd: GetProjectDfdUseCase,
    private readonly generateProjectDfd: GenerateProjectDfdUseCase,
    private readonly addNode: AddDfdNodeUseCase,
    private readonly updateNode: UpdateDfdNodeUseCase,
    private readonly deleteNode: DeleteDfdNodeUseCase,
    private readonly addFlow: AddDfdFlowUseCase,
    private readonly updateFlow: UpdateDfdFlowUseCase,
    private readonly deleteFlow: DeleteDfdFlowUseCase,
    private readonly savePositions: SaveDfdPositionsUseCase,
    @Inject(DFD_REPOSITORY) private readonly dfdRepo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  // ========== 第2レベル（フロー） ==========

  @Get('business-flows/:flowId/dfd')
  @ApiOperation({ summary: '第2レベルDFD取得（get-or-create）' })
  async getByFlow(@CurrentUser() user: CurrentUserPayload, @Param('flowId') flowId: string) {
    return this.getFlowDfd.execute({ userId: user.id, principal: user, flowId });
  }

  @Post('business-flows/:flowId/dfd')
  @ApiOperation({ summary: '第2レベルDFD生成（冪等同期）' })
  async generateByFlow(@CurrentUser() user: CurrentUserPayload, @Param('flowId') flowId: string) {
    return this.generateFlowDfd.execute({ userId: user.id, principal: user, flowId });
  }

  // ========== 第1レベル（プロジェクト） ==========

  @Get('projects/:projectId/dfd')
  @ApiOperation({ summary: '第1レベルDFD取得（get-or-create）' })
  async getByProject(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.getProjectDfd.execute({ userId: user.id, projectId });
  }

  @Post('projects/:projectId/dfd')
  @ApiOperation({ summary: '第1レベルDFD生成（フロー＋FlowNodeLink, 冪等同期）' })
  async generateByProject(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.generateProjectDfd.execute({ userId: user.id, projectId });
  }

  // ========== ノード ==========

  @Post('dfd-diagrams/:diagramId/nodes')
  @ApiOperation({ summary: 'DFDノード追加' })
  async createNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: AddNodeDto,
  ) {
    return this.addNode.execute({ userId: user.id, principal: user, diagramId, ...dto });
  }

  @Patch('dfd-nodes/:id')
  @ApiOperation({ summary: 'DFDノード更新' })
  async patchNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateNodeDto,
  ) {
    return this.updateNode.execute({ userId: user.id, principal: user, id, ...dto });
  }

  @Delete('dfd-nodes/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'DFDノード削除' })
  async removeNode(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteNode.execute({ userId: user.id, principal: user, id });
  }

  // ========== データフロー ==========

  @Post('dfd-diagrams/:diagramId/flows')
  @ApiOperation({ summary: 'データフロー追加' })
  async createFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: AddFlowDto,
  ) {
    return this.addFlow.execute({ userId: user.id, principal: user, diagramId, ...dto });
  }

  @Patch('dfd-flows/:id')
  @ApiOperation({ summary: 'データフロー更新' })
  async patchFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFlowDto,
  ) {
    return this.updateFlow.execute({ userId: user.id, principal: user, id, ...dto });
  }

  @Delete('dfd-flows/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'データフロー削除' })
  async removeFlow(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteFlow.execute({ userId: user.id, principal: user, id });
  }

  // ========== 位置一括保存 ==========

  @Put('dfd-diagrams/:diagramId/positions')
  @HttpCode(204)
  @ApiOperation({ summary: 'ノード位置一括保存' })
  async putPositions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: SavePositionsDto,
  ) {
    await this.savePositions.execute({ userId: user.id, principal: user, diagramId, positions: dto.positions });
  }

  // ========== 注釈（付箋・コメント） ==========

  @Get('dfd-diagrams/:diagramId/annotations')
  @ApiOperation({ summary: 'DFDの注釈（付箋・コメント）一覧を取得' })
  async getAnnotations(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
  ) {
    // 認可: diagram -> project -> organization メンバーシップ
    await this.assertDiagramMembership(diagramId, user);

    const rows = await this.prisma.dfdAnnotation.findMany({
      where: { diagramId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((a) => this.annotationToResponse(a));
  }

  @Post('dfd-diagrams/:diagramId/annotations')
  @ApiOperation({ summary: 'DFDの注釈（付箋・コメント）を作成' })
  async createAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('diagramId') diagramId: string,
    @Body() dto: CreateDfdAnnotationDto,
  ) {
    // 認可: diagram -> project -> organization メンバーシップ + edit 強制
    await this.assertDiagramMembership(diagramId, user, 'edit');

    const created = await this.prisma.dfdAnnotation.create({
      data: {
        diagramId,
        kind: dto.kind ?? 'STICKY',
        text: dto.text ?? '',
        positionX: dto.positionX ?? 0,
        positionY: dto.positionY ?? 0,
        width: dto.width ?? null,
        height: dto.height ?? null,
        color: dto.color ?? null,
        icon: dto.icon ?? null,
        borderStyle: dto.borderStyle ?? null,
        fillOpacity: dto.fillOpacity ?? null,
      },
    });

    return this.annotationToResponse(created);
  }

  @Patch('dfd-annotations/:id')
  @ApiOperation({ summary: 'DFDの注釈（付箋・コメント）を部分更新' })
  async updateAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDfdAnnotationDto,
  ) {
    const annotation = await this.prisma.dfdAnnotation.findUnique({ where: { id } });
    if (!annotation) throw new EntityNotFoundError('DfdAnnotation', id);
    // 認可: annotation -> diagram -> project -> organization メンバーシップ + edit 強制
    await this.assertDiagramMembership(annotation.diagramId, user, 'edit');

    const data: {
      kind?: DfdAnnotationKind;
      text?: string;
      positionX?: number;
      positionY?: number;
      width?: number | null;
      height?: number | null;
      color?: string | null;
      icon?: string | null;
      borderStyle?: string | null;
      fillOpacity?: number | null;
    } = {};
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.text !== undefined) data.text = dto.text;
    if (dto.positionX !== undefined) data.positionX = dto.positionX;
    if (dto.positionY !== undefined) data.positionY = dto.positionY;
    if (dto.width !== undefined) data.width = dto.width;
    if (dto.height !== undefined) data.height = dto.height;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.borderStyle !== undefined) data.borderStyle = dto.borderStyle;
    if (dto.fillOpacity !== undefined) data.fillOpacity = dto.fillOpacity;

    const updated = await this.prisma.dfdAnnotation.update({ where: { id }, data });
    return this.annotationToResponse(updated);
  }

  @Delete('dfd-annotations/:id')
  @ApiOperation({ summary: 'DFDの注釈（付箋・コメント）を削除' })
  async deleteAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const annotation = await this.prisma.dfdAnnotation.findUnique({ where: { id } });
    if (!annotation) throw new EntityNotFoundError('DfdAnnotation', id);
    // 認可: annotation -> diagram -> project -> organization メンバーシップ + edit 強制
    await this.assertDiagramMembership(annotation.diagramId, user, 'edit');

    await this.prisma.dfdAnnotation.delete({ where: { id } });
    return { success: true };
  }

  /**
   * diagram -> project -> organization のメンバーシップ認可。
   * 併せてプロジェクト単位 RBAC（VIEW/EDIT）を強制する（既定 view、書込は edit）。
   */
  private async assertDiagramMembership(
    diagramId: string,
    principal: CurrentUserPayload,
    required: 'view' | 'edit' = 'view',
  ): Promise<void> {
    const diagram = await this.dfdRepo.findDiagramById(diagramId);
    if (!diagram) throw new EntityNotFoundError('DfdDiagram', diagramId);
    const project = await this.projectRepo.findById(diagram.projectId);
    if (!project) throw new EntityNotFoundError('Project', diagram.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, principal.id))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    await this.projectAccess.assertPrincipalAccess(principal, diagram.projectId, required);
  }

  private annotationToResponse(a: {
    id: string;
    kind: string;
    text: string;
    positionX: number;
    positionY: number;
    width: number | null;
    height: number | null;
    color: string | null;
    icon: string | null;
    borderStyle: string | null;
    fillOpacity: number | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: a.id,
      kind: a.kind,
      text: a.text,
      positionX: a.positionX,
      positionY: a.positionY,
      width: a.width,
      height: a.height,
      color: a.color,
      icon: a.icon,
      borderStyle: a.borderStyle,
      fillOpacity: a.fillOpacity,
      order: a.order,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
