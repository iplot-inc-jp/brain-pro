import { InterestMatrixRow } from '../entities';

/**
 * InterestMatrixRow リポジトリインターフェース
 */
export interface IInterestMatrixRowRepository {
  /**
   * IDで検索
   */
  findById(id: string): Promise<InterestMatrixRow | null>;

  /**
   * プロジェクト内の関心ごとマトリクス行一覧（order昇順）
   */
  findByProjectId(projectId: string): Promise<InterestMatrixRow[]>;

  /**
   * 保存
   */
  save(row: InterestMatrixRow): Promise<void>;

  /**
   * 削除
   */
  delete(id: string): Promise<void>;

  /**
   * IDの生成
   */
  generateId(): string;
}

export const INTEREST_MATRIX_ROW_REPOSITORY = Symbol(
  'INTEREST_MATRIX_ROW_REPOSITORY',
);
