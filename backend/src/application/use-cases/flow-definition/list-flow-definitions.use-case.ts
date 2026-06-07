import { Inject, Injectable } from '@nestjs/common';
import {
  FLOW_DEFINITION_REPOSITORY, IFlowDefinitionRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../../domain';
import { toFlowDefinitionOutput } from './flow-definition.output';

export interface ListFlowDefinitionsInput { userId: string; projectId: string; }
export interface FlowDefinitionRow {
  flowId: string; flowName: string; kind: string;
  definition: ReturnType<typeof toFlowDefinitionOutput>;
}

@Injectable()
export class ListFlowDefinitionsUseCase {
  constructor(
    @Inject(FLOW_DEFINITION_REPOSITORY) private readonly repo: IFlowDefinitionRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: ListFlowDefinitionsInput): Promise<FlowDefinitionRow[]> {
    const project = await this.projectRepo.findById(input.projectId);
    if (!project) throw new EntityNotFoundError('Project', input.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    const rows = await this.repo.findByProjectId(input.projectId);
    return rows.map((r) => ({
      flowId: r.flowId, flowName: r.flowName, kind: r.kind,
      definition: toFlowDefinitionOutput(r.flowId, r.definition),
    }));
  }
}
