import { Inject, Injectable } from '@nestjs/common';
import {
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ValidationError,
  DataObject,
} from '../../../domain';
import { authorizeProject } from './data-object-authz';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { DataObjectOutput, toDataObjectOutput } from './data-object.output';
import { DiagramCleanupService } from '../../../infrastructure/knowledge/diagram-cleanup.service';

/** 指定 subProjectId が存在し同一プロジェクトに属することを検証（null はスキップ） */
async function assertSubProjectInProject(
  repo: IDataObjectRepository,
  projectId: string,
  subProjectId: string | null | undefined,
): Promise<void> {
  if (!subProjectId) return;
  const spProjectId = await repo.findSubProjectProjectId(subProjectId);
  if (!spProjectId) throw new EntityNotFoundError('SubProject', subProjectId);
  if (spProjectId !== projectId) {
    throw new ValidationError('Sub project does not belong to this project');
  }
}

export interface CreateDataObjectInput {
  userId: string;
  projectId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  subProjectId?: string | null;
  positionX?: number;
  positionY?: number;
  order?: number;
}

@Injectable()
export class CreateDataObjectUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: CreateDataObjectInput): Promise<DataObjectOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.userId, this.projectAccess, 'edit');
    // ""（未選択 <select>）は未分類（null）として扱う。FK へ "" を書くと P2003/500
    const subProjectId = input.subProjectId || null;
    await assertSubProjectInProject(this.repo, input.projectId, subProjectId);
    const order = input.order ?? (await this.repo.nextOrder(input.projectId));
    const object = DataObject.create(
      {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? null,
        subProjectId,
        positionX: input.positionX ?? 0,
        positionY: input.positionY ?? 0,
        order,
      },
      this.repo.generateId(),
    );
    await this.repo.save(object);
    return toDataObjectOutput(object);
  }
}

export interface UpdateDataObjectInput {
  userId: string;
  id: string;
  name?: string;
  description?: string | null;
  color?: string | null;
  subProjectId?: string | null;
  order?: number;
}

@Injectable()
export class UpdateDataObjectUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateDataObjectInput): Promise<DataObjectOutput> {
    const object = await this.repo.findById(input.id);
    if (!object) throw new EntityNotFoundError('DataObject', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, object.projectId, input.userId, this.projectAccess, 'edit');

    if (input.name !== undefined) object.updateName(input.name);
    if (input.description !== undefined) object.updateDescription(input.description);
    if (input.color !== undefined) object.updateColor(input.color);
    if (input.subProjectId !== undefined) {
      // ""（未選択 <select>）は未分類（null）へ。FK へ "" を書くと P2003/500
      const subProjectId = input.subProjectId || null;
      await assertSubProjectInProject(this.repo, object.projectId, subProjectId);
      object.updateSubProject(subProjectId);
    }
    if (input.order !== undefined) object.updateOrder(input.order);
    await this.repo.save(object);
    // 単体レスポンスでも紐づく tables / dfdNodes を返す（クライアントのストア置換で参照が消えないように）
    const refs = await this.repo.findObjectRefs(object.id);
    return toDataObjectOutput(object, refs.tables, refs.dfdNodes);
  }
}

export interface UpdateDataObjectSubProjectInput {
  userId: string;
  id: string;
  /** null で未分類へ */
  subProjectId: string | null;
}

/** 領域（SubProject）への紐付け専用更新（紐付け画面・スコープ自動紐付けから使う） */
@Injectable()
export class UpdateDataObjectSubProjectUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateDataObjectSubProjectInput): Promise<DataObjectOutput> {
    const object = await this.repo.findById(input.id);
    if (!object) throw new EntityNotFoundError('DataObject', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, object.projectId, input.userId, this.projectAccess, 'edit');
    // ""（未選択 <select>）は未分類（null）へ。FK へ "" を書くと P2003/500
    const subProjectId = input.subProjectId || null;
    await assertSubProjectInProject(this.repo, object.projectId, subProjectId);
    object.updateSubProject(subProjectId);
    await this.repo.save(object);
    const refs = await this.repo.findObjectRefs(object.id);
    return toDataObjectOutput(object, refs.tables, refs.dfdNodes);
  }
}

export interface DeleteDataObjectInput { userId: string; id: string; }

@Injectable()
export class DeleteDataObjectUseCase {
  constructor(
    @Inject(DATA_OBJECT_REPOSITORY) private readonly repo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly cleanup: DiagramCleanupService,
  ) {}

  async execute(input: DeleteDataObjectInput): Promise<void> {
    const object = await this.repo.findById(input.id);
    if (!object) throw new EntityNotFoundError('DataObject', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, object.projectId, input.userId, this.projectAccess, 'edit');
    await this.repo.delete(input.id);
    await this.cleanup.cleanupNode('DATA_OBJECT', input.id);
  }
}
