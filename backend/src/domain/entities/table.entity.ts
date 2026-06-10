import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors/domain.error';

export class Table extends BaseEntity {
  private _projectId: string;
  private _name: string;
  private _displayName: string | null;
  private _description: string | null;
  private _tags: string[];
  // 紐づく情報種別マスタ（共通マスタ基盤。任意）
  private _informationTypeId: string | null;

  constructor(props: {
    id: string;
    projectId: string;
    name: string;
    displayName?: string | null;
    description?: string | null;
    tags?: string[];
    informationTypeId?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    const now = new Date();
    super(props.id, props.createdAt ?? now, props.updatedAt ?? now);
    this._projectId = props.projectId;
    this._name = props.name;
    this._displayName = props.displayName ?? null;
    this._description = props.description ?? null;
    this._tags = props.tags ?? [];
    this._informationTypeId = props.informationTypeId ?? null;
  }

  get projectId(): string {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get displayName(): string | null {
    return this._displayName;
  }

  get description(): string | null {
    return this._description;
  }

  get tags(): string[] {
    return [...this._tags];
  }

  get informationTypeId(): string | null {
    return this._informationTypeId;
  }

  updateName(name: string): void {
    if (!name || name.length === 0) {
      throw new ValidationError('Table name is required');
    }
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      throw new ValidationError('Table name must be lowercase alphanumeric with underscores');
    }
    this._name = name;
  }

  updateDisplayName(displayName: string | null): void {
    this._displayName = displayName;
  }

  updateDescription(description: string | null): void {
    this._description = description;
  }

  // 紐づく情報種別マスタを設定/解除（共通マスタ基盤。任意）
  updateInformationTypeId(informationTypeId: string | null): void {
    this._informationTypeId = informationTypeId;
  }

  addTag(tag: string): void {
    if (!this._tags.includes(tag)) {
      this._tags.push(tag);
    }
  }

  removeTag(tag: string): void {
    this._tags = this._tags.filter((t) => t !== tag);
  }

  static create(props: {
    id: string;
    projectId: string;
    name: string;
    displayName?: string | null;
    description?: string | null;
    tags?: string[];
    informationTypeId?: string | null;
  }): Table {
    if (!props.name || props.name.length === 0) {
      throw new ValidationError('Table name is required');
    }
    return new Table(props);
  }
}

