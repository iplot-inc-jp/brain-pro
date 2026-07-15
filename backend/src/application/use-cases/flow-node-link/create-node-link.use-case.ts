import { Inject, Injectable } from '@nestjs/common';
import {
  FlowNodeLink,
  FlowLinkDirectionValue,
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
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface CreateNodeLinkInput {
  userId: string;
  principal: AccessPrincipal;
  nodeId: string;
  direction: FlowLinkDirectionValue;
  targetFlowId: string;
  targetNodeId?: string | null;
  label?: string | null;
}

/**
 * クロスフロー入出力リンク作成ユースケース
 */
@Injectable()
export class CreateNodeLinkUseCase {
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
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: CreateNodeLinkInput): Promise<FlowNodeLinkOutput> {
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

    // プロジェクト単位 RBAC: リンク作成は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      flow.projectId,
      'edit',
    );

    // ターゲットフロー存在確認 + 同一プロジェクト強制。
    // （他プロジェクトのフロー名/ノードラベルを toFlowNodeLinkOutput 経由で読み出せる
    //   越境を防ぐ。KPI/DFD Add と同型のクロス参照スコープ検査。他プロジェクトのフローは
    //   存在を秘匿するため 404 扱い。）
    const targetFlow = await this.flowRepository.findById(input.targetFlowId);
    if (!targetFlow || targetFlow.projectId !== flow.projectId) {
      throw new EntityNotFoundError('BusinessFlow', input.targetFlowId);
    }

    // ターゲットノード存在確認（任意）
    let targetNodeLabel: string | null = null;
    if (input.targetNodeId) {
      const targetNode = await this.nodeRepository.findById(input.targetNodeId);
      // ターゲットノードは（同一プロジェクトと確定済みの）ターゲットフロー配下に限定。
      if (!targetNode || targetNode.flowId !== input.targetFlowId) {
        throw new EntityNotFoundError('FlowNode', input.targetNodeId);
      }
      targetNodeLabel = targetNode.label;
    }

    const id = this.linkRepository.generateId();
    const link = FlowNodeLink.create(
      {
        nodeId: input.nodeId,
        direction: input.direction,
        targetFlowId: input.targetFlowId,
        targetNodeId: input.targetNodeId,
        label: input.label,
      },
      id,
    );

    await this.linkRepository.save(link);

    return toFlowNodeLinkOutput(link, targetFlow.name, targetNodeLabel);
  }
}
