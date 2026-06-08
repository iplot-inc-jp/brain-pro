import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type InformationCategoryValue = 'INFORMATION' | 'OBJECT' | 'DOCUMENT';

const INFORMATION_CATEGORIES: readonly InformationCategoryValue[] = [
  'INFORMATION',
  'OBJECT',
  'DOCUMENT',
];

export interface CreateInformationTypeProps {
  projectId: string;
  name: string;
  category?: InformationCategoryValue;
  description?: string | null;
  order?: number;
}

export interface ReconstructInformationTypeProps {
  id: string;
  projectId: string;
  name: string;
  category: InformationCategoryValue;
  description: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 情報種別エンティティ
 * DFDのデータフロー等が参照する情報の種別。category で 情報/物体/帳票 を区別する。
 * 具体帳票ファイルは Attachment.informationTypeId で紐づく。
 */
export class InformationType extends BaseEntity {
  private readonly _projectId: string;
  private _name: string;
  private _category: InformationCategoryValue;
  private _description: string | null;
  private _order: number;

  private constructor(
    id: string,
    projectId: string,
    name: string,
    category: InformationCategoryValue,
    description: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._name = name;
    this._category = category;
    this._description = description;
    this._order = order;
  }

  static create(props: CreateInformationTypeProps, id: string): InformationType {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }
    const name = props.name?.trim();
    if (!name || name.length < 1) {
      throw new ValidationError('Information type name is required');
    }
    if (name.length > 200) {
      throw new ValidationError('Information type name must be at most 200 characters');
    }
    const category = props.category ?? 'INFORMATION';
    if (!INFORMATION_CATEGORIES.includes(category)) {
      throw new ValidationError('Invalid information category');
    }
    const now = new Date();
    return new InformationType(
      id,
      props.projectId,
      name,
      category,
      props.description ?? null,
      props.order ?? 0,
      now,
      now,
    );
  }

  static reconstruct(props: ReconstructInformationTypeProps): InformationType {
    return new InformationType(
      props.id,
      props.projectId,
      props.name,
      props.category,
      props.description,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: {
    name?: string;
    category?: InformationCategoryValue;
    description?: string | null;
    order?: number;
  }): void {
    if (props.name !== undefined) {
      const trimmed = props.name?.trim();
      if (!trimmed || trimmed.length < 1) {
        throw new ValidationError('Information type name is required');
      }
      if (trimmed.length > 200) {
        throw new ValidationError('Information type name must be at most 200 characters');
      }
      this._name = trimmed;
    }
    if (props.category !== undefined) {
      if (!INFORMATION_CATEGORIES.includes(props.category)) {
        throw new ValidationError('Invalid information category');
      }
      this._category = props.category;
    }
    if (props.description !== undefined) {
      this._description = props.description ?? null;
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get category(): InformationCategoryValue {
    return this._category;
  }

  get description(): string | null {
    return this._description;
  }

  get order(): number {
    return this._order;
  }
}
