import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, EntityAlreadyExistsError, ValidationError,
  DataObjectRelation,
} from '../../../domain';
import {
  RelationCardinalityValue,
  RelationHandleValue,
  RelationPathStyleValue,
} from '../../../domain/entities/data-object-relation.entity';
import { authorizeProject } from './data-object-authz';
import { ObjectRelationOutput, toObjectRelationOutput } from './data-object.output';

/** 端点オブジェクトが存在し、同一プロジェクトに属することを検証する */
async function assertObjectInProject(
  repo: IDataObjectRepository,
  projectId: string,
  objectId: string,
): Promise<void> {
  const object = await repo.findById(objectId);
  if (!object) throw new EntityNotFoundError('DataObject', objectId);
  if (object.projectId !== projectId) {
    throw new ValidationError('Data object does not belong to this project');
  }
}

export interface CreateObjectRelationInput {
  userId: string;
  projectId: string;
  sourceObjectId: string;
  targetObjectId: string;
  cardinality?: RelationCardinalityValue;
  label?: string | null;
  description?: string | null;
  pathStyle?: RelationPathStyleValue | null;
  sourceHandle?: RelationHandleValue | null;
  targetHandle?: RelationHandleValue | null;
}

@Injectable()
export class CreateObjectRelationUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: CreateObjectRelationInput): Promise<ObjectRelationOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.userId);
    // source=target は entity 側で拒否
    const relation = DataObjectRelation.create(
      {
        projectId: input.projectId,
        sourceObjectId: input.sourceObjectId,
        targetObjectId: input.targetObjectId,
        cardinality: input.cardinality ?? 'ONE_TO_MANY',
        label: input.label ?? null,
        description: input.description ?? null,
        pathStyle: input.pathStyle ?? null,
        sourceHandle: input.sourceHandle ?? null,
        targetHandle: input.targetHandle ?? null,
      },
      this.repo.generateId(),
    );
    await assertObjectInProject(this.repo, input.projectId, input.sourceObjectId);
    await assertObjectInProject(this.repo, input.projectId, input.targetObjectId);
    // 同一端点ペア（source→target）の重複作成ガード（UIのダブルクリック等）→ 409
    const duplicate = await this.repo.findRelationByEndpoints(
      input.projectId,
      input.sourceObjectId,
      input.targetObjectId,
    );
    if (duplicate) {
      throw new EntityAlreadyExistsError(
        'DataObjectRelation',
        'endpoints',
        `${input.sourceObjectId} -> ${input.targetObjectId}`,
      );
    }
    await this.repo.saveRelation(relation);
    return toObjectRelationOutput(relation);
  }
}

export interface UpdateObjectRelationInput {
  userId: string;
  id: string;
  sourceObjectId?: string;
  targetObjectId?: string;
  cardinality?: RelationCardinalityValue;
  label?: string | null;
  description?: string | null;
  /** undefined=変更なし / null=既定の直線へ戻す */
  pathStyle?: RelationPathStyleValue | null;
  /** undefined=変更なし / null=自動アンカーへ戻す */
  sourceHandle?: RelationHandleValue | null;
  targetHandle?: RelationHandleValue | null;
}

@Injectable()
export class UpdateObjectRelationUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: UpdateObjectRelationInput): Promise<ObjectRelationOutput> {
    const relation = await this.repo.findRelationById(input.id);
    if (!relation) throw new EntityNotFoundError('DataObjectRelation', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, relation.projectId, input.userId);

    if (input.sourceObjectId !== undefined || input.targetObjectId !== undefined) {
      const sourceObjectId = input.sourceObjectId ?? relation.sourceObjectId;
      const targetObjectId = input.targetObjectId ?? relation.targetObjectId;
      await assertObjectInProject(this.repo, relation.projectId, sourceObjectId);
      await assertObjectInProject(this.repo, relation.projectId, targetObjectId);
      // source=target は entity 側で拒否
      relation.updateEndpoints(sourceObjectId, targetObjectId);
    }
    if (input.cardinality !== undefined) relation.updateCardinality(input.cardinality);
    if (input.label !== undefined) relation.updateLabel(input.label);
    if (input.description !== undefined) relation.updateDescription(input.description);
    if (input.pathStyle !== undefined) relation.updatePathStyle(input.pathStyle);
    if (input.sourceHandle !== undefined || input.targetHandle !== undefined) {
      relation.updateHandles(
        input.sourceHandle !== undefined ? input.sourceHandle : relation.sourceHandle,
        input.targetHandle !== undefined ? input.targetHandle : relation.targetHandle,
      );
    }
    await this.repo.saveRelation(relation);
    return toObjectRelationOutput(relation);
  }
}

export interface DeleteObjectRelationInput { userId: string; id: string; }

@Injectable()
export class DeleteObjectRelationUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: DeleteObjectRelationInput): Promise<void> {
    const relation = await this.repo.findRelationById(input.id);
    if (!relation) throw new EntityNotFoundError('DataObjectRelation', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, relation.projectId, input.userId);
    await this.repo.deleteRelation(input.id);
  }
}
