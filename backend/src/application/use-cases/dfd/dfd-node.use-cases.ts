import { Inject, Injectable } from '@nestjs/common';
import {
  DFD_REPOSITORY, IDfdRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError,
  DfdNode,
} from '../../../domain';
import { DfdNodeKindValue } from '../../../domain/entities/dfd-node.entity';
import { authorizeDiagram } from './dfd-authz';
import { DfdNodeOutput, toDfdNodeOutput } from './dfd.output';

export interface AddDfdNodeInput {
  userId: string;
  diagramId: string;
  kind: DfdNodeKindValue;
  label: string;
  number?: string | null;
  refFlowId?: string | null;
  refNodeId?: string | null;
  positionX?: number;
  positionY?: number;
}

@Injectable()
export class AddDfdNodeUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: AddDfdNodeInput): Promise<DfdNodeOutput> {
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, input.diagramId, input.userId);
    const node = DfdNode.create(
      {
        diagramId: input.diagramId,
        kind: input.kind,
        label: input.label,
        number: input.number ?? null,
        refFlowId: input.refFlowId ?? null,
        refNodeId: input.refNodeId ?? null,
        positionX: input.positionX ?? 0,
        positionY: input.positionY ?? 0,
      },
      this.repo.generateId(),
    );
    await this.repo.saveNode(node);
    return toDfdNodeOutput(node);
  }
}

export interface UpdateDfdNodeInput {
  userId: string;
  id: string;
  label?: string;
  number?: string | null;
  kind?: DfdNodeKindValue;
  positionX?: number;
  positionY?: number;
}

@Injectable()
export class UpdateDfdNodeUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: UpdateDfdNodeInput): Promise<DfdNodeOutput> {
    const node = await this.repo.findNodeById(input.id);
    if (!node) throw new EntityNotFoundError('DfdNode', input.id);
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, node.diagramId, input.userId);

    if (input.label !== undefined) node.updateLabel(input.label);
    if (input.number !== undefined) node.updateNumber(input.number);
    if (input.kind !== undefined) node.updateKind(input.kind);
    if (input.positionX !== undefined || input.positionY !== undefined) {
      node.updatePosition(
        input.positionX ?? node.positionX,
        input.positionY ?? node.positionY,
      );
    }
    await this.repo.saveNode(node);
    return toDfdNodeOutput(node);
  }
}

export interface DeleteDfdNodeInput { userId: string; id: string; }

@Injectable()
export class DeleteDfdNodeUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: DeleteDfdNodeInput): Promise<void> {
    const node = await this.repo.findNodeById(input.id);
    if (!node) {
      throw new EntityNotFoundError('DfdNode', input.id);
    }
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, node.diagramId, input.userId);
    await this.repo.deleteNode(input.id);
  }
}
