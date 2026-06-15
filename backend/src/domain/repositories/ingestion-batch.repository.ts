import { IngestionBatch } from '../entities';

/**
 * IngestionBatch リポジトリインターフェース
 */
export interface IIngestionBatchRepository {
  /** IDで検索 */
  findById(id: string): Promise<IngestionBatch | null>;

  /** プロジェクト内のバッチ一覧（作成日降順） */
  findByProjectId(projectId: string): Promise<IngestionBatch[]>;

  /** 保存（upsert） */
  save(batch: IngestionBatch): Promise<void>;

  /** 削除 */
  delete(id: string): Promise<void>;

  /** IDの生成 */
  generateId(): string;
}

export const INGESTION_BATCH_REPOSITORY = Symbol('INGESTION_BATCH_REPOSITORY');
