import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type SystemKindValue = 'PERIPHERAL' | 'TARGET';

const SYSTEM_KINDS: readonly SystemKindValue[] = ['PERIPHERAL', 'TARGET'];

export interface CreateSystemProps {
  projectId: string;
  name: string;
  kind?: SystemKindValue;
  description?: string | null;
  order?: number;
  subProjectId?: string | null;
}

export interface ReconstructSystemProps {
  id: string;
  projectId: string;
  name: string;
  kind: SystemKindValue;
  description: string | null;
  order: number;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * システムエンティティ
 * プロジェクトで扱うシステム（周辺システム / 今回作る対象システム）を表す。
 * kind で PERIPHERAL（周辺）/ TARGET（対象）を区別する。
 */
export class System extends BaseEntity {
  private readonly _projectId: string;
  private _name: string;
  private _kind: SystemKindValue;
  private _description: string | null;
  private _order: number;
  private _subProjectId: string | null;

  private constructor(
    id: string,
    projectId: string,
    name: string,
    kind: SystemKindValue,
    description: string | null,
    order: number,
    subProjectId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._name = name;
    this._kind = kind;
    this._description = description;
    this._order = order;
    this._subProjectId = subProjectId;
  }

  static create(props: CreateSystemProps, id: string): System {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }
    const name = props.name?.trim();
    if (!name || name.length < 1) {
      throw new ValidationError('System name is required');
    }
    if (name.length > 200) {
      throw new ValidationError('System name must be at most 200 characters');
    }
    const kind = props.kind ?? 'PERIPHERAL';
    if (!SYSTEM_KINDS.includes(kind)) {
      throw new ValidationError('Invalid system kind');
    }
    const now = new Date();
    return new System(
      id,
      props.projectId,
      name,
      kind,
      props.description ?? null,
      props.order ?? 0,
      props.subProjectId ?? null,
      now,
      now,
    );
  }

  static reconstruct(props: ReconstructSystemProps): System {
    return new System(
      props.id,
      props.projectId,
      props.name,
      props.kind,
      props.description,
      props.order,
      props.subProjectId,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: {
    name?: string;
    kind?: SystemKindValue;
    description?: string | null;
    order?: number;
    subProjectId?: string | null;
  }): void {
    if (props.name !== undefined) {
      const trimmed = props.name?.trim();
      if (!trimmed || trimmed.length < 1) {
        throw new ValidationError('System name is required');
      }
      if (trimmed.length > 200) {
        throw new ValidationError('System name must be at most 200 characters');
      }
      this._name = trimmed;
    }
    if (props.kind !== undefined) {
      if (!SYSTEM_KINDS.includes(props.kind)) {
        throw new ValidationError('Invalid system kind');
      }
      this._kind = props.kind;
    }
    if (props.description !== undefined) {
      this._description = props.description ?? null;
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

  get name(): string {
    return this._name;
  }

  get kind(): SystemKindValue {
    return this._kind;
  }

  get description(): string | null {
    return this._description;
  }

  get order(): number {
    return this._order;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }
}
