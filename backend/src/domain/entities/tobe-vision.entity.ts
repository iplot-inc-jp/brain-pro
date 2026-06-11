import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateTobeVisionProps {
  projectId: string;
  area?: string | null;
  vision?: string | null;
  countermeasure?: string | null;
  effect?: string | null;
  order?: number;
  subProjectId?: string | null;
}

export interface ReconstructTobeVisionProps {
  id: string;
  projectId: string;
  area: string | null;
  vision: string | null;
  countermeasure: string | null;
  effect: string | null;
  order: number;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateTobeVisionProps {
  area?: string | null;
  vision?: string | null;
  countermeasure?: string | null;
  effect?: string | null;
  order?: number;
  subProjectId?: string | null;
}

/**
 * TOBEビジョンエンティティ
 * プロジェクトのあるべき姿（領域・ビジョン・施策・効果）を管理する
 */
export class TobeVision extends BaseEntity {
  private readonly _projectId: string;
  private _area: string | null;
  private _vision: string | null;
  private _countermeasure: string | null;
  private _effect: string | null;
  private _order: number;
  private _subProjectId: string | null;

  private constructor(
    id: string,
    projectId: string,
    area: string | null,
    vision: string | null,
    countermeasure: string | null,
    effect: string | null,
    order: number,
    subProjectId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._area = area;
    this._vision = vision;
    this._countermeasure = countermeasure;
    this._effect = effect;
    this._order = order;
    this._subProjectId = subProjectId;
  }

  /**
   * 新規TOBEビジョン作成
   */
  static create(props: CreateTobeVisionProps, id: string): TobeVision {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const now = new Date();
    return new TobeVision(
      id,
      props.projectId,
      props.area?.trim() || null,
      props.vision?.trim() || null,
      props.countermeasure?.trim() || null,
      props.effect?.trim() || null,
      props.order ?? 0,
      props.subProjectId ?? null,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructTobeVisionProps): TobeVision {
    return new TobeVision(
      props.id,
      props.projectId,
      props.area,
      props.vision,
      props.countermeasure,
      props.effect,
      props.order,
      props.subProjectId,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateTobeVisionProps): void {
    if (props.area !== undefined) {
      this._area = props.area?.trim() || null;
    }
    if (props.vision !== undefined) {
      this._vision = props.vision?.trim() || null;
    }
    if (props.countermeasure !== undefined) {
      this._countermeasure = props.countermeasure?.trim() || null;
    }
    if (props.effect !== undefined) {
      this._effect = props.effect?.trim() || null;
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

  get area(): string | null {
    return this._area;
  }

  get vision(): string | null {
    return this._vision;
  }

  get countermeasure(): string | null {
    return this._countermeasure;
  }

  get effect(): string | null {
    return this._effect;
  }

  get order(): number {
    return this._order;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }
}
