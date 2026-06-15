import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Inject,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsIn,
  IsObject,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateNodeLinkUseCase,
  GetNodeLinksUseCase,
  DeleteNodeLinkUseCase,
  CreateNodeChildFlowUseCase,
  GetFlowTreeUseCase,
} from '../../application';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import {
  BUSINESS_FLOW_REPOSITORY,
  IBusinessFlowRepository,
  FLOW_NODE_REPOSITORY,
  IFlowNodeRepository,
  CRUD_MAPPING_REPOSITORY,
  ICrudMappingRepository,
  PROJECT_REPOSITORY,
  ProjectRepository,
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  BusinessFlow,
  FlowNode,
  FlowEdge,
  EntityNotFoundError,
  ForbiddenError,
} from '../../domain';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ClaudeService } from '../../infrastructure/services/claude.service';
import { CompanyKeyService } from '../../infrastructure/services/company-key.service';
import { v4 as uuid } from 'uuid';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';

// DTOs
class CreateBusinessFlowDto {
  @IsString()
  projectId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsIn(['ASIS', 'TOBE'])
  kind?: 'ASIS' | 'TOBE';

  @IsOptional()
  @IsIn(['HYPOTHESIS', 'CONFIRMED'])
  confidence?: 'HYPOTHESIS' | 'CONFIRMED';

  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiProperty({ description: '対応するASISフローID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  asisFlowId?: string | null;

  @ApiProperty({ description: 'フローフォルダID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  folderId?: string | null;
}

class UpdateBusinessFlowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['ASIS', 'TOBE'])
  kind?: 'ASIS' | 'TOBE';

  @IsOptional()
  @IsIn(['HYPOTHESIS', 'CONFIRMED'])
  confidence?: 'HYPOTHESIS' | 'CONFIRMED';

  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiProperty({ description: '対応するASISフローID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  asisFlowId?: string | null;

  @ApiProperty({ description: 'フローフォルダID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  folderId?: string | null;

  @ApiProperty({
    description: 'ロール別スイムレーン高さの手動オーバーライド（{ [roleId]: height }）',
    required: false,
  })
  @IsOptional()
  @IsObject()
  laneHeights?: Record<string, number>;
}

class CreateFlowNodeDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  positionX: number;

  @IsNumber()
  positionY: number;

  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiProperty({ description: '処理時間', required: false, nullable: true })
  @IsOptional()
  @IsString()
  processingTime?: string | null;

  @ApiProperty({ description: '対応数', required: false, nullable: true })
  @IsOptional()
  @IsString()
  handledCount?: string | null;

  @ApiProperty({ description: '補足', required: false, nullable: true })
  @IsOptional()
  @IsString()
  supplement?: string | null;
}

class UpdateFlowNodeDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  @ApiProperty({ description: 'ノード幅（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  width?: number | null;

  @ApiProperty({ description: 'ノード高さ（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  height?: number | null;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({ description: '処理時間', required: false, nullable: true })
  @IsOptional()
  @IsString()
  processingTime?: string | null;

  @ApiProperty({ description: '対応数', required: false, nullable: true })
  @IsOptional()
  @IsString()
  handledCount?: string | null;

  @ApiProperty({ description: '補足', required: false, nullable: true })
  @IsOptional()
  @IsString()
  supplement?: string | null;
}

class NodePositionItemDto {
  @IsString()
  id: string;

  @IsNumber()
  positionX: number;

  @IsNumber()
  positionY: number;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  roleId?: string | null;

  @IsOptional()
  @IsNumber()
  order?: number;
}

class EdgeHandleItemDto {
  @IsString()
  id: string;

  @ApiProperty({ description: '接続元ノードのハンドル（接続辺）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sourceHandle?: string | null;

  @ApiProperty({ description: '接続先ノードのハンドル（接続辺）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  targetHandle?: string | null;
}

class UpdateNodePositionsDto {
  @ApiProperty({ type: [NodePositionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodePositionItemDto)
  positions: NodePositionItemDto[];

  @ApiProperty({
    type: [EdgeHandleItemDto],
    required: false,
    description:
      '整形が算出した各エッジの最近接サイド接続ハンドル（任意）。指定があれば同一リクエストで sourceHandle/targetHandle を更新する。',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeHandleItemDto)
  edges?: EdgeHandleItemDto[];
}

class CreateFlowEdgeDto {
  @IsString()
  sourceNodeId: string;

  @IsString()
  targetNodeId: string;

  @ApiProperty({ description: '接続元ノードのハンドル（接続辺）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sourceHandle?: string;

  @ApiProperty({ description: '接続先ノードのハンドル（接続辺）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  targetHandle?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({
    description: 'この矢印上を流れるデータ（情報種別マスタID）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  informationTypeId?: string | null;

  @ApiProperty({ description: '線の形状 smoothstep|bezier|straight', required: false, nullable: true })
  @IsOptional()
  @IsString()
  pathStyle?: string | null;

  @ApiProperty({ description: 'ラベルのパス上位置(0-1)', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  labelT?: number | null;

  @ApiProperty({ description: '運ぶ情報チップのパス上位置(0-1)', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  infoT?: number | null;
}

class UpdateFlowEdgeDto {
  @ApiProperty({ description: '接続元ノードID（再接続用）', required: false })
  @IsOptional()
  @IsString()
  sourceNodeId?: string;

  @ApiProperty({ description: '接続先ノードID（再接続用）', required: false })
  @IsOptional()
  @IsString()
  targetNodeId?: string;

  @ApiProperty({ description: '接続元ノードのハンドル（接続辺）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sourceHandle?: string;

  @ApiProperty({ description: '接続先ノードのハンドル（接続辺）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  targetHandle?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @ApiProperty({
    description: 'この矢印上を流れるデータ（情報種別マスタID）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  informationTypeId?: string | null;

  @ApiProperty({ description: '線の形状 smoothstep|bezier|straight', required: false, nullable: true })
  @IsOptional()
  @IsString()
  pathStyle?: string | null;

  @ApiProperty({ description: 'ラベルのパス上位置(0-1)', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  labelT?: number | null;

  @ApiProperty({ description: '運ぶ情報チップのパス上位置(0-1)', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  infoT?: number | null;
}

class CreateChildFlowDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

class ImportMermaidDto {
  @IsString()
  mermaid: string;
}

class CreateNodeLinkDto {
  @ApiProperty({ description: 'リンク方向', enum: ['INPUT', 'OUTPUT'] })
  @IsIn(['INPUT', 'OUTPUT'])
  direction: 'INPUT' | 'OUTPUT';

  @ApiProperty({ description: '接続先フローID' })
  @IsString()
  targetFlowId: string;

  @ApiProperty({ description: '接続先ノードID（任意）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  targetNodeId?: string | null;

  @ApiProperty({ description: 'リンクラベル（任意）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  label?: string | null;
}

class CreateNodeChildFlowDto {
  @ApiProperty({ description: '子フロー名（省略時はノードラベル+" 詳細"）', required: false })
  @IsOptional()
  @IsString()
  name?: string;
}

class NodeInformationLinkItemDto {
  @ApiProperty({ description: '情報種別マスタID' })
  @IsString()
  informationTypeId: string;

  @ApiProperty({ description: 'リンク方向', enum: ['INPUT', 'OUTPUT'] })
  @IsIn(['INPUT', 'OUTPUT'])
  direction: 'INPUT' | 'OUTPUT';

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class ReplaceNodeInformationLinksDto {
  @ApiProperty({ type: [NodeInformationLinkItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeInformationLinkItemDto)
  links: NodeInformationLinkItemDto[];
}

// ===== Undo/Redo restore / snapshots DTOs =====

class RestoreNodeInformationLinkDto {
  @IsString()
  informationTypeId: string;

  @IsIn(['INPUT', 'OUTPUT'])
  direction: 'INPUT' | 'OUTPUT';

  @IsOptional()
  @IsNumber()
  order?: number;
}

class RestoreNodeDto {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsString()
  label: string;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsString()
  roleId?: string | null;

  @IsOptional()
  @IsString()
  processingTime?: string | null;

  @IsOptional()
  @IsString()
  handledCount?: string | null;

  @IsOptional()
  @IsString()
  supplement?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  childFlowId?: string | null;

  @ApiProperty({ type: [RestoreNodeInformationLinkDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreNodeInformationLinkDto)
  informationLinks?: RestoreNodeInformationLinkDto[];
}

class RestoreEdgeDto {
  @IsString()
  id: string;

  @IsString()
  sourceNodeId: string;

  @IsString()
  targetNodeId: string;

  @IsOptional()
  @IsString()
  sourceHandle?: string | null;

  @IsOptional()
  @IsString()
  targetHandle?: string | null;

  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @IsString()
  condition?: string | null;

  @IsOptional()
  @IsString()
  informationTypeId?: string | null;

  @IsOptional()
  @IsString()
  pathStyle?: string | null;

  @IsOptional()
  @IsNumber()
  labelT?: number | null;

  @IsOptional()
  @IsNumber()
  infoT?: number | null;
}

class RestoreFlowDto {
  @ApiProperty({ type: [RestoreNodeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreNodeDto)
  nodes: RestoreNodeDto[];

  @ApiProperty({ type: [RestoreEdgeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreEdgeDto)
  edges: RestoreEdgeDto[];
}

class CreateFlowSnapshotDto {
  @ApiProperty({ description: 'スナップショットの表示ラベル（任意）', required: false })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ description: 'フロー編集状態の JSON（nodes/edges 等）' })
  @IsObject()
  data: Record<string, unknown>;
}

// ===== 注釈（付箋・コメント）DTOs =====

class CreateFlowAnnotationDto {
  @ApiProperty({
    description: '注釈種別',
    enum: ['STICKY', 'COMMENT', 'ICON', 'SCOPE'],
    required: false,
  })
  @IsOptional()
  @IsIn(['STICKY', 'COMMENT', 'ICON', 'SCOPE'])
  kind?: 'STICKY' | 'COMMENT' | 'ICON' | 'SCOPE';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  @ApiProperty({ description: '幅（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  width?: number | null;

  @ApiProperty({ description: '高さ（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  height?: number | null;

  @ApiProperty({ description: '色（任意）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiProperty({ description: 'アイコン名（kind=ICONのとき）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  icon?: string | null;

  @ApiProperty({
    description: '枠線スタイル（kind=SCOPEのとき）',
    enum: ['dashed', 'solid'],
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(['dashed', 'solid'])
  borderStyle?: 'dashed' | 'solid' | null;

  @ApiProperty({
    description: '背景塗りの不透明度 0〜1（kind=SCOPEのとき）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  fillOpacity?: number | null;
}

class UpdateFlowAnnotationDto {
  @ApiProperty({
    description: '注釈種別',
    enum: ['STICKY', 'COMMENT', 'ICON', 'SCOPE'],
    required: false,
  })
  @IsOptional()
  @IsIn(['STICKY', 'COMMENT', 'ICON', 'SCOPE'])
  kind?: 'STICKY' | 'COMMENT' | 'ICON' | 'SCOPE';

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsNumber()
  positionX?: number;

  @IsOptional()
  @IsNumber()
  positionY?: number;

  @ApiProperty({ description: '幅（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  width?: number | null;

  @ApiProperty({ description: '高さ（手動リサイズの永続化）', required: false, nullable: true })
  @IsOptional()
  @IsNumber()
  height?: number | null;

  @ApiProperty({ description: '色（任意）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiProperty({ description: 'アイコン名（kind=ICONのとき）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  icon?: string | null;

  @ApiProperty({
    description: '枠線スタイル（kind=SCOPEのとき）',
    enum: ['dashed', 'solid'],
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsIn(['dashed', 'solid'])
  borderStyle?: 'dashed' | 'solid' | null;

  @ApiProperty({
    description: '背景塗りの不透明度 0〜1（kind=SCOPEのとき）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  fillOpacity?: number | null;
}

@ApiTags('Business Flows')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('business-flows')
export class BusinessFlowController {
  constructor(
    @Inject(BUSINESS_FLOW_REPOSITORY)
    private readonly flowRepository: IBusinessFlowRepository,
    @Inject(FLOW_NODE_REPOSITORY)
    private readonly nodeRepository: IFlowNodeRepository,
    @Inject(CRUD_MAPPING_REPOSITORY)
    private readonly crudMappingRepository: ICrudMappingRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly prisma: PrismaService,
    private readonly claudeService: ClaudeService,
    private readonly companyKeyService: CompanyKeyService,
    private readonly createNodeLinkUseCase: CreateNodeLinkUseCase,
    private readonly getNodeLinksUseCase: GetNodeLinksUseCase,
    private readonly deleteNodeLinkUseCase: DeleteNodeLinkUseCase,
    private readonly createNodeChildFlowUseCase: CreateNodeChildFlowUseCase,
    private readonly getFlowTreeUseCase: GetFlowTreeUseCase,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'プロジェクトのルートフロー一覧を取得' })
  async getRootFlows(@Param('projectId') projectId: string) {
    const flows = await this.flowRepository.findRootFlowsByProjectId(projectId);
    return flows.map((f) => this.toResponse(f));
  }

  @Get('project/:projectId/all')
  @ApiOperation({ summary: 'プロジェクトの全フロー一覧を取得（階層含む）' })
  async getAllFlows(@Param('projectId') projectId: string) {
    const flows = await this.flowRepository.findByProjectId(projectId);
    return flows.map((f) => this.toResponse(f));
  }

  @Get('project/:projectId/tree')
  @ApiOperation({
    summary:
      'プロジェクト全体のフローツリー（親子階層マップ用のフラット配列）を取得',
  })
  async getFlowTree(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.getFlowTreeUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'フロー詳細を取得（ノード・エッジ含む）' })
  async getById(@Param('id') id: string) {
    const flow = await this.flowRepository.findById(id);
    if (!flow) {
      return { error: 'Business flow not found' };
    }

    // ノードとエッジを取得（クロスフロー入出力リンクも含める）
    const nodes = await this.prisma.flowNode.findMany({
      where: { flowId: id },
      include: {
        role: true,
        childFlow: true,
        links: {
          include: {
            targetFlow: { select: { id: true, name: true } },
            targetNode: { select: { id: true, label: true } },
          },
          orderBy: { order: 'asc' },
        },
        informationLinks: {
          include: {
            informationType: { select: { id: true, name: true, category: true } },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const edges = await this.prisma.flowEdge.findMany({
      where: { flowId: id },
      include: {
        informationType: { select: { id: true, name: true, category: true } },
        apiLinks: {
          include: {
            apiEndpoint: {
              select: { id: true, method: true, path: true, summary: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 子フロー一覧
    const children = await this.flowRepository.findChildrenByParentId(id);

    // パンくず用の親フロー階層を取得
    const breadcrumbs = await this.getBreadcrumbs(flow);

    return {
      ...this.toResponse(flow),
      nodes: nodes.map((n) => ({
        id: n.id,
        flowId: n.flowId,
        type: n.type,
        label: n.label,
        description: n.description,
        positionX: n.positionX,
        positionY: n.positionY,
        width: n.width,
        height: n.height,
        order: n.order,
        roleId: n.roleId,
        role: n.role
          ? { id: n.role.id, name: n.role.name, color: n.role.color, type: n.role.type }
          : null,
        childFlowId: n.childFlowId,
        childFlow: n.childFlow
          ? { id: n.childFlow.id, name: n.childFlow.name }
          : null,
        hasChildFlow: !!n.childFlowId,
        links: n.links.map((l) => ({
          id: l.id,
          nodeId: l.nodeId,
          direction: l.direction,
          targetFlowId: l.targetFlowId,
          targetFlowName: l.targetFlow?.name ?? null,
          targetNodeId: l.targetNodeId,
          targetNodeLabel: l.targetNode?.label ?? null,
          label: l.label,
          order: l.order,
        })),
        informationLinks: n.informationLinks.map((il) => ({
          id: il.id,
          nodeId: il.nodeId,
          informationTypeId: il.informationTypeId,
          direction: il.direction,
          order: il.order,
          informationType: il.informationType
            ? {
                id: il.informationType.id,
                name: il.informationType.name,
                category: il.informationType.category,
              }
            : null,
        })),
        processingTime: n.processingTime,
        handledCount: n.handledCount,
        supplement: n.supplement,
        metadata: n.metadata,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        flowId: e.flowId,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        label: e.label,
        condition: e.condition,
        informationTypeId: e.informationTypeId,
        pathStyle: e.pathStyle,
        labelT: e.labelT,
        infoT: e.infoT,
        informationType: e.informationType
          ? {
              id: e.informationType.id,
              name: e.informationType.name,
              category: e.informationType.category,
            }
          : null,
        // この矢印に紐づくAPIエンドポイント（FlowEdgeApiLink）
        apiLinks: e.apiLinks.map((l) => ({
          id: l.id,
          apiEndpointId: l.apiEndpointId,
          method: l.apiEndpoint.method,
          path: l.apiEndpoint.path,
          summary: l.apiEndpoint.summary,
        })),
      })),
      children: children.map((c) => this.toResponse(c)),
      breadcrumbs,
    };
  }

  @Post()
  @ApiOperation({ summary: 'フローを作成' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateBusinessFlowDto,
  ) {
    await this.projectAccess.assertProjectAccess(dto.projectId, user.id, 'edit');
    let depth = 0;

    if (dto.parentId) {
      const parent = await this.flowRepository.findById(dto.parentId);
      if (parent) {
        depth = parent.depth + 1;
      }
    }

    const flow = BusinessFlow.create({
      id: uuid(),
      projectId: dto.projectId,
      name: dto.name,
      description: dto.description,
      kind: dto.kind,
      confidence: dto.confidence,
      subProjectId: dto.subProjectId,
      asisFlowId: dto.asisFlowId,
      folderId: dto.folderId,
      parentId: dto.parentId,
      depth,
    });

    const saved = await this.flowRepository.save(flow);
    return this.toResponse(saved);
  }

  @Put(':id')
  @ApiOperation({ summary: 'フローを更新' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessFlowDto,
  ) {
    const flow = await this.flowRepository.findById(id);
    if (!flow) {
      return { error: 'Business flow not found' };
    }
    await this.assertFlowMembership(id, user.id, 'edit');

    if (dto.name) flow.updateName(dto.name);
    if (dto.description !== undefined) flow.updateDescription(dto.description);
    if (dto.kind) flow.setKind(dto.kind);
    if (dto.confidence) flow.setConfidence(dto.confidence);
    if (dto.subProjectId !== undefined) flow.setSubProject(dto.subProjectId);
    if (dto.asisFlowId !== undefined) flow.setAsisFlow(dto.asisFlowId);
    if (dto.folderId !== undefined) flow.setFolder(dto.folderId);
    if (dto.laneHeights !== undefined) flow.setLaneHeights(dto.laneHeights);

    const saved = await this.flowRepository.save(flow);
    return this.toResponse(saved);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'フローを削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    await this.assertFlowMembership(id, user.id, 'edit');
    await this.flowRepository.delete(id);
    return { success: true };
  }

  // ========== Node Endpoints ==========

  @Post(':flowId/nodes')
  @ApiOperation({ summary: 'ノードを作成' })
  async createNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: CreateFlowNodeDto,
  ) {
    await this.assertFlowMembership(flowId, user.id, 'edit');
    const node = FlowNode.create({
      id: uuid(),
      flowId,
      type: (dto.type as any) || 'PROCESS',
      label: dto.label,
      description: dto.description,
      positionX: dto.positionX,
      positionY: dto.positionY,
      roleId: dto.roleId,
      processingTime: dto.processingTime ?? null,
      handledCount: dto.handledCount ?? null,
      supplement: dto.supplement ?? null,
    });

    const saved = await this.nodeRepository.save(node);
    return this.nodeToResponse(saved);
  }

  @Put(':flowId/nodes/positions')
  @ApiOperation({
    summary: 'ノード位置を一括更新（自由ドラッグ保存 / 整形）',
  })
  async updateNodePositions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: UpdateNodePositionsDto,
  ) {
    // 認可: flow -> project -> organization メンバーシップ
    const flow = await this.flowRepository.findById(flowId);
    if (!flow) {
      throw new EntityNotFoundError('BusinessFlow', flowId);
    }

    const project = await this.projectRepository.findById(flow.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', flow.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      user.id,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 位置一括更新は書込のため edit 強制
    await this.projectAccess.assertProjectAccess(flow.projectId, user.id, 'edit');

    const positions = dto.positions ?? [];

    for (const pos of positions) {
      const node = await this.nodeRepository.findById(pos.id);
      // このフローに属さない / 存在しないノードはスキップ
      if (!node || node.flowId !== flowId) {
        continue;
      }

      node.updatePosition(pos.positionX, pos.positionY);
      if (pos.roleId !== undefined) {
        node.assignRole(pos.roleId);
      }
      await this.nodeRepository.save(node);

      // `order` はドメインエンティティ/リポジトリが保持していないため直接更新する
      if (pos.order !== undefined) {
        await this.prisma.flowNode.update({
          where: { id: pos.id },
          data: { order: pos.order },
        });
      }
    }

    // 整形が算出した最近接サイド接続ハンドル（任意）。同一リクエストで反映する。
    // このフローに属さない / 存在しないエッジはスキップする。
    const edgePatches = dto.edges ?? [];
    for (const patch of edgePatches) {
      const edge = await this.prisma.flowEdge.findUnique({
        where: { id: patch.id },
        select: { id: true, flowId: true },
      });
      if (!edge || edge.flowId !== flowId) {
        continue;
      }
      const data: { sourceHandle?: string | null; targetHandle?: string | null } =
        {};
      if (patch.sourceHandle !== undefined) data.sourceHandle = patch.sourceHandle;
      if (patch.targetHandle !== undefined) data.targetHandle = patch.targetHandle;
      if (Object.keys(data).length > 0) {
        await this.prisma.flowEdge.update({ where: { id: patch.id }, data });
      }
    }

    // 更新後のフローのノード一覧を返す
    const nodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      orderBy: { createdAt: 'asc' },
    });

    return {
      success: true,
      count: positions.length,
      nodes: nodes.map((n) => ({
        id: n.id,
        flowId: n.flowId,
        type: n.type,
        label: n.label,
        description: n.description,
        positionX: n.positionX,
        positionY: n.positionY,
        roleId: n.roleId,
        order: n.order,
        metadata: n.metadata,
      })),
    };
  }

  @Put(':flowId/nodes/:nodeId')
  @ApiOperation({ summary: 'ノードを更新' })
  async updateNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateFlowNodeDto,
  ) {
    const node = await this.nodeRepository.findById(nodeId);
    if (!node) {
      return { error: 'Node not found' };
    }
    await this.assertFlowMembership(node.flowId, user.id, 'edit');

    if (dto.label) node.updateLabel(dto.label);
    if (dto.description !== undefined) node.updateDescription(dto.description);
    if (dto.positionX !== undefined && dto.positionY !== undefined) {
      node.updatePosition(dto.positionX, dto.positionY);
    }
    if (dto.width !== undefined || dto.height !== undefined) {
      node.updateSize(
        dto.width !== undefined ? dto.width : node.width,
        dto.height !== undefined ? dto.height : node.height,
      );
    }
    if (dto.type) node.updateType(dto.type as any);
    if (dto.roleId !== undefined) node.assignRole(dto.roleId);
    if (dto.metadata !== undefined) node.updateMetadata(dto.metadata);
    if (dto.processingTime !== undefined)
      node.updateProcessingTime(dto.processingTime);
    if (dto.handledCount !== undefined)
      node.updateHandledCount(dto.handledCount);
    if (dto.supplement !== undefined) node.updateSupplement(dto.supplement);

    const saved = await this.nodeRepository.save(node);

    // `order` はドメインエンティティ/リポジトリが保持していないため直接更新する
    if (dto.order !== undefined) {
      await this.prisma.flowNode.update({
        where: { id: nodeId },
        data: { order: dto.order },
      });
    }

    const record = await this.prisma.flowNode.findUnique({
      where: { id: nodeId },
    });

    return { ...this.nodeToResponse(saved), order: record?.order ?? 0 };
  }

  @Delete(':flowId/nodes/:nodeId')
  @ApiOperation({ summary: 'ノードを削除' })
  async deleteNode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
  ) {
    await this.assertNodeEditAccess(nodeId, user.id);
    await this.nodeRepository.delete(nodeId);
    return { success: true };
  }

  // ========== Edge Endpoints ==========

  @Post(':flowId/edges')
  @ApiOperation({ summary: 'エッジを作成' })
  async createEdge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: CreateFlowEdgeDto,
  ) {
    await this.assertFlowMembership(flowId, user.id, 'edit');
    const edge = await this.prisma.flowEdge.create({
      data: {
        id: uuid(),
        flowId,
        sourceNodeId: dto.sourceNodeId,
        targetNodeId: dto.targetNodeId,
        sourceHandle: dto.sourceHandle,
        targetHandle: dto.targetHandle,
        label: dto.label,
        condition: dto.condition,
        informationTypeId: dto.informationTypeId ?? null,
        pathStyle: dto.pathStyle ?? null,
        labelT: dto.labelT ?? null,
        infoT: dto.infoT ?? null,
      },
      include: {
        informationType: { select: { id: true, name: true, category: true } },
        apiLinks: {
          include: {
            apiEndpoint: {
              select: { id: true, method: true, path: true, summary: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return this.edgeToResponse(edge);
  }

  @Patch(':flowId/edges/:edgeId')
  @ApiOperation({
    summary: 'エッジを再接続・更新（接続元/先・ハンドル・ラベル）',
  })
  async reconnectEdge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Param('edgeId') edgeId: string,
    @Body() dto: UpdateFlowEdgeDto,
  ) {
    // 認可: flow -> project -> organization メンバーシップ + edit 強制
    await this.assertFlowMembership(flowId, user.id, 'edit');

    const data: {
      sourceNodeId?: string;
      targetNodeId?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      label?: string | null;
      condition?: string | null;
      informationTypeId?: string | null;
      pathStyle?: string | null;
      labelT?: number | null;
      infoT?: number | null;
    } = {};
    if (dto.sourceNodeId !== undefined) data.sourceNodeId = dto.sourceNodeId;
    if (dto.targetNodeId !== undefined) data.targetNodeId = dto.targetNodeId;
    if (dto.sourceHandle !== undefined) data.sourceHandle = dto.sourceHandle;
    if (dto.targetHandle !== undefined) data.targetHandle = dto.targetHandle;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.informationTypeId !== undefined)
      data.informationTypeId = dto.informationTypeId;
    if (dto.pathStyle !== undefined) data.pathStyle = dto.pathStyle;
    if (dto.labelT !== undefined) data.labelT = dto.labelT;
    if (dto.infoT !== undefined) data.infoT = dto.infoT;

    const edge = await this.prisma.flowEdge.update({
      where: { id: edgeId },
      data,
      include: {
        informationType: { select: { id: true, name: true, category: true } },
        apiLinks: {
          include: {
            apiEndpoint: {
              select: { id: true, method: true, path: true, summary: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return this.edgeToResponse(edge);
  }

  @Put(':flowId/edges/:edgeId')
  @ApiOperation({ summary: 'エッジを更新' })
  async updateEdge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('edgeId') edgeId: string,
    @Body() dto: UpdateFlowEdgeDto,
  ) {
    await this.assertEdgeEditAccess(edgeId, user.id);
    const data: {
      sourceNodeId?: string;
      targetNodeId?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      label?: string | null;
      condition?: string | null;
      informationTypeId?: string | null;
      pathStyle?: string | null;
      labelT?: number | null;
      infoT?: number | null;
    } = {};
    if (dto.sourceNodeId !== undefined) data.sourceNodeId = dto.sourceNodeId;
    if (dto.targetNodeId !== undefined) data.targetNodeId = dto.targetNodeId;
    if (dto.sourceHandle !== undefined) data.sourceHandle = dto.sourceHandle;
    if (dto.targetHandle !== undefined) data.targetHandle = dto.targetHandle;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.condition !== undefined) data.condition = dto.condition;
    if (dto.informationTypeId !== undefined)
      data.informationTypeId = dto.informationTypeId;
    if (dto.pathStyle !== undefined) data.pathStyle = dto.pathStyle;
    if (dto.labelT !== undefined) data.labelT = dto.labelT;
    if (dto.infoT !== undefined) data.infoT = dto.infoT;

    const edge = await this.prisma.flowEdge.update({
      where: { id: edgeId },
      data,
      include: {
        informationType: { select: { id: true, name: true, category: true } },
        apiLinks: {
          include: {
            apiEndpoint: {
              select: { id: true, method: true, path: true, summary: true },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    return this.edgeToResponse(edge);
  }

  @Delete(':flowId/edges/:edgeId')
  @ApiOperation({ summary: 'エッジを削除' })
  async deleteEdge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('edgeId') edgeId: string,
  ) {
    await this.assertEdgeEditAccess(edgeId, user.id);
    await this.prisma.flowEdge.delete({ where: { id: edgeId } });
    return { success: true };
  }

  // ========== Child Flow Endpoints ==========

  @Post(':flowId/nodes/:nodeId/child-flow')
  @ApiOperation({ summary: 'ノードに子フローを作成・紐付け' })
  async createChildFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateChildFlowDto,
  ) {
    await this.assertFlowMembership(flowId, user.id, 'edit');
    const parentFlow = await this.flowRepository.findById(flowId);
    const node = await this.nodeRepository.findById(nodeId);

    if (!parentFlow || !node) {
      return { error: 'Parent flow or node not found' };
    }

    // 子フローを作成
    const childFlow = BusinessFlow.createChildFlow({
      id: uuid(),
      projectId: parentFlow.projectId,
      name: dto.name || `${node.label}の詳細`,
      description: dto.description,
      parentId: flowId,
      parentDepth: parentFlow.depth,
    });

    const savedFlow = await this.flowRepository.save(childFlow);

    // ノードに子フローを紐付け
    node.linkChildFlow(savedFlow.id);
    await this.nodeRepository.save(node);

    return {
      childFlow: this.toResponse(savedFlow),
      node: this.nodeToResponse(node),
    };
  }

  @Delete(':flowId/nodes/:nodeId/child-flow')
  @ApiOperation({ summary: 'ノードから子フローの紐付けを解除' })
  async unlinkChildFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
  ) {
    const node = await this.nodeRepository.findById(nodeId);
    if (!node) {
      return { error: 'Node not found' };
    }
    await this.assertFlowMembership(node.flowId, user.id, 'edit');

    node.unlinkChildFlow();
    await this.nodeRepository.save(node);

    return { success: true };
  }

  // ========== Node Child-Flow Drill-down (idempotent) ==========

  @Post('nodes/:nodeId/child-flow')
  @ApiOperation({
    summary: 'ノードの子フロー（ドリルダウン）を作成または取得（冪等）',
  })
  async createNodeChildFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateNodeChildFlowDto,
  ) {
    return this.createNodeChildFlowUseCase.execute({
      userId: user.id,
      nodeId,
      name: dto.name,
    });
  }

  // ========== Node Cross-Flow Links ==========

  @Get('nodes/:nodeId/links')
  @ApiOperation({ summary: 'ノードの入出力リンク一覧（双方向）を取得' })
  async getNodeLinks(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
  ) {
    return this.getNodeLinksUseCase.execute({
      userId: user.id,
      nodeId,
    });
  }

  @Post('nodes/:nodeId/links')
  @ApiOperation({ summary: 'ノードに入出力リンクを作成' })
  async createNodeLink(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateNodeLinkDto,
  ) {
    return this.createNodeLinkUseCase.execute({
      userId: user.id,
      nodeId,
      direction: dto.direction,
      targetFlowId: dto.targetFlowId,
      targetNodeId: dto.targetNodeId,
      label: dto.label,
    });
  }

  @Delete('node-links/:linkId')
  @ApiOperation({ summary: '入出力リンクを削除' })
  async deleteNodeLink(
    @CurrentUser() user: CurrentUserPayload,
    @Param('linkId') linkId: string,
  ) {
    await this.deleteNodeLinkUseCase.execute({
      userId: user.id,
      linkId,
    });
    return { success: true };
  }

  // ========== Node Information-Type Links (INPUT/OUTPUT) ==========

  @Get(':flowId/nodes/:nodeId/information-links')
  @ApiOperation({ summary: 'ノードの入出力（情報種別マスタ紐づけ）一覧を取得' })
  async getNodeInformationLinks(@Param('nodeId') nodeId: string) {
    const links = await this.prisma.nodeInformationLink.findMany({
      where: { nodeId },
      include: {
        informationType: { select: { id: true, name: true, category: true } },
      },
      orderBy: { order: 'asc' },
    });
    return links.map((il) => this.toInformationLinkResponse(il));
  }

  @Put(':flowId/nodes/:nodeId/information-links')
  @ApiOperation({ summary: 'ノードの入出力（情報種別マスタ紐づけ）を一括置換' })
  async replaceNodeInformationLinks(
    @CurrentUser() user: CurrentUserPayload,
    @Param('nodeId') nodeId: string,
    @Body() dto: ReplaceNodeInformationLinksDto,
  ) {
    await this.assertNodeEditAccess(nodeId, user.id);
    await this.prisma.$transaction([
      this.prisma.nodeInformationLink.deleteMany({ where: { nodeId } }),
      ...dto.links.map((link, index) =>
        this.prisma.nodeInformationLink.create({
          data: {
            nodeId,
            informationTypeId: link.informationTypeId,
            direction: link.direction,
            order: link.order ?? index,
          },
        }),
      ),
    ]);

    const links = await this.prisma.nodeInformationLink.findMany({
      where: { nodeId },
      include: {
        informationType: { select: { id: true, name: true, category: true } },
      },
      orderBy: { order: 'asc' },
    });
    return links.map((il) => this.toInformationLinkResponse(il));
  }

  // ========== Undo/Redo: Restore + Snapshots ==========

  @Put(':flowId/restore')
  @ApiOperation({
    summary:
      'フローのノード/エッジをスナップショットに一致するよう ID 保持で差分置換（Undo/Redo の核）',
  })
  async restore(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: RestoreFlowDto,
  ) {
    // 認可: flow -> project -> organization メンバーシップ + edit 強制
    await this.assertFlowMembership(flowId, user.id, 'edit');

    const nodes = dto.nodes ?? [];
    const edges = dto.edges ?? [];
    const keepNodeIds = nodes.map((n) => n.id);
    const keepEdgeIds = edges.map((e) => e.id);

    await this.prisma.$transaction(async (tx) => {
      // ① スナップショットに無い既存 edge を削除（FK 単純化のため先に消す）
      await tx.flowEdge.deleteMany({
        where: {
          flowId,
          ...(keepEdgeIds.length > 0 ? { id: { notIn: keepEdgeIds } } : {}),
        },
      });

      // ② スナップショットに無い既存 node を削除（そのノードの edge/links は Cascade）
      await tx.flowNode.deleteMany({
        where: {
          flowId,
          ...(keepNodeIds.length > 0 ? { id: { notIn: keepNodeIds } } : {}),
        },
      });

      // ③ node を upsert（全フィールド、childFlowId/metadata 含む）
      for (const n of nodes) {
        const nodeData = {
          type: ((n.type as string) || 'PROCESS') as any,
          label: n.label,
          positionX: n.positionX ?? 0,
          positionY: n.positionY ?? 0,
          order: n.order ?? 0,
          roleId: n.roleId ?? null,
          processingTime: n.processingTime ?? null,
          handledCount: n.handledCount ?? null,
          supplement: n.supplement ?? null,
          metadata: (n.metadata ?? {}) as any,
          childFlowId: n.childFlowId ?? null,
        };
        await tx.flowNode.upsert({
          where: { id: n.id },
          update: nodeData,
          create: { id: n.id, flowId, ...nodeData },
        });

        // ④ NodeInformationLink を replace-all（informationLinks 指定時のみ）
        if (n.informationLinks !== undefined) {
          await tx.nodeInformationLink.deleteMany({ where: { nodeId: n.id } });
          if (n.informationLinks.length > 0) {
            await tx.nodeInformationLink.createMany({
              data: n.informationLinks.map((il, idx) => ({
                nodeId: n.id,
                informationTypeId: il.informationTypeId,
                direction: il.direction,
                order: il.order ?? idx,
              })),
            });
          }
        }
      }

      // ⑤ edge を upsert（全フィールド）。node 確定後に処理して FK 整合
      for (const e of edges) {
        const edgeData = {
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          label: e.label ?? null,
          condition: e.condition ?? null,
          informationTypeId: e.informationTypeId ?? null,
          pathStyle: e.pathStyle ?? null,
          labelT: e.labelT ?? null,
          infoT: e.infoT ?? null,
        };
        await tx.flowEdge.upsert({
          where: { id: e.id },
          update: edgeData,
          create: { id: e.id, flowId, ...edgeData },
        });
      }
    });

    // restore 後の GET 相当（フル状態）を返す
    return this.getById(flowId);
  }

  @Get(':flowId/snapshots')
  @ApiOperation({
    summary: 'フローのスナップショット履歴（直近 N を seq 昇順、data 同梱）を取得',
  })
  async getSnapshots(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Query('limit') limit?: string,
  ) {
    await this.assertFlowMembership(flowId, user.id);

    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);

    // 直近 N 件を seq 降順で取得 → seq 昇順で返す
    const rows = await this.prisma.flowSnapshot.findMany({
      where: { flowId },
      orderBy: { seq: 'desc' },
      take,
    });

    return rows
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({
        id: s.id,
        seq: s.seq,
        label: s.label,
        data: s.data,
        createdAt: s.createdAt,
      }));
  }

  @Post(':flowId/snapshots')
  @ApiOperation({
    summary: 'スナップショットを1件作成（保持上限 50 超過分は古い seq を間引き）',
  })
  async createSnapshot(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: CreateFlowSnapshotDto,
  ) {
    await this.assertFlowMembership(flowId, user.id, 'edit');

    const MAX_SNAPSHOTS = 50;

    const created = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.flowSnapshot.findFirst({
        where: { flowId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      });
      const seq = (latest?.seq ?? 0) + 1;

      const row = await tx.flowSnapshot.create({
        data: {
          flowId,
          seq,
          label: dto.label ?? null,
          data: (dto.data ?? {}) as any,
        },
      });

      // 保持上限超過分（古い seq）を間引き
      const stale = await tx.flowSnapshot.findMany({
        where: { flowId },
        orderBy: { seq: 'desc' },
        skip: MAX_SNAPSHOTS,
        select: { id: true },
      });
      if (stale.length > 0) {
        await tx.flowSnapshot.deleteMany({
          where: { id: { in: stale.map((r) => r.id) } },
        });
      }

      return row;
    });

    return {
      id: created.id,
      seq: created.seq,
      label: created.label,
      data: created.data,
      createdAt: created.createdAt,
    };
  }

  // ========== Annotations (付箋・コメント) ==========

  @Get(':flowId/annotations')
  @ApiOperation({ summary: 'フローの注釈（付箋・コメント）一覧を取得' })
  async getAnnotations(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
  ) {
    // 認可: flow -> project -> organization メンバーシップ
    await this.assertFlowMembership(flowId, user.id);

    const rows = await this.prisma.flowAnnotation.findMany({
      where: { flowId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map((a) => this.annotationToResponse(a));
  }

  @Post(':flowId/annotations')
  @ApiOperation({ summary: '注釈（付箋・コメント）を作成' })
  async createAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: CreateFlowAnnotationDto,
  ) {
    // 認可: flow -> project -> organization メンバーシップ + edit 強制
    await this.assertFlowMembership(flowId, user.id, 'edit');

    const created = await this.prisma.flowAnnotation.create({
      data: {
        flowId,
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

  @Patch(':flowId/annotations/:id')
  @ApiOperation({ summary: '注釈（付箋・コメント）を部分更新' })
  async updateAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Param('id') id: string,
    @Body() dto: UpdateFlowAnnotationDto,
  ) {
    // 認可: flow -> project -> organization メンバーシップ + edit 強制
    await this.assertFlowMembership(flowId, user.id, 'edit');

    const data: {
      kind?: 'STICKY' | 'COMMENT' | 'ICON' | 'SCOPE';
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

    const updated = await this.prisma.flowAnnotation.update({
      where: { id },
      data,
    });

    return this.annotationToResponse(updated);
  }

  @Delete(':flowId/annotations/:id')
  @ApiOperation({ summary: '注釈（付箋・コメント）を削除' })
  async deleteAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Param('id') id: string,
  ) {
    // 認可: flow -> project -> organization メンバーシップ + edit 強制
    await this.assertFlowMembership(flowId, user.id, 'edit');

    await this.prisma.flowAnnotation.delete({ where: { id } });
    return { success: true };
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

  private edgeToResponse(e: {
    id: string;
    flowId: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourceHandle: string | null;
    targetHandle: string | null;
    label: string | null;
    condition: string | null;
    informationTypeId: string | null;
    pathStyle?: string | null;
    labelT?: number | null;
    infoT?: number | null;
    informationType?: { id: string; name: string; category: string } | null;
    apiLinks?: Array<{
      id: string;
      apiEndpointId: string;
      apiEndpoint: {
        id: string;
        method: string;
        path: string;
        summary: string | null;
      };
    }>;
  }) {
    return {
      id: e.id,
      flowId: e.flowId,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      label: e.label,
      condition: e.condition,
      informationTypeId: e.informationTypeId,
      pathStyle: e.pathStyle ?? null,
      labelT: e.labelT ?? null,
      infoT: e.infoT ?? null,
      informationType: e.informationType
        ? {
            id: e.informationType.id,
            name: e.informationType.name,
            category: e.informationType.category,
          }
        : null,
      // この矢印に紐づくAPIエンドポイント（FlowEdgeApiLink）
      apiLinks: (e.apiLinks ?? []).map((l) => ({
        id: l.id,
        apiEndpointId: l.apiEndpointId,
        method: l.apiEndpoint.method,
        path: l.apiEndpoint.path,
        summary: l.apiEndpoint.summary,
      })),
    };
  }

  private toInformationLinkResponse(il: {
    id: string;
    nodeId: string;
    informationTypeId: string;
    direction: string;
    order: number;
    informationType: { id: string; name: string; category: string } | null;
  }) {
    return {
      id: il.id,
      nodeId: il.nodeId,
      informationTypeId: il.informationTypeId,
      direction: il.direction,
      order: il.order,
      informationType: il.informationType
        ? {
            id: il.informationType.id,
            name: il.informationType.name,
            category: il.informationType.category,
          }
        : null,
    };
  }

  // ========== CRUD Mappings for Flow ==========

  @Get(':flowId/crud-mappings')
  @ApiOperation({ summary: 'フローに紐づくCRUDマッピング一覧を取得' })
  async getCrudMappings(@Param('flowId') flowId: string) {
    const mappings = await this.crudMappingRepository.findByFlowId(flowId);
    return mappings.map((m) => ({
      id: m.id,
      columnId: m.columnId,
      operation: m.operation,
      roleId: m.roleId,
      flowId: m.flowId,
      flowNodeId: m.flowNodeId,
      how: m.how,
      condition: m.condition,
      description: m.description,
    }));
  }

  @Get(':flowId/nodes/:nodeId/crud-mappings')
  @ApiOperation({ summary: 'ノードに紐づくCRUDマッピング一覧を取得' })
  async getNodeCrudMappings(@Param('nodeId') nodeId: string) {
    const mappings = await this.crudMappingRepository.findByFlowNodeId(nodeId);
    return mappings.map((m) => ({
      id: m.id,
      columnId: m.columnId,
      operation: m.operation,
      roleId: m.roleId,
      flowId: m.flowId,
      flowNodeId: m.flowNodeId,
      how: m.how,
      condition: m.condition,
      description: m.description,
    }));
  }

  // ========== Mermaid Export ==========

  @Get(':id/mermaid')
  @ApiOperation({ summary: 'フローをMermaid形式でエクスポート' })
  async exportMermaid(@Param('id') id: string) {
    const flow = await this.flowRepository.findById(id);
    if (!flow) {
      return { error: 'Business flow not found' };
    }

    const nodes = await this.prisma.flowNode.findMany({
      where: { flowId: id },
      include: { role: true },
    });

    const edges = await this.prisma.flowEdge.findMany({
      where: { flowId: id },
    });

    let mermaid = 'flowchart TD\n';

    // ノードを追加
    for (const node of nodes) {
      const label = node.label.replace(/"/g, '\\"');
      const roleLabel = node.role ? ` [${node.role.name}]` : '';

      switch (node.type) {
        case 'START':
          mermaid += `  ${node.id}(("${label}"))\n`;
          break;
        case 'END':
          mermaid += `  ${node.id}(("${label}"))\n`;
          break;
        case 'DECISION':
          mermaid += `  ${node.id}{"${label}${roleLabel}"}\n`;
          break;
        case 'DATA_STORE':
          mermaid += `  ${node.id}[("${label}")]\n`;
          break;
        default:
          mermaid += `  ${node.id}["${label}${roleLabel}"]\n`;
      }
    }

    mermaid += '\n';

    // エッジを追加
    for (const edge of edges) {
      if (edge.label) {
        mermaid += `  ${edge.sourceNodeId} -->|"${edge.label}"| ${edge.targetNodeId}\n`;
      } else {
        mermaid += `  ${edge.sourceNodeId} --> ${edge.targetNodeId}\n`;
      }
    }

    return {
      flowId: id,
      flowName: flow.name,
      mermaid,
    };
  }

  // ========== Mermaid Import (AI) ==========

  @Post(':id/import-mermaid')
  @ApiOperation({ summary: 'Mermaid図をAIで解析してフローに取り込み' })
  async importMermaid(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ImportMermaidDto,
  ) {
    const flow = await this.flowRepository.findById(id);
    if (!flow) {
      throw new HttpException('Business flow not found', HttpStatus.NOT_FOUND);
    }

    // プロジェクト単位 RBAC: Mermaid 取り込みは書込のため edit 強制
    await this.projectAccess.assertProjectAccess(flow.projectId, user.id, 'edit');

    // APIキーを取得（会社(Organization)キー > ユーザー設定 > 環境変数）
    const apiKey = await this.companyKeyService.resolveForProject(
      flow.projectId,
      user.id,
    );
    if (!apiKey) {
      throw new HttpException(
        'Anthropic APIキーが未設定です',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Claude API で Mermaid を解析
    const parsed = await this.claudeService.parseMermaidToFlow(
      dto.mermaid,
      apiKey,
      { projectId: flow.projectId, area: 'MERMAID_FLOW', userId: user.id },
    );

    const projectId = flow.projectId;
    const VALID_NODE_TYPES = [
      'START',
      'END',
      'PROCESS',
      'DECISION',
      'SYSTEM_INTEGRATION',
      'MANUAL_OPERATION',
      'DATA_STORE',
    ];
    const VALID_ROLE_TYPES = ['HUMAN', 'SYSTEM', 'OTHER'];
    const DEFAULT_ROLE_COLOR = '#94a3b8';

    // 1. ロールを [projectId, name] で upsert
    const roleIdByName = new Map<string, string>();
    for (const role of parsed.roles) {
      if (!role?.name) continue;
      const roleType = VALID_ROLE_TYPES.includes(role.type as string)
        ? (role.type as 'HUMAN' | 'SYSTEM' | 'OTHER')
        : 'HUMAN';
      const upserted = await this.prisma.role.upsert({
        where: { projectId_name: { projectId, name: role.name } },
        update: {},
        create: {
          id: uuid(),
          projectId,
          name: role.name,
          type: roleType,
          color: DEFAULT_ROLE_COLOR,
        },
      });
      roleIdByName.set(role.name, upserted.id);
    }

    // 2. ノードを作成（key → 生成IDのマップを保持）
    const nodeIdByKey = new Map<string, string>();
    let order = 0;
    for (const node of parsed.nodes) {
      if (!node?.key) continue;
      const nodeType = VALID_NODE_TYPES.includes(node.type as string)
        ? (node.type as string)
        : 'PROCESS';
      const roleId = node.roleName
        ? roleIdByName.get(node.roleName) ?? null
        : null;
      const created = await this.prisma.flowNode.create({
        data: {
          id: uuid(),
          flowId: id,
          type: nodeType as any,
          label: node.label || node.key,
          positionX: 0,
          positionY: 0,
          order: order++,
          roleId,
        },
      });
      nodeIdByKey.set(node.key, created.id);
    }

    // 3. エッジを作成（sourceKey/targetKey → 生成ノードIDへ解決）
    for (const edge of parsed.edges) {
      const sourceNodeId = nodeIdByKey.get(edge?.sourceKey);
      const targetNodeId = nodeIdByKey.get(edge?.targetKey);
      if (!sourceNodeId || !targetNodeId) continue;
      await this.prisma.flowEdge.create({
        data: {
          id: uuid(),
          flowId: id,
          sourceNodeId,
          targetNodeId,
          label: edge.label,
        },
      });
    }

    // 更新後のフロー（ノード・エッジ含む）を返す
    return this.getById(id);
  }

  // 認可ヘルパー: flow -> project -> organization メンバーシップを検証
  // 併せてプロジェクト単位 RBAC（VIEW/EDIT）を強制する（既定 view、書込は edit）。
  private async assertFlowMembership(
    flowId: string,
    userId: string,
    required: 'view' | 'edit' = 'view',
  ): Promise<BusinessFlow> {
    const flow = await this.flowRepository.findById(flowId);
    if (!flow) {
      throw new EntityNotFoundError('BusinessFlow', flowId);
    }

    const project = await this.projectRepository.findById(flow.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', flow.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    await this.projectAccess.assertProjectAccess(flow.projectId, userId, required);

    return flow;
  }

  // 認可ヘルパー: nodeId -> flow -> project の edit 強制（書込ルート用）
  private async assertNodeEditAccess(nodeId: string, userId: string): Promise<void> {
    const node = await this.nodeRepository.findById(nodeId);
    if (!node) {
      throw new EntityNotFoundError('FlowNode', nodeId);
    }
    await this.assertFlowMembership(node.flowId, userId, 'edit');
  }

  // 認可ヘルパー: edgeId -> flow -> project の edit 強制（書込ルート用）
  private async assertEdgeEditAccess(edgeId: string, userId: string): Promise<void> {
    const edge = await this.prisma.flowEdge.findUnique({
      where: { id: edgeId },
      select: { flowId: true },
    });
    if (!edge) {
      throw new EntityNotFoundError('FlowEdge', edgeId);
    }
    await this.assertFlowMembership(edge.flowId, userId, 'edit');
  }

  private async getBreadcrumbs(flow: BusinessFlow): Promise<{ id: string; name: string }[]> {
    const breadcrumbs: { id: string; name: string }[] = [];
    let currentFlow: BusinessFlow | null = flow;

    while (currentFlow) {
      breadcrumbs.unshift({ id: currentFlow.id, name: currentFlow.name });

      if (currentFlow.parentId) {
        currentFlow = await this.flowRepository.findById(currentFlow.parentId);
      } else {
        currentFlow = null;
      }
    }

    return breadcrumbs;
  }

  private toResponse(flow: BusinessFlow) {
    return {
      id: flow.id,
      projectId: flow.projectId,
      name: flow.name,
      description: flow.description,
      version: flow.version,
      kind: flow.kind,
      confidence: flow.confidence,
      subProjectId: flow.subProjectId,
      asisFlowId: flow.asisFlowId,
      folderId: flow.folderId,
      parentId: flow.parentId,
      depth: flow.depth,
      laneHeights: flow.laneHeights,
      isRootFlow: flow.isRootFlow,
      isChildFlow: flow.isChildFlow,
      createdAt: flow.createdAt,
      updatedAt: flow.updatedAt,
    };
  }

  private nodeToResponse(node: FlowNode) {
    return {
      id: node.id,
      flowId: node.flowId,
      type: node.type,
      label: node.label,
      description: node.description,
      positionX: node.positionX,
      positionY: node.positionY,
      width: node.width,
      height: node.height,
      roleId: node.roleId,
      childFlowId: node.childFlowId,
      hasChildFlow: node.hasChildFlow,
      isBusinessBlock: node.isBusinessBlock,
      processingTime: node.processingTime,
      handledCount: node.handledCount,
      supplement: node.supplement,
      metadata: node.metadata,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }
}

