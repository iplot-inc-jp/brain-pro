import { Inject, Injectable } from '@nestjs/common';
import {
  FLOW_DEFINITION_REPOSITORY, IFlowDefinitionRepository,
  BUSINESS_FLOW_REPOSITORY, IBusinessFlowRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
} from '../../../domain';
import { FlowDefinition } from '../../../domain/entities/flow-definition.entity';
import { FlowDefinitionFields } from '../../../domain/entities/flow-definition.entity';
import { FlowDefinitionOutput, toFlowDefinitionOutput } from './flow-definition.output';

export interface UpsertFlowDefinitionInput {
  userId: string;
  flowId: string;
  patch: Partial<FlowDefinitionFields>;
}

@Injectable()
export class UpsertFlowDefinitionUseCase {
  constructor(
    @Inject(FLOW_DEFINITION_REPOSITORY) private readonly repo: IFlowDefinitionRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY) private readonly flowRepo: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: UpsertFlowDefinitionInput): Promise<FlowDefinitionOutput> {
    const flow = await this.flowRepo.findById(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    const project = await this.projectRepo.findById(flow.projectId);
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    let def = await this.repo.findByFlowId(input.flowId);
    if (!def) {
      def = FlowDefinition.create({ flowId: input.flowId, ...input.patch }, this.repo.generateId());
    } else {
      def.update(input.patch);
    }
    await this.repo.save(def);
    return toFlowDefinitionOutput(input.flowId, def);
  }
}
