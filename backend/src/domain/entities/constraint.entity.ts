import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateConstraintProps {
  projectId: string;
  title: string;
  description?: string | null;
  category?: string | null;
  kind?: string | null;
  order?: number;
  subProjectId?: string | null;
}

export interface ReconstructConstraintProps {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  category: string | null;
  kind: string | null;
  order: number;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 制約条件エンティティ
 * プロジェクトで考慮すべき制約条件（予算・期間・技術・法令など）を表す。
 * category で任意の分類（自由文字列）を付与できる。
 * kind で「制約条件（CONSTRAINT）」「前提条件（ASSUMPTION）」を区別する。
 */
export class Constraint extends BaseEntity {
  private readonly _projectId: string;
  private _title: string;
  private _description: string | null;
  private _category: string | null;
  private _kind: string | null;
  private _order: number;
  private _subProjectId: string | null;

  private constructor(
    id: string,
    projectId: string,
    title: string,
    description: string | null,
    category: string | null,
    kind: string | null,
    order: number,
    subProjectId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._title = title;
    this._description = description;
    this._category = category;
    this._kind = kind;
    this._order = order;
    this._subProjectId = subProjectId;
  }

  static create(props: CreateConstraintProps, id: string): Constraint {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }
    const title = props.title?.trim();
    if (!title || title.length < 1) {
      throw new ValidationError('Constraint title is required');
    }
    if (title.length > 200) {
      throw new ValidationError('Constraint title must be at most 200 characters');
    }
    const now = new Date();
    return new Constraint(
      id,
      props.projectId,
      title,
      props.description ?? null,
      props.category ?? null,
      props.kind ?? 'CONSTRAINT',
      props.order ?? 0,
      props.subProjectId ?? null,
      now,
      now,
    );
  }

  static reconstruct(props: ReconstructConstraintProps): Constraint {
    return new Constraint(
      props.id,
      props.projectId,
      props.title,
      props.description,
      props.category,
      props.kind,
      props.order,
      props.subProjectId,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: {
    title?: string;
    description?: string | null;
    category?: string | null;
    kind?: string | null;
    order?: number;
    subProjectId?: string | null;
  }): void {
    if (props.title !== undefined) {
      const trimmed = props.title?.trim();
      if (!trimmed || trimmed.length < 1) {
        throw new ValidationError('Constraint title is required');
      }
      if (trimmed.length > 200) {
        throw new ValidationError('Constraint title must be at most 200 characters');
      }
      this._title = trimmed;
    }
    if (props.description !== undefined) {
      this._description = props.description ?? null;
    }
    if (props.category !== undefined) {
      this._category = props.category ?? null;
    }
    if (props.kind !== undefined) {
      this._kind = props.kind ?? null;
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    if (props.subProjectId !== undefined) {
      this._subProjectId = props.subProjectId ?? null;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get title(): string {
    return this._title;
  }

  get description(): string | null {
    return this._description;
  }

  get category(): string | null {
    return this._category;
  }

  get kind(): string | null {
    return this._kind;
  }

  get order(): number {
    return this._order;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }
}
