import { Inject, Injectable } from '@nestjs/common';
import {
  DFD_REPOSITORY, IDfdRepository, DfdGraph,
  BUSINESS_FLOW_REPOSITORY, IBusinessFlowRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
  DfdDiagram, DfdNode, DfdFlow,
} from '../../../domain';
import { DfdDiagramOutput, toDfdDiagramOutput } from './dfd.output';

export interface GenerateFlowDfdInput { userId: string; flowId: string; }

// 業務フローノードのうち FUNCTION 化対象（START/END は除外）
const FUNCTION_SOURCE_TYPES = new Set([
  'PROCESS', 'DECISION', 'SYSTEM_INTEGRATION', 'MANUAL_OPERATION', 'DATA_STORE',
]);

@Injectable()
export class GenerateFlowDfdUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY) private readonly flowRepo: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: GenerateFlowDfdInput): Promise<DfdDiagramOutput> {
    const flow = await this.flowRepo.findById(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    const project = await this.projectRepo.findById(flow.projectId);
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 図 get-or-create
    let graph: DfdGraph | null = await this.repo.findGraphByProjectFlow(
      project.id,
      input.flowId,
    );
    if (!graph) {
      const created = DfdDiagram.create(
        { projectId: project.id, flowId: input.flowId, title: flow.name },
        this.repo.generateId(),
      );
      await this.repo.createDiagram(created);
      graph = { diagram: created, nodes: [], flows: [] };
    }
    const diagramId = graph.diagram.id;

    const source = await this.repo.findSourceFlowGraph(input.flowId);
    const srcNodes = source.nodes.filter((n) => FUNCTION_SOURCE_TYPES.has(n.type));
    const srcNodeById = new Map(source.nodes.map((n) => [n.id, n] as const));

    // 既存 FUNCTION ノード（refNodeId で突合）。手動ノード(外部実体/データストア)・位置は保持
    const existingFnByRef = new Map<string, DfdNode>();
    for (const n of graph.nodes) {
      if (n.kind === 'FUNCTION' && n.refNodeId) existingFnByRef.set(n.refNodeId, n);
    }

    // 採番（既存 FUNCTION の最大連番から続ける）
    let maxSeq = 0;
    for (const n of graph.nodes) {
      if (n.kind === 'FUNCTION' && n.number) {
        const m = /-(\d+)$/.exec(n.number);
        if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
      }
    }

    // 過剰: ソースに対応する FlowNode が無くなった FUNCTION ノードを削除
    for (const n of graph.nodes) {
      if (n.kind === 'FUNCTION' && n.refNodeId && !srcNodeById.has(n.refNodeId)) {
        await this.repo.deleteNode(n.id);
        existingFnByRef.delete(n.refNodeId);
      }
    }

    // 不足: 新規 FlowNode を FUNCTION ノードとして追加
    const dfdNodeByRef = new Map<string, DfdNode>(existingFnByRef);
    let seq = maxSeq;
    let posY = 80;
    for (const sn of srcNodes) {
      if (dfdNodeByRef.has(sn.id)) continue;
      seq += 1;
      const node = DfdNode.create(
        {
          diagramId,
          kind: 'FUNCTION',
          label: sn.label,
          number: `2-${seq}`,
          refNodeId: sn.id,
          positionX: 320,
          positionY: posY,
        },
        this.repo.generateId(),
      );
      posY += 120;
      await this.repo.saveNode(node);
      dfdNodeByRef.set(sn.id, node);
    }

    // データフロー同期：FlowEdge(両端が FUNCTION 化対象) → DfdFlow
    // 自動管理対象は「両端が refNode を持つ FUNCTION ノード」間のフローのみ
    const autoFnNodeIds = new Set(
      Array.from(dfdNodeByRef.values()).map((n) => n.id),
    );
    const existingAutoFlowKey = new Map<string, DfdFlow>();
    for (const f of graph.flows) {
      if (autoFnNodeIds.has(f.sourceNodeId) && autoFnNodeIds.has(f.targetNodeId)) {
        existingAutoFlowKey.set(`${f.sourceNodeId}->${f.targetNodeId}`, f);
      }
    }

    const desiredKeys = new Set<string>();
    let order = 0;
    for (const e of source.edges) {
      const s = dfdNodeByRef.get(e.sourceNodeId);
      const t = dfdNodeByRef.get(e.targetNodeId);
      if (!s || !t) continue; // 片端が FUNCTION でない（START/END等）→ 自動生成しない
      const key = `${s.id}->${t.id}`;
      desiredKeys.add(key);
      const dataItem =
        e.label || srcNodeById.get(e.sourceNodeId)?.output || '情報';
      const existing = existingAutoFlowKey.get(key);
      if (existing) {
        // 既存の自動フローは order のみ同期し、dataItem の手動編集は保持する。
        existing.updateOrder(order);
        await this.repo.saveFlow(existing);
      } else {
        const df = DfdFlow.create(
          { diagramId, sourceNodeId: s.id, targetNodeId: t.id, dataItem, order },
          this.repo.generateId(),
        );
        await this.repo.saveFlow(df);
      }
      order += 1;
    }

    // 過剰: 自動管理対象のうちソースに無くなったフローを削除
    for (const [key, f] of existingAutoFlowKey) {
      if (!desiredKeys.has(key)) {
        await this.repo.deleteFlow(f.id);
      }
    }

    const result = await this.repo.findGraphByDiagramId(diagramId);
    return toDfdDiagramOutput(result ?? graph);
  }
}
