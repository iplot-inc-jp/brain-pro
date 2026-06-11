import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateTobeRoadmapProps {
  projectId: string;
  phase?: string | null;
  measure?: string | null;
  roi?: string | null;
  cost?: string | null;
  payback?: string | null;
  scope?: string | null;
  order?: number;
  subProjectId?: string | null;
  tobeVisionId?: string | null;
}

export interface ReconstructTobeRoadmapProps {
  id: string;
  projectId: string;
  phase: string | null;
  measure: string | null;
  roi: string | null;
  cost: string | null;
  payback: string | null;
  scope: string | null;
  order: number;
  subProjectId: string | null;
  tobeVisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateTobeRoadmapProps {
  phase?: string | null;
  measure?: string | null;
  roi?: string | null;
  cost?: string | null;
  payback?: string | null;
  scope?: string | null;
  order?: number;
  subProjectId?: string | null;
  tobeVisionId?: string | null;
}

/**
 * TOBEロードマップエンティティ
 * プロジェクトのフェーズ別施策（施策・ROI・コスト・回収期間・範囲）を管理する
 */
export class TobeRoadmap extends BaseEntity {
  private readonly _projectId: string;
  private _phase: string | null;
  private _measure: string | null;
  private _roi: string | null;
  private _cost: string | null;
  private _payback: string | null;
  private _scope: string | null;
  private _order: number;
  private _subProjectId: string | null;
  private _tobeVisionId: string | null;

  private constructor(
    id: string,
    projectId: string,
    phase: string | null,
    measure: string | null,
    roi: string | null,
    cost: string | null,
    payback: string | null,
    scope: string | null,
    order: number,
    subProjectId: string | null,
    tobeVisionId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._phase = phase;
    this._measure = measure;
    this._roi = roi;
    this._cost = cost;
    this._payback = payback;
    this._scope = scope;
    this._order = order;
    this._subProjectId = subProjectId;
    this._tobeVisionId = tobeVisionId;
  }

  /**
   * 新規TOBEロードマップ作成
   */
  static create(props: CreateTobeRoadmapProps, id: string): TobeRoadmap {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const now = new Date();
    return new TobeRoadmap(
      id,
      props.projectId,
      props.phase?.trim() || null,
      props.measure?.trim() || null,
      props.roi?.trim() || null,
      props.cost?.trim() || null,
      props.payback?.trim() || null,
      props.scope?.trim() || null,
      props.order ?? 0,
      props.subProjectId ?? null,
      props.tobeVisionId ?? null,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructTobeRoadmapProps): TobeRoadmap {
    return new TobeRoadmap(
      props.id,
      props.projectId,
      props.phase,
      props.measure,
      props.roi,
      props.cost,
      props.payback,
      props.scope,
      props.order,
      props.subProjectId,
      props.tobeVisionId,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateTobeRoadmapProps): void {
    if (props.phase !== undefined) {
      this._phase = props.phase?.trim() || null;
    }
    if (props.measure !== undefined) {
      this._measure = props.measure?.trim() || null;
    }
    if (props.roi !== undefined) {
      this._roi = props.roi?.trim() || null;
    }
    if (props.cost !== undefined) {
      this._cost = props.cost?.trim() || null;
    }
    if (props.payback !== undefined) {
      this._payback = props.payback?.trim() || null;
    }
    if (props.scope !== undefined) {
      this._scope = props.scope?.trim() || null;
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    if (props.subProjectId !== undefined) {
      this._subProjectId = props.subProjectId ?? null;
    }
    if (props.tobeVisionId !== undefined) {
      this._tobeVisionId = props.tobeVisionId ?? null;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get phase(): string | null {
    return this._phase;
  }

  get measure(): string | null {
    return this._measure;
  }

  get roi(): string | null {
    return this._roi;
  }

  get cost(): string | null {
    return this._cost;
  }

  get payback(): string | null {
    return this._payback;
  }

  get scope(): string | null {
    return this._scope;
  }

  get order(): number {
    return this._order;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }

  get tobeVisionId(): string | null {
    return this._tobeVisionId;
  }
}
