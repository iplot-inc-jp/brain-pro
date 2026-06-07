import { Inject, Injectable } from '@nestjs/common';
import {
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

export interface DeleteNodeLinkInput {
  userId: string;
  linkId: string;
}

/**
 * クロスフロー入出力リンク削除ユースケース
 */
@Injectable()
export class DeleteNodeLinkUseCase {
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

  async execute(input: DeleteNodeLinkInput): Promise<void> {
    const link = await this.linkRepository.findById(input.linkId);
    if (!link) {
      throw new EntityNotFoundError('FlowNodeLink', input.linkId);
    }

    const node = await this.nodeRepository.findById(link.nodeId);
    if (!node) {
      throw new EntityNotFoundError('FlowNode', link.nodeId);
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

    await this.linkRepository.delete(input.linkId);
  }
}
