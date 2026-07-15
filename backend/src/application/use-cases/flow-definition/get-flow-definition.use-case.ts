import { Inject, Injectable } from '@nestjs/common';
import {
  FLOW_DEFINITION_REPOSITORY, IFlowDefinitionRepository,
  BUSINESS_FLOW_REPOSITORY, IBusinessFlowRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../../domain';
import { FlowDefinitionOutput, toFlowDefinitionOutput } from './flow-definition.output';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface GetFlowDefinitionInput { userId: string; principal: AccessPrincipal; flowId: string; }

@Injectable()
export class GetFlowDefinitionUseCase {
  constructor(
    @Inject(FLOW_DEFINITION_REPOSITORY) private readonly repo: IFlowDefinitionRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY) private readonly flowRepo: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: GetFlowDefinitionInput): Promise<FlowDefinitionOutput> {
    const flow = await this.flowRepo.findById(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    const project = await this.projectRepo.findById(flow.projectId);
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    // プロジェクト単位 RBAC: 読取は VIEW 以上（プロジェクト除外ユーザーを弾く）
    await this.projectAccess.assertPrincipalAccess(input.principal, flow.projectId, 'view');
    const def = await this.repo.findByFlowId(input.flowId);
    return toFlowDefinitionOutput(input.flowId, def);
  }
}
