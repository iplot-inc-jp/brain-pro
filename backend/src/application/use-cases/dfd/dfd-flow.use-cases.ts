import { Inject, Injectable } from '@nestjs/common';
import {
  DFD_REPOSITORY, IDfdRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError,
  DfdFlow,
} from '../../../domain';
import { authorizeDiagram } from './dfd-authz';
import { DfdFlowOutput, toDfdFlowOutput } from './dfd.output';

export interface AddDfdFlowInput {
  userId: string;
  diagramId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  dataItem?: string;
  informationTypeId?: string | null;
  order?: number;
}

@Injectable()
export class AddDfdFlowUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: AddDfdFlowInput): Promise<DfdFlowOutput> {
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, input.diagramId, input.userId);
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
  id: string;
  dataItem?: string;
  informationTypeId?: string | null;
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
  ) {}

  async execute(input: UpdateDfdFlowInput): Promise<DfdFlowOutput> {
    const flow = await this.repo.findFlowById(input.id);
    if (!flow) throw new EntityNotFoundError('DfdFlow', input.id);
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, flow.diagramId, input.userId);

    if (input.dataItem !== undefined) flow.updateDataItem(input.dataItem);
    if (input.informationTypeId !== undefined)
      flow.updateInformationType(input.informationTypeId);
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

export interface DeleteDfdFlowInput { userId: string; id: string; }

@Injectable()
export class DeleteDfdFlowUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: DeleteDfdFlowInput): Promise<void> {
    const flow = await this.repo.findFlowById(input.id);
    if (!flow) {
      throw new EntityNotFoundError('DfdFlow', input.id);
    }
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, flow.diagramId, input.userId);
    await this.repo.deleteFlow(input.id);
  }
}
