import { Inject, Injectable } from '@nestjs/common';
import {
  DFD_REPOSITORY, IDfdRepository, DfdGraph,
  BUSINESS_FLOW_REPOSITORY, IBusinessFlowRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ForbiddenError,
  DfdDiagram,
} from '../../../domain';
import { DfdDiagramOutput, toDfdDiagramOutput } from './dfd.output';
import { AccessPrincipal, ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface GetFlowDfdInput { userId: string; principal: AccessPrincipal; flowId: string; }

@Injectable()
export class GetFlowDfdUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(BUSINESS_FLOW_REPOSITORY) private readonly flowRepo: IBusinessFlowRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: GetFlowDfdInput): Promise<DfdDiagramOutput> {
    const flow = await this.flowRepo.findById(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    const project = await this.projectRepo.findById(flow.projectId);
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, input.userId))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    // プロジェクト単位 RBAC: 読取は VIEW 以上
    await this.projectAccess.assertPrincipalAccess(input.principal, flow.projectId, 'view');

    let graph: DfdGraph | null = await this.repo.findGraphByProjectFlow(
      project.id,
      input.flowId,
    );
    if (!graph) {
      // 図が無ければ空の図を作って返す（get-or-create）
      const diagram = DfdDiagram.create(
        { projectId: project.id, flowId: input.flowId, title: flow.name },
        this.repo.generateId(),
      );
      await this.repo.createDiagram(diagram);
      graph = { diagram, nodes: [], flows: [] };
    }
    return toDfdDiagramOutput(graph);
  }
}
