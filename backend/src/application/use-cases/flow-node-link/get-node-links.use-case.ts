import { Inject, Injectable } from '@nestjs/common';
import {
  FlowNodeLink,
  IFlowNodeLinkRepository,
  FLOW_NODE_LINK_REPOSITORY,
  IFlowNodeRepository,
  FLOW_NODE_REPOSITORY,
  IBusinessFlowRepository,
  BUSINESS_FLOW_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  FlowNodeLinkOutput,
  toFlowNodeLinkOutput,
} from './flow-node-link.output';

export interface GetNodeLinksInput {
  userId: string;
  nodeId: string;
}

/**
 * 入出力リンク（双方向）の取得結果
 * outgoing: このノードを起点とするリンク
 * incoming: このノードを参照しているリンク（他ノード起点）
 */
export interface NodeLinksOutput {
  nodeId: string;
  outgoing: FlowNodeLinkOutput[];
  incoming: FlowNodeLinkOutput[];
}

/**
 * ノードのクロスフロー入出力リンク一覧取得ユースケース（双方向）
 */
@Injectable()
export class GetNodeLinksUseCase {
  constructor(
    @Inject(FLOW_NODE_LINK_REPOSITORY)
    private readonly linkRepository: IFlowNodeLinkRepository,
    @Inject(FLOW_NODE_REPOSITORY)
    private readonly nodeRepository: IFlowNodeRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY)
    private readonly flowRepository: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetNodeLinksInput): Promise<NodeLinksOutput> {
    const node = await this.nodeRepository.findById(input.nodeId);
    if (!node) {
      throw new EntityNotFoundError('FlowNode', input.nodeId);
    }

    const flow = await this.flowRepository.findById(node.flowId);
    if (!flow) {
      throw new EntityNotFoundError('BusinessFlow', node.flowId);
    }

    const project = await this.projectRepository.findById(flow.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', flow.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const outgoingLinks = await this.linkRepository.findByNodeId(input.nodeId);
    const incomingLinks = await this.linkRepository.findByTargetNodeId(
      input.nodeId,
    );

    const outgoing = await Promise.all(
      outgoingLinks.map((l) => this.resolveOutgoing(l)),
    );
    const incoming = await Promise.all(
      incomingLinks.map((l) => this.resolveIncoming(l)),
    );

    return {
      nodeId: input.nodeId,
      outgoing,
      incoming,
    };
  }

  /** 起点リンク: targetFlow / targetNode の名称を解決 */
  private async resolveOutgoing(
    link: FlowNodeLink,
  ): Promise<FlowNodeLinkOutput> {
    const targetFlow = await this.flowRepository.findById(link.targetFlowId);
    let targetNodeLabel: string | null = null;
    if (link.targetNodeId) {
      const targetNode = await this.nodeRepository.findById(link.targetNodeId);
      targetNodeLabel = targetNode?.label ?? null;
    }
    return toFlowNodeLinkOutput(link, targetFlow?.name ?? null, targetNodeLabel);
  }

  /**
   * 被参照リンク: 起点ノード側のフロー名・ノードラベルを解決して提示。
   * incoming では targetFlowName/targetNodeLabel に「相手側（起点）」の名称を入れる。
   */
  private async resolveIncoming(
    link: FlowNodeLink,
  ): Promise<FlowNodeLinkOutput> {
    const sourceNode = await this.nodeRepository.findById(link.nodeId);
    let sourceFlowName: string | null = null;
    if (sourceNode) {
      const sourceFlow = await this.flowRepository.findById(sourceNode.flowId);
      sourceFlowName = sourceFlow?.name ?? null;
    }
    return toFlowNodeLinkOutput(
      link,
      sourceFlowName,
      sourceNode?.label ?? null,
    );
  }
}
