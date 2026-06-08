import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IDfdRepository, DfdGraph, SourceFlowGraph, SourceFlowLink } from '../../../domain/repositories/dfd.repository';
import { DfdDiagram } from '../../../domain/entities/dfd-diagram.entity';
import { DfdNode, DfdNodeKindValue } from '../../../domain/entities/dfd-node.entity';
import { DfdFlow } from '../../../domain/entities/dfd-flow.entity';

interface DiagramRow {
  id: string;
  projectId: string;
  flowId: string | null;
  title: string | null;
  docId: string | null;
  authorName: string | null;
  approverName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NodeRow {
  id: string;
  diagramId: string;
  kind: string;
  label: string;
  number: string | null;
  refFlowId: string | null;
  refNodeId: string | null;
  positionX: number;
  positionY: number;
  createdAt: Date;
  updatedAt: Date;
}

interface FlowRow {
  id: string;
  diagramId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  dataItem: string;
  informationTypeId: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class DfdRepositoryImpl implements IDfdRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toDiagram(r: DiagramRow): DfdDiagram {
    return DfdDiagram.reconstruct({
      id: r.id,
      projectId: r.projectId,
      flowId: r.flowId,
      title: r.title,
      docId: r.docId,
      authorName: r.authorName,
      approverName: r.approverName,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  private toNode(r: NodeRow): DfdNode {
    return DfdNode.reconstruct({
      id: r.id,
      diagramId: r.diagramId,
      kind: r.kind as DfdNodeKindValue,
      label: r.label,
      number: r.number,
      refFlowId: r.refFlowId,
      refNodeId: r.refNodeId,
      positionX: r.positionX,
      positionY: r.positionY,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  private toFlow(r: FlowRow): DfdFlow {
    return DfdFlow.reconstruct({
      id: r.id,
      diagramId: r.diagramId,
      sourceNodeId: r.sourceNodeId,
      targetNodeId: r.targetNodeId,
      sourceHandle: r.sourceHandle,
      targetHandle: r.targetHandle,
      dataItem: r.dataItem,
      informationTypeId: r.informationTypeId,
      order: r.order,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  private graphFrom(
    diagram: DiagramRow,
    nodes: NodeRow[],
    flows: FlowRow[],
  ): DfdGraph {
    return {
      diagram: this.toDiagram(diagram),
      nodes: nodes.map((n) => this.toNode(n)),
      flows: flows.map((f) => this.toFlow(f)),
    };
  }

  async findGraphByProjectFlow(
    projectId: string,
    flowId: string | null,
  ): Promise<DfdGraph | null> {
    // flowId=null も findFirst で扱える（第1レベル）
    const diagram = await this.prisma.dfdDiagram.findFirst({
      where: { projectId, flowId },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        flows: { orderBy: { order: 'asc' } },
      },
    });
    if (!diagram) return null;
    return this.graphFrom(diagram, diagram.nodes, diagram.flows);
  }

  async findGraphByDiagramId(diagramId: string): Promise<DfdGraph | null> {
    const diagram = await this.prisma.dfdDiagram.findUnique({
      where: { id: diagramId },
      include: {
        nodes: { orderBy: { createdAt: 'asc' } },
        flows: { orderBy: { order: 'asc' } },
      },
    });
    if (!diagram) return null;
    return this.graphFrom(diagram, diagram.nodes, diagram.flows);
  }

  async findDiagramById(id: string): Promise<DfdDiagram | null> {
    const r = await this.prisma.dfdDiagram.findUnique({ where: { id } });
    return r ? this.toDiagram(r) : null;
  }

  async createDiagram(d: DfdDiagram): Promise<void> {
    const f = d.fields;
    await this.prisma.dfdDiagram.create({
      data: {
        id: d.id,
        projectId: d.projectId,
        flowId: d.flowId,
        title: f.title,
        docId: f.docId,
        authorName: f.authorName,
        approverName: f.approverName,
      },
    });
  }

  async findOrCreateL1Diagram(d: DfdDiagram): Promise<DfdGraph> {
    const existing = await this.findGraphByProjectFlow(d.projectId, null);
    if (existing) return existing;

    // Postgres は NULL を distinct 扱いするため @@unique([projectId, flowId]) は
    // flowId IS NULL を守れない。partial unique index を冪等に張って並行 create を
    // 単一に絞る（db push 運用でも schema を汚さず担保できる）。
    await this.prisma.$executeRawUnsafe(
      `CREATE UNIQUE INDEX IF NOT EXISTS "dfd_diagrams_project_l1_unique" ` +
        `ON "dfd_diagrams" ("project_id") WHERE "flow_id" IS NULL`,
    );

    const f = d.fields;
    try {
      await this.prisma.dfdDiagram.create({
        data: {
          id: d.id,
          projectId: d.projectId,
          flowId: null,
          title: f.title,
          docId: f.docId,
          authorName: f.authorName,
          approverName: f.approverName,
        },
      });
    } catch (e) {
      // 競合で別リクエストが先に作成 → 既存を読み直す
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const winner = await this.findGraphByProjectFlow(d.projectId, null);
        if (winner) return winner;
      }
      throw e;
    }
    return { diagram: d, nodes: [], flows: [] };
  }

  async saveNode(n: DfdNode): Promise<void> {
    const data = {
      diagramId: n.diagramId,
      kind: n.kind,
      label: n.label,
      number: n.number,
      refFlowId: n.refFlowId,
      refNodeId: n.refNodeId,
      positionX: n.positionX,
      positionY: n.positionY,
    };
    await this.prisma.dfdNode.upsert({
      where: { id: n.id },
      create: { id: n.id, ...data },
      update: data,
    });
  }

  async findNodeById(id: string): Promise<DfdNode | null> {
    const r = await this.prisma.dfdNode.findUnique({ where: { id } });
    return r ? this.toNode(r) : null;
  }

  async deleteNode(id: string): Promise<void> {
    await this.prisma.dfdNode.delete({ where: { id } });
  }

  async saveFlow(f: DfdFlow): Promise<void> {
    const data = {
      diagramId: f.diagramId,
      sourceNodeId: f.sourceNodeId,
      targetNodeId: f.targetNodeId,
      sourceHandle: f.sourceHandle,
      targetHandle: f.targetHandle,
      dataItem: f.dataItem,
      informationTypeId: f.informationTypeId,
      order: f.order,
    };
    await this.prisma.dfdFlow.upsert({
      where: { id: f.id },
      create: { id: f.id, ...data },
      update: data,
    });
  }

  async findFlowById(id: string): Promise<DfdFlow | null> {
    const r = await this.prisma.dfdFlow.findUnique({ where: { id } });
    return r ? this.toFlow(r) : null;
  }

  async deleteFlow(id: string): Promise<void> {
    await this.prisma.dfdFlow.delete({ where: { id } });
  }

  async bulkSavePositions(
    diagramId: string,
    positions: { id: string; positionX: number; positionY: number }[],
  ): Promise<void> {
    await this.prisma.$transaction(
      positions.map((p) =>
        this.prisma.dfdNode.updateMany({
          where: { id: p.id, diagramId },
          data: { positionX: p.positionX, positionY: p.positionY },
        }),
      ),
    );
  }

  async findSourceFlowGraph(flowId: string): Promise<SourceFlowGraph> {
    const nodes = await this.prisma.flowNode.findMany({
      where: { flowId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const edges = await this.prisma.flowEdge.findMany({
      where: { flowId },
      orderBy: { createdAt: 'asc' },
    });
    return {
      nodes: nodes.map((n) => {
        const meta = (n.metadata ?? {}) as Record<string, unknown>;
        const out = meta['output'];
        return {
          id: n.id,
          type: n.type,
          label: n.label,
          output: typeof out === 'string' ? out : null,
        };
      }),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        label: e.label,
      })),
    };
  }

  async findProjectLinkSource(projectId: string): Promise<SourceFlowLink[]> {
    // プロジェクト配下のフロー間クロスリンク。ノードの所属フロー(nodeFlowId)・targetFlowId・
    // direction をそのまま返し、向きの確定（INPUT/OUTPUT のスワップ）は use-case 側で行う。
    const links = await this.prisma.flowNodeLink.findMany({
      where: { node: { flow: { projectId } } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { node: { select: { flowId: true } } },
    });
    return links.map((l) => ({
      direction: l.direction,
      nodeFlowId: l.node.flowId,
      targetFlowId: l.targetFlowId,
      label: l.label,
    }));
  }

  generateId(): string {
    return randomUUID();
  }
}
