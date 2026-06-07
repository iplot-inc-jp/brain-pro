import { Inject, Injectable } from '@nestjs/common';
import {
  BusinessFlow,
  FlowKindValue,
  FlowConfidenceValue,
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
import { randomUUID } from 'crypto';

export interface CreateNodeChildFlowInput {
  userId: string;
  nodeId: string;
  name?: string;
}

export interface ChildFlowOutput {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  version: number;
  kind: FlowKindValue;
  confidence: FlowConfidenceValue;
  subProjectId: string | null;
  parentId: string | null;
  depth: number;
  isRootFlow: boolean;
  isChildFlow: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNodeChildFlowOutput {
  childFlow: ChildFlowOutput;
  /** 既に紐づいていた子フローを返した場合 true */
  alreadyExisted: boolean;
}

function toChildFlowOutput(flow: BusinessFlow): ChildFlowOutput {
  return {
    id: flow.id,
    projectId: flow.projectId,
    name: flow.name,
    description: flow.description,
    version: flow.version,
    kind: flow.kind,
    confidence: flow.confidence,
    subProjectId: flow.subProjectId,
    parentId: flow.parentId,
    depth: flow.depth,
    isRootFlow: flow.isRootFlow,
    isChildFlow: flow.isChildFlow,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

/**
 * ノードの子フロー（ドリルダウン）作成・取得ユースケース
 * - ノードに childFlowId が無ければ新規 BusinessFlow を作成し、ノードへ紐付ける
 * - 既に childFlowId があればその子フローをそのまま返す（冪等）
 */
@Injectable()
export class CreateNodeChildFlowUseCase {
  constructor(
    @Inject(FLOW_NODE_REPOSITORY)
    private readonly nodeRepository: IFlowNodeRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY)
    private readonly flowRepository: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: CreateNodeChildFlowInput,
  ): Promise<CreateNodeChildFlowOutput> {
    const node = await this.nodeRepository.findById(input.nodeId);
    if (!node) {
      throw new EntityNotFoundError('FlowNode', input.nodeId);
    }

    const parentFlow = await this.flowRepository.findById(node.flowId);
    if (!parentFlow) {
      throw new EntityNotFoundError('BusinessFlow', node.flowId);
    }

    const project = await this.projectRepository.findById(parentFlow.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', parentFlow.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 既に子フローが紐づいている場合は冪等にそのフローを返す
    if (node.childFlowId) {
      const existing = await this.flowRepository.findById(node.childFlowId);
      if (existing) {
        return { childFlow: toChildFlowOutput(existing), alreadyExisted: true };
      }
      // 参照が壊れている場合は作り直す（フォールスルー）
    }

    // 新規子フローを作成（kind は親から継承、depth = 親.depth + 1）
    const childFlow = BusinessFlow.create({
      id: randomUUID(),
      projectId: parentFlow.projectId,
      name: input.name?.trim() || `${node.label} 詳細`,
      kind: parentFlow.kind,
      confidence: parentFlow.confidence,
      parentId: parentFlow.id,
      depth: parentFlow.depth + 1,
    });

    const savedFlow = await this.flowRepository.save(childFlow);

    // ノードに子フローを紐付け
    node.linkChildFlow(savedFlow.id);
    await this.nodeRepository.save(node);

    return { childFlow: toChildFlowOutput(savedFlow), alreadyExisted: false };
  }
}
