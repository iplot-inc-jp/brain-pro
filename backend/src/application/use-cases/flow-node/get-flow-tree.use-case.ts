import { Inject, Injectable } from '@nestjs/common';
import {
  FlowKindValue,
  FlowConfidenceValue,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';

export interface GetFlowTreeInput {
  userId: string;
  projectId: string;
}

/**
 * フローツリー（親子階層マップ）の1ノード。
 * プロジェクト内の全フローをフラット配列で返す。
 */
export interface FlowTreeItem {
  id: string;
  name: string;
  /** ASIS / TOBE 判別子 */
  kind: FlowKindValue;
  /** 確信度（HYPOTHESIS / CONFIRMED） */
  confidence: FlowConfidenceValue;
  /** 階層の深さ（ルート=0） */
  depth: number;
  /** ドリルダウン元の親フローID（null = ルート） */
  parentId: string | null;
  /** フォルダによるグルーピング（任意） */
  folderId: string | null;
  /** サブプロジェクトによるグルーピング（任意） */
  subProjectId: string | null;
  /** このフローに属する FlowNode 数 */
  nodeCount: number;
  /** このフローへドリルダウンする親フロー側ノードのID（ルートは null） */
  originNodeId: string | null;
  /** その親フロー側ノードのラベル（ルートは null） */
  originNodeLabel: string | null;
}

/**
 * プロジェクト全体のフローツリー（親子階層マップ）取得ユースケース。
 *
 * - business_flows をプロジェクト単位で取得（ノード数は _count で集約）
 * - 子フローへドリルダウンする親フロー側ノード（childFlowId 非 null）を
 *   ルックアップし、各フローの originNode を解決する
 * - 認可はプロジェクト → 組織メンバーシップで判定（他の業務フロー系
 *   ユースケースと同様）
 */
@Injectable()
export class GetFlowTreeUseCase {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(input: GetFlowTreeInput): Promise<FlowTreeItem[]> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 1. プロジェクト内の全フロー（ノード数を _count で集約）
    const flows = await this.prisma.businessFlow.findMany({
      where: { projectId: input.projectId },
      select: {
        id: true,
        name: true,
        kind: true,
        confidence: true,
        depth: true,
        parentId: true,
        folderId: true,
        subProjectId: true,
        _count: { select: { nodes: true } },
      },
      orderBy: [{ depth: 'asc' }, { name: 'asc' }],
    });

    // 2. このプロジェクト内で子フローへドリルダウンしているノードを取得。
    //    childFlowId → { originNodeId, originNodeLabel } のマップを構築。
    //    (origin ノードの flowId は対象フローの parentId に一致する)
    const originNodes = await this.prisma.flowNode.findMany({
      where: {
        childFlowId: { not: null },
        flow: { projectId: input.projectId },
      },
      select: { id: true, label: true, childFlowId: true },
    });

    const originByChildFlowId = new Map<
      string,
      { originNodeId: string; originNodeLabel: string }
    >();
    for (const node of originNodes) {
      if (node.childFlowId) {
        originByChildFlowId.set(node.childFlowId, {
          originNodeId: node.id,
          originNodeLabel: node.label,
        });
      }
    }

    return flows.map((f) => {
      const origin = originByChildFlowId.get(f.id) ?? null;
      return {
        id: f.id,
        name: f.name,
        kind: f.kind as FlowKindValue,
        confidence: f.confidence as FlowConfidenceValue,
        depth: f.depth,
        parentId: f.parentId,
        folderId: f.folderId,
        subProjectId: f.subProjectId,
        nodeCount: f._count.nodes,
        originNodeId: origin?.originNodeId ?? null,
        originNodeLabel: origin?.originNodeLabel ?? null,
      };
    });
  }
}
