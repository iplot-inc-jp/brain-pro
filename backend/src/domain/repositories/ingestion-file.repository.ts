import { IngestionFile } from '../entities';

/**
 * IngestionFile リポジトリインターフェース
 */
export interface IIngestionFileRepository {
  /** IDで検索 */
  findById(id: string): Promise<IngestionFile | null>;

  /** バッチ内のファイル一覧（作成日昇順） */
  findByBatchId(batchId: string): Promise<IngestionFile[]>;

  /** 保存（upsert） */
  save(file: IngestionFile): Promise<void>;

  /** 複数保存（バッチ作成時の一括登録） */
  saveMany(files: IngestionFile[]): Promise<void>;

  /**
   * jobId のみを部分更新する。
   * enqueue は inline 経路で processFile を同期実行し DB の status を SUCCEEDED 等へ進めるため、
   * 起票後に古い（PENDING の）エンティティを save で丸ごと書き戻すと status を巻き戻してしまう。
   * jobId だけを列更新することで、inline 実行が確定させた status を壊さない。
   */
  setJobId(id: string, jobId: string): Promise<void>;

  /** 削除 */
  delete(id: string): Promise<void>;

  /** IDの生成 */
  generateId(): string;
}

export const INGESTION_FILE_REPOSITORY = Symbol('INGESTION_FILE_REPOSITORY');
