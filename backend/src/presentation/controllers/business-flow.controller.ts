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

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
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

class UpdateNodePositionsDto {
  @ApiProperty({ type: [NodePositionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodePositionItemDto)
  positions: NodePositionItemDto[];
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

@ApiTags('Business Flows')
@ApiBearerAuth()
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
      },
      orderBy: { createdAt: 'asc' },
    });

    const edges = await this.prisma.flowEdge.findMany({
      where: { flowId: id },
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
      })),
      children: children.map((c) => this.toResponse(c)),
      breadcrumbs,
    };
  }

  @Post()
  @ApiOperation({ summary: 'フローを作成' })
  async create(@Body() dto: CreateBusinessFlowDto) {
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
      folderId: dto.folderId,
      parentId: dto.parentId,
      depth,
    });

    const saved = await this.flowRepository.save(flow);
    return this.toResponse(saved);
  }

  @Put(':id')
  @ApiOperation({ summary: 'フローを更新' })
  async update(@Param('id') id: string, @Body() dto: UpdateBusinessFlowDto) {
    const flow = await this.flowRepository.findById(id);
    if (!flow) {
      return { error: 'Business flow not found' };
    }

    if (dto.name) flow.updateName(dto.name);
    if (dto.description !== undefined) flow.updateDescription(dto.description);
    if (dto.kind) flow.setKind(dto.kind);
    if (dto.confidence) flow.setConfidence(dto.confidence);
    if (dto.subProjectId !== undefined) flow.setSubProject(dto.subProjectId);
    if (dto.folderId !== undefined) flow.setFolder(dto.folderId);
    if (dto.laneHeights !== undefined) flow.setLaneHeights(dto.laneHeights);

    const saved = await this.flowRepository.save(flow);
    return this.toResponse(saved);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'フローを削除' })
  async delete(@Param('id') id: string) {
    await this.flowRepository.delete(id);
    return { success: true };
  }

  // ========== Node Endpoints ==========

  @Post(':flowId/nodes')
  @ApiOperation({ summary: 'ノードを作成' })
  async createNode(
    @Param('flowId') flowId: string,
    @Body() dto: CreateFlowNodeDto,
  ) {
    const node = FlowNode.create({
      id: uuid(),
      flowId,
      type: (dto.type as any) || 'PROCESS',
      label: dto.label,
      description: dto.description,
      positionX: dto.positionX,
      positionY: dto.positionY,
      roleId: dto.roleId,
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
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateFlowNodeDto,
  ) {
    const node = await this.nodeRepository.findById(nodeId);
    if (!node) {
      return { error: 'Node not found' };
    }

    if (dto.label) node.updateLabel(dto.label);
    if (dto.description !== undefined) node.updateDescription(dto.description);
    if (dto.positionX !== undefined && dto.positionY !== undefined) {
      node.updatePosition(dto.positionX, dto.positionY);
    }
    if (dto.type) node.updateType(dto.type as any);
    if (dto.roleId !== undefined) node.assignRole(dto.roleId);
    if (dto.metadata !== undefined) node.updateMetadata(dto.metadata);

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
  async deleteNode(@Param('nodeId') nodeId: string) {
    await this.nodeRepository.delete(nodeId);
    return { success: true };
  }

  // ========== Edge Endpoints ==========

  @Post(':flowId/edges')
  @ApiOperation({ summary: 'エッジを作成' })
  async createEdge(
    @Param('flowId') flowId: string,
    @Body() dto: CreateFlowEdgeDto,
  ) {
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
      },
    });

    return {
      id: edge.id,
      flowId: edge.flowId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      condition: edge.condition,
    };
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
    // 認可: flow -> project -> organization メンバーシップ
    await this.assertFlowMembership(flowId, user.id);

    const data: {
      sourceNodeId?: string;
      targetNodeId?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      label?: string | null;
      condition?: string | null;
    } = {};
    if (dto.sourceNodeId !== undefined) data.sourceNodeId = dto.sourceNodeId;
    if (dto.targetNodeId !== undefined) data.targetNodeId = dto.targetNodeId;
    if (dto.sourceHandle !== undefined) data.sourceHandle = dto.sourceHandle;
    if (dto.targetHandle !== undefined) data.targetHandle = dto.targetHandle;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.condition !== undefined) data.condition = dto.condition;

    const edge = await this.prisma.flowEdge.update({
      where: { id: edgeId },
      data,
    });

    return {
      id: edge.id,
      flowId: edge.flowId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      condition: edge.condition,
    };
  }

  @Put(':flowId/edges/:edgeId')
  @ApiOperation({ summary: 'エッジを更新' })
  async updateEdge(
    @Param('edgeId') edgeId: string,
    @Body() dto: UpdateFlowEdgeDto,
  ) {
    const data: {
      sourceNodeId?: string;
      targetNodeId?: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      label?: string | null;
      condition?: string | null;
    } = {};
    if (dto.sourceNodeId !== undefined) data.sourceNodeId = dto.sourceNodeId;
    if (dto.targetNodeId !== undefined) data.targetNodeId = dto.targetNodeId;
    if (dto.sourceHandle !== undefined) data.sourceHandle = dto.sourceHandle;
    if (dto.targetHandle !== undefined) data.targetHandle = dto.targetHandle;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.condition !== undefined) data.condition = dto.condition;

    const edge = await this.prisma.flowEdge.update({
      where: { id: edgeId },
      data,
    });

    return {
      id: edge.id,
      flowId: edge.flowId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      condition: edge.condition,
    };
  }

  @Delete(':flowId/edges/:edgeId')
  @ApiOperation({ summary: 'エッジを削除' })
  async deleteEdge(@Param('edgeId') edgeId: string) {
    await this.prisma.flowEdge.delete({ where: { id: edgeId } });
    return { success: true };
  }

  // ========== Child Flow Endpoints ==========

  @Post(':flowId/nodes/:nodeId/child-flow')
  @ApiOperation({ summary: 'ノードに子フローを作成・紐付け' })
  async createChildFlow(
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: CreateChildFlowDto,
  ) {
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
  async unlinkChildFlow(@Param('nodeId') nodeId: string) {
    const node = await this.nodeRepository.findById(nodeId);
    if (!node) {
      return { error: 'Node not found' };
    }

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
  private async assertFlowMembership(
    flowId: string,
    userId: string,
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

    return flow;
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
      roleId: node.roleId,
      childFlowId: node.childFlowId,
      hasChildFlow: node.hasChildFlow,
      isBusinessBlock: node.isBusinessBlock,
      metadata: node.metadata,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }
}

