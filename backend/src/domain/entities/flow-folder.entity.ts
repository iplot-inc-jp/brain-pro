import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateFlowFolderProps {
  projectId: string;
  parentId?: string | null;
  name: string;
  order?: number;
}

export interface ReconstructFlowFolderProps {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * フローフォルダエンティティ
 * 業務フローを入れ子グルーピングするためのフォルダ
 */
export class FlowFolder extends BaseEntity {
  private readonly _projectId: string;
  private _parentId: string | null;
  private _name: string;
  private _order: number;

  private constructor(
    id: string,
    projectId: string,
    parentId: string | null,
    name: string,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._parentId = parentId;
    this._name = name;
    this._order = order;
  }

  /**
   * 新規フォルダ作成
   */
  static create(props: CreateFlowFolderProps, id: string): FlowFolder {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const name = props.name?.trim();
    if (!name || name.length < 1) {
      throw new ValidationError('Folder name is required');
    }
    if (name.length > 200) {
      throw new ValidationError('Folder name must be at most 200 characters');
    }

    const now = new Date();
    return new FlowFolder(
      id,
      props.projectId,
      props.parentId ?? null,
      name,
      props.order ?? 0,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructFlowFolderProps): FlowFolder {
    return new FlowFolder(
      props.id,
      props.projectId,
      props.parentId,
      props.name,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  rename(name: string): void {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length < 1) {
      throw new ValidationError('Folder name is required');
    }
    if (trimmed.length > 200) {
      throw new ValidationError('Folder name must be at most 200 characters');
    }
    this._name = trimmed;
    this.touch();
  }

  /** 親フォルダ・並び順を変更（移動） */
  moveTo(parentId: string | null, order?: number): void {
    if (parentId === this._id) {
      throw new ValidationError('A folder cannot be its own parent');
    }
    this._parentId = parentId ?? null;
    if (order !== undefined) {
      this._order = order;
    }
    this.touch();
  }

  changeOrder(order: number): void {
    this._order = order;
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get parentId(): string | null {
    return this._parentId;
  }

  get name(): string {
    return this._name;
  }

  get order(): number {
    return this._order;
  }
}
