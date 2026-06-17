import { Inject, Injectable } from '@nestjs/common';
import {
  DFD_REPOSITORY, IDfdRepository,
  DATA_OBJECT_REPOSITORY, IDataObjectRepository,
  PROJECT_REPOSITORY, ProjectRepository,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  EntityNotFoundError, ValidationError,
  DfdNode,
} from '../../../domain';
import { DfdNodeKindValue } from '../../../domain/entities/dfd-node.entity';
import { authorizeDiagram } from './dfd-authz';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import { DfdNodeOutput, toDfdNodeOutput } from './dfd.output';
import { DiagramCleanupService } from '../../../infrastructure/knowledge/diagram-cleanup.service';

/** dataObjectId の参照先が存在し、図と同一プロジェクトに属することを検証する */
async function assertDataObjectInProject(
  dataObjectRepo: IDataObjectRepository,
  projectId: string,
  dataObjectId: string,
): Promise<void> {
  const object = await dataObjectRepo.findById(dataObjectId);
  if (!object) throw new EntityNotFoundError('DataObject', dataObjectId);
  if (object.projectId !== projectId) {
    throw new ValidationError('Data object does not belong to this project');
  }
}

export interface AddDfdNodeInput {
  userId: string;
  diagramId: string;
  kind: DfdNodeKindValue;
  label: string;
  number?: string | null;
  refFlowId?: string | null;
  refNodeId?: string | null;
  /** DATA_STORE をデータオブジェクトマスタに紐づける（任意） */
  dataObjectId?: string | null;
  positionX?: number;
  positionY?: number;
}

@Injectable()
export class AddDfdNodeUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(DATA_OBJECT_REPOSITORY) private readonly dataObjectRepo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: AddDfdNodeInput): Promise<DfdNodeOutput> {
    const diagram = await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, input.diagramId, input.userId, this.projectAccess, 'edit');
    let dataObjectId = input.dataObjectId ?? null;
    if (dataObjectId != null) {
      await assertDataObjectInProject(this.dataObjectRepo, diagram.projectId, dataObjectId);
    } else if (input.kind === 'DATA_STORE') {
      // データストア＝オブジェクト統合: dataObjectId 未指定の DATA_STORE は
      // ラベルと同名の DataObject を get-or-create して自動リンクする
      // （並行作成の一意制約 P2002 は repo 側で吸収し勝者を返す）
      const name = input.label?.trim();
      if (name) {
        const order = await this.dataObjectRepo.nextOrder(diagram.projectId);
        const { object } = await this.dataObjectRepo.getOrCreateByName(diagram.projectId, name, order);
        dataObjectId = object.id;
      }
    }
    const node = DfdNode.create(
      {
        diagramId: input.diagramId,
        kind: input.kind,
        label: input.label,
        number: input.number ?? null,
        refFlowId: input.refFlowId ?? null,
        refNodeId: input.refNodeId ?? null,
        dataObjectId,
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
  /** DATA_STORE のデータオブジェクトマスタ紐づけ（null で解除） */
  dataObjectId?: string | null;
  positionX?: number;
  positionY?: number;
}

@Injectable()
export class UpdateDfdNodeUseCase {
  constructor(
    @Inject(DFD_REPOSITORY) private readonly repo: IDfdRepository,
    @Inject(DATA_OBJECT_REPOSITORY) private readonly dataObjectRepo: IDataObjectRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateDfdNodeInput): Promise<DfdNodeOutput> {
    const node = await this.repo.findNodeById(input.id);
    if (!node) throw new EntityNotFoundError('DfdNode', input.id);
    const diagram = await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, node.diagramId, input.userId, this.projectAccess, 'edit');
    // undefined=変更なし / null=紐づけ解除。文字列のときのみ参照先を検証する
    if (input.dataObjectId != null) {
      await assertDataObjectInProject(this.dataObjectRepo, diagram.projectId, input.dataObjectId);
    }

    // データストア＝オブジェクト統合: リンク済み DATA_STORE の label 変更は
    // 紐づく DataObject の rename として扱う。rename 先が既存オブジェクト名と
    // 衝突（@@unique projectId+name）する場合は rename せず、その既存オブジェクトへ
    // リンクを付け替える（元オブジェクトはそのまま残す）。
    const newLabel = input.label?.trim();
    const effectiveKind = input.kind ?? node.kind;
    let relinkObjectId: string | undefined;
    if (
      newLabel &&
      effectiveKind === 'DATA_STORE' &&
      input.dataObjectId === undefined &&
      node.dataObjectId != null
    ) {
      const linked = await this.dataObjectRepo.findById(node.dataObjectId);
      if (linked && linked.name !== newLabel) {
        const existing = await this.dataObjectRepo.findByName(diagram.projectId, newLabel);
        if (existing && existing.id !== linked.id) {
          relinkObjectId = existing.id;
        } else {
          linked.updateName(newLabel);
          await this.dataObjectRepo.save(linked);
        }
      }
    }

    if (input.label !== undefined) node.updateLabel(input.label);
    if (input.number !== undefined) node.updateNumber(input.number);
    if (input.kind !== undefined) node.updateKind(input.kind);
    if (input.dataObjectId !== undefined) node.updateDataObjectId(input.dataObjectId);
    else if (relinkObjectId !== undefined) node.updateDataObjectId(relinkObjectId);

    // データストア＝オブジェクト統合の不変条件: DATA_STORE は必ずオブジェクトに
    // リンクされる。明示的な null（旧UIの「未設定」）や kind 変更で外れた場合は
    // ラベルと同名のオブジェクトを get-or-create して再リンクする。
    if (node.kind === 'DATA_STORE' && node.dataObjectId == null) {
      const name = node.label.trim();
      if (name) {
        const order = await this.dataObjectRepo.nextOrder(diagram.projectId);
        const { object } = await this.dataObjectRepo.getOrCreateByName(diagram.projectId, name, order);
        node.updateDataObjectId(object.id);
      }
    }

    // 統合の不変条件②: 別オブジェクトへの差し替え（dataObjectId 明示指定）時は
    // ノード名もそのオブジェクト名に同期する（ノード名＝オブジェクト名を維持）。
    if (typeof input.dataObjectId === 'string' && node.kind === 'DATA_STORE') {
      const target = await this.dataObjectRepo.findById(input.dataObjectId);
      if (target && node.label !== target.name) node.updateLabel(target.name);
    }
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
    private readonly projectAccess: ProjectAccessService,
    private readonly cleanup: DiagramCleanupService,
  ) {}

  async execute(input: DeleteDfdNodeInput): Promise<void> {
    const node = await this.repo.findNodeById(input.id);
    if (!node) {
      throw new EntityNotFoundError('DfdNode', input.id);
    }
    await authorizeDiagram(this.repo, this.projectRepo, this.orgRepo, node.diagramId, input.userId, this.projectAccess, 'edit');
    await this.repo.deleteNode(input.id);
    await this.cleanup.cleanupNode('DFD_NODE', input.id);
  }
}
