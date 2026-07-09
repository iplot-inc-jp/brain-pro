import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DFD_REPOSITORY, IDfdRepository } from '../../domain';
import { toDfdDiagramOutput } from '../../application/use-cases/dfd/dfd.output';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ShareLinkService } from '../../infrastructure/services/share-link.service';
import { Public } from '../decorators/public.decorator';

/**
 * 共有リンクの閲覧エンドポイント（DFD / オブジェクト関係性マップ / イシューツリー）。
 *
 * すべて @Public（グローバル JwtAuthGuard をスキップ）。scope=ORG のリンクは
 * ShareLinkService が Authorization ヘッダを手動検証して組織メンバーシップを要求する。
 * 業務フロー図（FLOW）の閲覧は BusinessFlowController の shared/:token（getById と同形）に置く。
 */
@ApiTags('共有リンク閲覧')
@Controller('shared')
export class SharedViewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shareLinkService: ShareLinkService,
    @Inject(DFD_REPOSITORY) private readonly dfdRepo: IDfdRepository,
  ) {}

  @Public()
  @Get('dfd/:token')
  @ApiOperation({ summary: '共有リンクからDFDを閲覧' })
  async getSharedDfd(
    @Param('token') token: string,
    @Headers('authorization') authorization?: string,
  ) {
    const link = await this.shareLinkService.resolveViewableLink(
      'DFD',
      token,
      authorization,
    );
    const graph = await this.dfdRepo.findGraphByDiagramId(link.targetId);
    if (!graph) {
      throw new NotFoundException('共有リンクが無効です');
    }

    const [annotations, project, informationTypes, dataObjects] =
      await Promise.all([
        this.prisma.dfdAnnotation.findMany({
          where: { diagramId: link.targetId },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.project.findUnique({
          where: { id: link.projectId },
          select: { name: true },
        }),
        this.prisma.informationType.findMany({
          where: { projectId: link.projectId },
          orderBy: { order: 'asc' },
        }),
        this.prisma.dataObject.findMany({
          where: { projectId: link.projectId },
          orderBy: { order: 'asc' },
          include: {
            tables: { select: { id: true, name: true, displayName: true } },
            dfdNodes: { select: { id: true, label: true } },
          },
        }),
      ]);

    return {
      diagram: toDfdDiagramOutput(graph),
      annotations: annotations.map((a) => ({
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
      })),
      informationTypes: informationTypes.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        name: t.name,
        category: t.category,
        description: t.description,
        order: t.order,
      })),
      dataObjects: dataObjects.map((o) => this.toDataObjectDto(o)),
      projectName: project?.name ?? null,
    };
  }

  @Public()
  @Get('object-map/:token')
  @ApiOperation({ summary: '共有リンクからオブジェクト関係性マップを閲覧' })
  async getSharedObjectMap(
    @Param('token') token: string,
    @Headers('authorization') authorization?: string,
  ) {
    const link = await this.shareLinkService.resolveViewableLink(
      'OBJECT_MAP',
      token,
      authorization,
    );
    const projectId = link.targetId; // OBJECT_MAP の targetId はプロジェクトID

    const [objects, relations, annotations, subProjects, project] =
      await Promise.all([
        this.prisma.dataObject.findMany({
          where: { projectId },
          orderBy: { order: 'asc' },
          include: {
            tables: { select: { id: true, name: true, displayName: true } },
            dfdNodes: { select: { id: true, label: true } },
          },
        }),
        this.prisma.dataObjectRelation.findMany({
          where: { projectId },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.dataObjectAnnotation.findMany({
          where: { projectId },
          orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.subProject.findMany({
          where: { projectId },
          orderBy: { order: 'asc' },
        }),
        this.prisma.project.findUnique({
          where: { id: projectId },
          select: { name: true },
        }),
      ]);

    return {
      objects: objects.map((o) => this.toDataObjectDto(o)),
      relations: relations.map((r) => ({
        id: r.id,
        projectId: r.projectId,
        sourceObjectId: r.sourceObjectId,
        targetObjectId: r.targetObjectId,
        cardinality: r.cardinality,
        label: r.label,
        description: r.description,
        pathStyle: r.pathStyle,
        sourceHandle: r.sourceHandle,
        targetHandle: r.targetHandle,
      })),
      annotations: annotations.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        kind: a.kind,
        text: a.text,
        positionX: a.positionX,
        positionY: a.positionY,
        width: a.width,
        height: a.height,
        color: a.color,
        borderStyle: a.borderStyle,
        fillOpacity: a.fillOpacity,
        subProjectId: a.subProjectId,
        visible: a.visible,
        order: a.order,
        updatedAt: a.updatedAt.toISOString(),
      })),
      subProjects: subProjects.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        parentId: s.parentId,
        name: s.name,
        description: s.description,
        order: s.order,
      })),
      projectName: project?.name ?? null,
    };
  }

  @Public()
  @Get('issue-tree/:token')
  @ApiOperation({ summary: '共有リンクからイシューツリーを閲覧' })
  async getSharedIssueTree(
    @Param('token') token: string,
    @Headers('authorization') authorization?: string,
  ) {
    const link = await this.shareLinkService.resolveViewableLink(
      'ISSUE_TREE',
      token,
      authorization,
    );
    const tree = await this.prisma.issueTree.findUnique({
      where: { id: link.targetId },
      include: {
        nodes: { orderBy: [{ depth: 'asc' }, { order: 'asc' }] },
      },
    });
    if (!tree) {
      throw new NotFoundException('共有リンクが無効です');
    }
    const project = await this.prisma.project.findUnique({
      where: { id: tree.projectId },
      select: { name: true },
    });

    return {
      id: tree.id,
      projectId: tree.projectId,
      type: tree.type,
      pattern: tree.pattern,
      name: tree.name,
      rootQuestion: tree.rootQuestion,
      nodes: tree.nodes.map((n) => ({
        id: n.id,
        treeId: n.treeId,
        parentId: n.parentId,
        depth: n.depth,
        order: n.order,
        label: n.label,
        kind: n.kind,
        verification: n.verification,
        recommendation: n.recommendation,
        evidence: n.evidence,
        rootCauseNodeId: n.rootCauseNodeId,
        metadata: n.metadata,
      })),
      projectName: project?.name ?? null,
    };
  }

  /** prisma DataObject（tables/dfdNodes include 済み）→ フロント DataObjectDto 形。 */
  private toDataObjectDto(o: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    color: string | null;
    subProjectId: string | null;
    positionX: number;
    positionY: number;
    order: number;
    updatedAt: Date;
    tables: { id: string; name: string; displayName: string | null }[];
    dfdNodes: { id: string; label: string }[];
  }) {
    return {
      id: o.id,
      projectId: o.projectId,
      name: o.name,
      description: o.description,
      color: o.color,
      subProjectId: o.subProjectId,
      positionX: o.positionX,
      positionY: o.positionY,
      order: o.order,
      tables: o.tables,
      dfdNodes: o.dfdNodes,
      updatedAt: o.updatedAt.toISOString(),
    };
  }
}
