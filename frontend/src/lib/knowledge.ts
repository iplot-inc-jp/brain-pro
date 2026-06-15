// ナレッジグラフ バッチ取り込み の型・API クライアント。
//
// バックエンド（spec §9。グローバル prefix `api`）:
//   取り込み:
//     POST   /api/projects/:id/ingestion-batches        {name?, options?, files} → IngestionBatch
//     GET    /api/projects/:id/ingestion-batches        → IngestionBatch[]
//     GET    /api/ingestion-batches/:id                 → IngestionBatchDetail（files 込み）
//     POST   /api/ingestion-batches/:id/resume          → IngestionBatch
//     POST   /api/ingestion-batches/:id/cancel          → IngestionBatch
//     DELETE /api/ingestion-batches/:id                 → { success }
//     POST   /api/ingestion-files/:id/retry             → IngestionFile
//     POST   /api/ingestion-files/:id/skip              → IngestionFile
//   アップロード:
//     POST   /api/projects/:id/ingestion-uploads        （multipart 複数, field 'files'）→ { uploads: IngestionUploadResult[] }
//   選択可能な既存添付:
//     GET    /api/projects/:id/ingestion-sources/attachments → SelectableAttachment[]
//   グラフ:
//     GET    /api/projects/:id/knowledge/graph          → KnowledgeGraph
//     GET    /api/projects/:id/knowledge/search?q=      → KnowledgeSearchResult
//   設定:
//     GET    /api/projects/:id/knowledge/settings       → ProjectKnowledgeSettings（get-or-create 既定）
//     PUT    /api/projects/:id/knowledge/settings       → ProjectKnowledgeSettings
//
// raw fetch + localStorage 'accessToken'（既存 lib 慣習。src/lib/api.ts は使わない）。

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** 取り込みバッチ（親）の状態（Prisma enum IngestionBatchStatus と一致）。 */
export type IngestionBatchStatus =
  | 'PENDING'
  | 'EXPANDING'
  | 'RUNNING'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

/** 取り込みファイル（子）の状態（Prisma enum IngestionFileStatus と一致）。 */
export type IngestionFileStatus =
  | 'PENDING'
  | 'FETCHING'
  | 'EXPANDING'
  | 'PREPROCESSING'
  | 'EXTRACTING'
  | 'MERGING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

/** ファイル取得元（Prisma enum IngestionSourceType と一致）。 */
export type IngestionSourceType = 'UPLOAD' | 'ATTACHMENT' | 'DRIVE';

/** バッチ単位の抽出オプション（プロジェクト設定をバッチ単位に上書きする）。 */
export interface IngestionBatchOptions {
  /** Claude による 要約/タグ/実体/関係 抽出（$）。 */
  aiExtractionEnabled?: boolean;
  /** 画像/スキャンPDF を vision/document で読む（$$）。 */
  ocrEnabled?: boolean;
  /** 抽出に使うモデル（未指定はサーバ既定）。 */
  model?: string;
  /** Office→画像化の方針。auto | always | never。 */
  imagingMode?: string;
}

/** 取り込みバッチ（親。一覧/作成のレスポンス形）。 */
export interface IngestionBatch {
  id: string;
  projectId: string;
  name: string;
  status: IngestionBatchStatus;
  totalFiles: number;
  succeededFiles: number;
  failedFiles: number;
  pendingFiles: number;
  options: IngestionBatchOptions | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** 取り込みファイル（子。バッチ詳細の files として返る）。 */
export interface IngestionFile {
  id: string;
  batchId: string;
  projectId: string;
  sourceType: IngestionSourceType;
  sourceRef: string | null;
  filename: string;
  displayName: string | null;
  mimeType: string | null;
  size: number | null;
  blobUrl: string | null;
  /** ZIP 等のコンテナ（展開専用、グラフには載らない）。 */
  isArchive: boolean;
  /** どのアーカイブから展開されたか（ZIP 内エントリ）。 */
  parentFileId: string | null;
  status: IngestionFileStatus;
  /** 現在ステップの人間可読ラベル。 */
  step: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  jobId: string | null;
  knowledgeDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** バッチ詳細（files 込み）。 */
export interface IngestionBatchDetail extends IngestionBatch {
  files: IngestionFile[];
}

/** バッチ作成時に指定するソース（contract: files[] の 1 エントリ）。 */
export type IngestionBatchSource =
  /** アップロード済み（ingestion-uploads で Blob 保存済み）。 */
  | {
      sourceType: 'UPLOAD';
      filename: string;
      blobUrl: string;
      mimeType?: string;
      size?: number;
      isArchive?: boolean;
    }
  /** 既存 Attachment を素材にする。 */
  | {
      sourceType: 'ATTACHMENT';
      sourceRef: string; // attachmentId
      filename: string;
      mimeType?: string;
      size?: number;
    }
  /** Google Drive ファイル（Phase 3）。 */
  | {
      sourceType: 'DRIVE';
      sourceRef: string; // driveFileId
      filename: string;
      mimeType?: string;
      size?: number;
    };

/** バッチ作成リクエスト（contract: { name?, options?, files }）。 */
export interface CreateBatchInput {
  name?: string;
  options?: IngestionBatchOptions;
  files: IngestionBatchSource[];
}

/**
 * ingestion-uploads（multipart）の 1 ファイル分のレスポンス。
 * contract: { filename; blobUrl; mimeType; size }（isArchive はサーバ任意）。
 */
export interface IngestionUploadResult {
  filename: string;
  blobUrl: string;
  mimeType: string;
  size: number;
  /** サーバが返す場合のみ。無ければ isArchiveFile() で判定する。 */
  isArchive?: boolean;
}

/** ingestion-uploads のレスポンス本体（contract: { uploads: [...] }）。 */
export interface IngestionUploadResponse {
  uploads: IngestionUploadResult[];
}

/** プロジェクト設定（課金ガード。get-or-create 既定）。 */
export interface ProjectKnowledgeSettings {
  id: string;
  projectId: string;
  aiExtractionEnabled: boolean;
  ocrEnabled: boolean;
  defaultModel: string | null;
  /** auto | always | never。 */
  imagingMode: string;
  maxFilesPerBatch: number;
  createdAt: string;
  updatedAt: string;
}

/** 設定更新リクエスト（部分更新）。 */
export interface UpdateSettingsInput {
  aiExtractionEnabled?: boolean;
  ocrEnabled?: boolean;
  defaultModel?: string | null;
  imagingMode?: string;
  maxFilesPerBatch?: number;
}

/** ナレッジグラフのノード種別（Prisma enum KnowledgeNodeType と一致）。 */
export type KnowledgeNodeType = 'TAG' | 'ENTITY';

/** グラフのノード（タグ / 実体）。 */
export interface KnowledgeNode {
  id: string;
  projectId: string;
  type: KnowledgeNodeType;
  entityKind: string | null;
  label: string;
  normalizedLabel: string;
  description: string | null;
  color: string | null;
  mentionCount: number;
  positionX: number | null;
  positionY: number | null;
  createdAt: string;
  updatedAt: string;
}

/** グラフのエッジ（ノード ↔ ノード）。 */
export interface KnowledgeRelation {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  type: string | null;
  confidence: number | null;
  sourceDocumentId: string | null;
  createdAt: string;
}

/** グラフの文書ノード。 */
export interface KnowledgeDocument {
  id: string;
  projectId: string;
  ingestionFileId: string | null;
  title: string;
  summary: string | null;
  sourceType: IngestionSourceType;
  sourceRef: string | null;
  blobUrl: string | null;
  mimeType: string | null;
  positionX: number | null;
  positionY: number | null;
  createdAt: string;
  updatedAt: string;
}

/** グラフ全体（nodes + edges + documents）。 */
export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  relations: KnowledgeRelation[];
  documents: KnowledgeDocument[];
}

/** 検索結果（ラベル一致のノード＋関連文書）。 */
export interface KnowledgeSearchResult {
  nodes: KnowledgeNode[];
  documents: KnowledgeDocument[];
}

// ---------------------------------------------------------------------------
// 内部ヘルパ
// ---------------------------------------------------------------------------

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

/** multipart 用（Content-Type は付けず、Authorization のみ）。 */
function authHeaderOnly(): Record<string, string> {
  const h: Record<string, string> = {};
  const t =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

/** バックエンドの分かりやすいエラーメッセージを優先して投げる。 */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  let msg = fallback;
  try {
    const data = await res.json();
    if (data?.message) {
      msg = Array.isArray(data.message) ? data.message.join(' / ') : data.message;
    } else if (data?.error) {
      msg = data.error;
    }
  } catch {
    /* JSON でなければ既定メッセージ */
  }
  throw new Error(msg);
}

async function ok<T>(res: Response, errMsg: string): Promise<T> {
  if (!res.ok) await throwApiError(res, errMsg);
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// 取り込み（Ingestion）API
// ---------------------------------------------------------------------------

export const ingestionApi = {
  /** バッチ一覧。GET /api/projects/:id/ingestion-batches */
  async listBatches(projectId: string): Promise<IngestionBatch[]> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/ingestion-batches`,
      { headers: headers() },
    );
    return ok<IngestionBatch[]>(res, 'バッチ一覧の取得に失敗しました');
  },

  /** バッチ作成＆ジョブ投入。POST /api/projects/:id/ingestion-batches */
  async createBatch(
    projectId: string,
    input: CreateBatchInput,
  ): Promise<IngestionBatch> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/ingestion-batches`,
      { method: 'POST', headers: headers(), body: JSON.stringify(input) },
    );
    return ok<IngestionBatch>(res, 'バッチの作成に失敗しました');
  },

  /** バッチ詳細（files 込み）。GET /api/ingestion-batches/:id */
  async getBatch(batchId: string): Promise<IngestionBatchDetail> {
    const res = await fetch(`${API_URL}/api/ingestion-batches/${batchId}`, {
      headers: headers(),
    });
    return ok<IngestionBatchDetail>(res, 'バッチ詳細の取得に失敗しました');
  },

  /** 未処理・失敗・stale を再投入。POST /api/ingestion-batches/:id/resume */
  async resumeBatch(batchId: string): Promise<IngestionBatch> {
    const res = await fetch(
      `${API_URL}/api/ingestion-batches/${batchId}/resume`,
      { method: 'POST', headers: headers() },
    );
    return ok<IngestionBatch>(res, 'バッチの再開に失敗しました');
  },

  /** バッチをキャンセル（未実行を SKIPPED）。POST /api/ingestion-batches/:id/cancel */
  async cancelBatch(batchId: string): Promise<IngestionBatch> {
    const res = await fetch(
      `${API_URL}/api/ingestion-batches/${batchId}/cancel`,
      { method: 'POST', headers: headers() },
    );
    return ok<IngestionBatch>(res, 'バッチのキャンセルに失敗しました');
  },

  /** バッチ削除。DELETE /api/ingestion-batches/:id */
  async deleteBatch(batchId: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_URL}/api/ingestion-batches/${batchId}`, {
      method: 'DELETE',
      headers: headers(),
    });
    return ok<{ success: boolean }>(res, 'バッチの削除に失敗しました');
  },

  /** 個別ファイルをリトライ。POST /api/ingestion-files/:id/retry */
  async retryFile(fileId: string): Promise<IngestionFile> {
    const res = await fetch(`${API_URL}/api/ingestion-files/${fileId}/retry`, {
      method: 'POST',
      headers: headers(),
    });
    return ok<IngestionFile>(res, 'ファイルの再試行に失敗しました');
  },

  /** 個別ファイルをスキップ。POST /api/ingestion-files/:id/skip */
  async skipFile(fileId: string): Promise<IngestionFile> {
    const res = await fetch(`${API_URL}/api/ingestion-files/${fileId}/skip`, {
      method: 'POST',
      headers: headers(),
    });
    return ok<IngestionFile>(res, 'ファイルのスキップに失敗しました');
  },

  /**
   * ファイルを multipart アップロード（複数可・ZIP 可）→ Blob 保存して候補を返す。
   * POST /api/projects/:id/ingestion-uploads（field 名 'files' を複数 append）
   * contract レスポンス: { uploads: IngestionUploadResult[] }
   */
  async upload(
    projectId: string,
    files: File[],
  ): Promise<IngestionUploadResult[]> {
    const form = new FormData();
    for (const f of files) form.append('files', f);
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/ingestion-uploads`,
      { method: 'POST', headers: authHeaderOnly(), body: form },
    );
    const data = await ok<IngestionUploadResponse>(
      res,
      'ファイルのアップロードに失敗しました',
    );
    return data.uploads;
  },
};

// ---------------------------------------------------------------------------
// 既存添付（Attachment）一覧 — 取り込み素材の選択に使う
// ---------------------------------------------------------------------------

/**
 * 取り込み素材として選択できる既存添付ファイル。
 * contract: { id; filename; displayName?; mimeType?; size?; kind }
 */
export interface SelectableAttachment {
  id: string;
  filename: string;
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  kind: string;
}

/**
 * 取り込み素材として選択できる既存添付一覧（NewBatchDialog の「既存添付から選択」用）。
 * GET /api/projects/:id/ingestion-sources/attachments
 */
export async function listSelectableAttachments(
  projectId: string,
): Promise<SelectableAttachment[]> {
  const res = await fetch(
    `${API_URL}/api/projects/${projectId}/ingestion-sources/attachments`,
    { headers: headers() },
  );
  return ok<SelectableAttachment[]>(res, '既存添付一覧の取得に失敗しました');
}

// ---------------------------------------------------------------------------
// 設定（課金ガード）API
// ---------------------------------------------------------------------------

export const knowledgeSettingsApi = {
  /** 設定取得（get-or-create 既定）。GET /api/projects/:id/knowledge/settings */
  async get(projectId: string): Promise<ProjectKnowledgeSettings> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/knowledge/settings`,
      { headers: headers() },
    );
    return ok<ProjectKnowledgeSettings>(res, 'ナレッジ設定の取得に失敗しました');
  },

  /** 設定更新。PUT /api/projects/:id/knowledge/settings */
  async update(
    projectId: string,
    input: UpdateSettingsInput,
  ): Promise<ProjectKnowledgeSettings> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/knowledge/settings`,
      { method: 'PUT', headers: headers(), body: JSON.stringify(input) },
    );
    return ok<ProjectKnowledgeSettings>(res, 'ナレッジ設定の保存に失敗しました');
  },
};

// ---------------------------------------------------------------------------
// グラフ（Knowledge Graph）API — Phase 2 のページで利用
// ---------------------------------------------------------------------------

export const knowledgeGraphApi = {
  /** グラフ全体（nodes+edges+documents）。GET /api/projects/:id/knowledge/graph */
  async getGraph(projectId: string): Promise<KnowledgeGraph> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/knowledge/graph`,
      { headers: headers() },
    );
    return ok<KnowledgeGraph>(res, 'ナレッジグラフの取得に失敗しました');
  },

  /** ラベル検索。GET /api/projects/:id/knowledge/search?q= */
  async search(
    projectId: string,
    q: string,
  ): Promise<KnowledgeSearchResult> {
    const params = new URLSearchParams({ q });
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/knowledge/search?${params.toString()}`,
      { headers: headers() },
    );
    return ok<KnowledgeSearchResult>(res, 'ナレッジ検索に失敗しました');
  },
};

// ---------------------------------------------------------------------------
// 表示用ユーティリティ（純粋・副作用なし）
// ---------------------------------------------------------------------------

/** バッチ状態の日本語ラベル。 */
export const BATCH_STATUS_LABEL: Record<IngestionBatchStatus, string> = {
  PENDING: '待機中',
  EXPANDING: '展開中',
  RUNNING: '実行中',
  PARTIAL: '一部失敗',
  SUCCEEDED: '完了',
  FAILED: '失敗',
  CANCELLED: 'キャンセル',
};

/** ファイル状態の日本語ラベル。 */
export const FILE_STATUS_LABEL: Record<IngestionFileStatus, string> = {
  PENDING: '待機中',
  FETCHING: '取得中',
  EXPANDING: '展開中',
  PREPROCESSING: '前処理中',
  EXTRACTING: '抽出中',
  MERGING: 'マージ中',
  SUCCEEDED: '完了',
  FAILED: '失敗',
  SKIPPED: 'スキップ',
};

/** ファイル状態が終端（これ以上ポーリング不要かどうかの判定に使う）。 */
export function isFileTerminal(status: IngestionFileStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'SKIPPED';
}

/** バッチ状態が終端（ポーリング停止の判定）。 */
export function isBatchTerminal(status: IngestionBatchStatus): boolean {
  return (
    status === 'SUCCEEDED' ||
    status === 'FAILED' ||
    status === 'PARTIAL' ||
    status === 'CANCELLED'
  );
}

/** バイト数を人間可読に（B/KB/MB）。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** mime/拡張子からアーカイブ（ZIP）か判定。 */
export function isArchiveFile(filename: string, mimeType?: string): boolean {
  const m = (mimeType || '').toLowerCase();
  if (m.includes('zip')) return true;
  return /\.zip$/i.test(filename);
}
