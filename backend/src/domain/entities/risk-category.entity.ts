import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateRiskCategoryProps {
  projectId: string;
  name: string;
  order?: number;
}

export interface ReconstructRiskCategoryProps {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * リスクカテゴリエンティティ（PMBOK RBS: リスク・ブレークダウン・ストラクチャー）
 * プロジェクトごとに追加・改名・並べ替え可能なリスク分類マスタ。
 */
export class RiskCategory extends BaseEntity {
  private readonly _projectId: string;
  private _name: string;
  private _order: number;

  private constructor(
    id: string,
    projectId: string,
    name: string,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._name = name;
    this._order = order;
  }

  static create(props: CreateRiskCategoryProps, id: string): RiskCategory {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }
    const name = props.name?.trim();
    if (!name || name.length < 1) {
      throw new ValidationError('Risk category name is required');
    }
    if (name.length > 200) {
      throw new ValidationError('Risk category name must be at most 200 characters');
    }
    const now = new Date();
    return new RiskCategory(id, props.projectId, name, props.order ?? 0, now, now);
  }

  static reconstruct(props: ReconstructRiskCategoryProps): RiskCategory {
    return new RiskCategory(
      props.id,
      props.projectId,
      props.name,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: { name?: string; order?: number }): void {
    if (props.name !== undefined) {
      const trimmed = props.name?.trim();
      if (!trimmed || trimmed.length < 1) {
        throw new ValidationError('Risk category name is required');
      }
      if (trimmed.length > 200) {
        throw new ValidationError('Risk category name must be at most 200 characters');
      }
      this._name = trimmed;
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

  get order(): number {
    return this._order;
  }
}
