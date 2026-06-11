import { RiskCategory } from '../entities/risk-category.entity';

export const RISK_CATEGORY_REPOSITORY = Symbol('IRiskCategoryRepository');

export interface IRiskCategoryRepository {
  findById(id: string): Promise<RiskCategory | null>;
  findByProjectId(projectId: string): Promise<RiskCategory[]>;
  create(riskCategory: RiskCategory): Promise<void>;
  /**
   * まとめて作成。(projectId, name) の一意制約に衝突する行はスキップする。
   * 初期カテゴリの冪等シード（同時リクエスト競合）向け。
   */
  createManySkipDuplicates(riskCategories: RiskCategory[]): Promise<void>;
  update(riskCategory: RiskCategory): Promise<void>;
  delete(id: string): Promise<void>;
  generateId(): string;
}
