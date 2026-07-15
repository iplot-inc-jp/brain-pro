import { Inject, Injectable } from '@nestjs/common';
import {
  DFD_REPOSITORY, IDfdRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError,
  DfdFlow,
} from '../../../domain';
import { authorizeDiagram } from './dfd-authz';
import { AccessPrincipal, ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { DfdFlowOutput, toDfdFlowOutput } from './dfd.output';

export interface AddDfdFlowInput {
  userId: string;
  principal: AccessPrincipal;
  diagramId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  dataItem?: string;
  informationTypeId?: string | null;
  pathStyle?: string | null;
  labelT?: number | null;
  infoT?: number | null;
  order?: number;
}

@Injectable()
export class AddDfdFlowUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: AddDfdFlowInput): Promise<DfdFlowOutput> {
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, input.diagramId, input.principal, this.projectAccess, 'edit');
    // 両端ノードが同じ図に属することを確認
    const src = await this.repo.findNodeById(input.sourceNodeId);
    const tgt = await this.repo.findNodeById(input.targetNodeId);
    if (!src || src.diagramId !== input.diagramId) {
      throw new EntityNotFoundError('DfdNode', input.sourceNodeId);
    }
    if (!tgt || tgt.diagramId !== input.diagramId) {
      throw new EntityNotFoundError('DfdNode', input.targetNodeId);
    }
    const flow = DfdFlow.create(
      {
        diagramId: input.diagramId,
        sourceNodeId: input.sourceNodeId,
        targetNodeId: input.targetNodeId,
        sourceHandle: input.sourceHandle ?? null,
        targetHandle: input.targetHandle ?? null,
        dataItem: input.dataItem ?? '',
        informationTypeId: input.informationTypeId ?? null,
        pathStyle: input.pathStyle ?? null,
        labelT: input.labelT ?? null,
        infoT: input.infoT ?? null,
        order: input.order ?? 0,
      },
      this.repo.generateId(),
    );
    await this.repo.saveFlow(flow);
    return toDfdFlowOutput(flow);
  }
}

export interface UpdateDfdFlowInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  dataItem?: string;
  informationTypeId?: string | null;
  pathStyle?: string | null;
  labelT?: number | null;
  infoT?: number | null;
  sourceNodeId?: string;
  targetNodeId?: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  order?: number;
}

@Injectable()
export class UpdateDfdFlowUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateDfdFlowInput): Promise<DfdFlowOutput> {
    const flow = await this.repo.findFlowById(input.id);
    if (!flow) throw new EntityNotFoundError('DfdFlow', input.id);
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, flow.diagramId, input.principal, this.projectAccess, 'edit');

    if (input.dataItem !== undefined) flow.updateDataItem(input.dataItem);
    if (input.informationTypeId !== undefined)
      flow.updateInformationType(input.informationTypeId);
    if (input.pathStyle !== undefined) flow.updatePathStyle(input.pathStyle);
    if (input.labelT !== undefined) flow.updateLabelT(input.labelT);
    if (input.infoT !== undefined) flow.updateInfoT(input.infoT);
    if (input.sourceNodeId !== undefined || input.targetNodeId !== undefined) {
      flow.updateEndpoints(
        input.sourceNodeId ?? flow.sourceNodeId,
        input.targetNodeId ?? flow.targetNodeId,
      );
    }
    if (input.sourceHandle !== undefined) flow.updateSourceHandle(input.sourceHandle);
    if (input.targetHandle !== undefined) flow.updateTargetHandle(input.targetHandle);
    if (input.order !== undefined) flow.updateOrder(input.order);
    await this.repo.saveFlow(flow);
    return toDfdFlowOutput(flow);
  }
}

export interface DeleteDfdFlowInput { userId: string; principal: AccessPrincipal; id: string; }

@Injectable()
export class DeleteDfdFlowUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteDfdFlowInput): Promise<void> {
    const flow = await this.repo.findFlowById(input.id);
    if (!flow) {
      throw new EntityNotFoundError('DfdFlow', input.id);
    }
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, flow.diagramId, input.principal, this.projectAccess, 'edit');
    await this.repo.deleteFlow(input.id);
  }
}
