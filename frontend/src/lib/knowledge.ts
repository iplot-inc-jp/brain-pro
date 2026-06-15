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
//     GET    /api/projects/:id/knowledge/graph          → KnowledgeGraph（nodes + edges + documents）
//     GET    /api/projects/:id/knowledge/search?q=      → KnowledgeSearchResult
//   設定:
//     GET    /api/projects/:id/knowledge/settings       → ProjectKnowledgeSettings（get-or-create 既定）
//     PUT    /api/projects/:id/knowledge/settings       → ProjectKnowledgeSettings
//   Google Drive（Phase 3。driveEnabled でない＝401/未設定 のときは UI で「未設定」表示）:
//     GET    /api/projects/:id/drive/auth-url           → { authUrl }（未接続→新規ウィンドウで OAuth）
//     GET    /api/projects/:id/drive/files?folderId=    → { connected, email?, files: DriveFile[] }
//     DELETE /api/projects/:id/drive/connection         → { success }
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

/**
 * グラフのエッジ（ノード ↔ ノード）。
 * backend KnowledgeEdgeOutput と一致（graph API は `edges` で返す。`createdAt` は含まない）。
 */
export interface KnowledgeEdge {
  id: string;
  projectId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  type: string | null;
  confidence: number | null;
  sourceDocumentId: string | null;
}

/**
 * @deprecated `KnowledgeEdge` を使う。graph API のエッジは `edges` 名・`createdAt` なし。
 * canvas 等の旧コードが `createdAt` を補完して渡す経路があるため任意フィールドとして残す。
 */
export type KnowledgeRelation = KnowledgeEdge & { createdAt?: string };

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

/** グラフ全体（nodes + edges + documents）。backend KnowledgeGraphOutput と一致。 */
export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  documents: KnowledgeDocument[];
}

/** 検索結果（ラベル一致のノード＋関連文書）。 */
export interface KnowledgeSearchResult {
  nodes: KnowledgeNode[];
  documents: KnowledgeDocument[];
}

// ---------------------------------------------------------------------------
// Google Drive（Phase 3）型
// ---------------------------------------------------------------------------

/** Drive 認証 URL（未接続のとき新規ウィンドウで開く）。 */
export interface DriveAuthUrl {
  authUrl: string;
}

/** Drive のファイル/フォルダ 1 件（files.list 由来。folder は再帰のため）。 */
export interface DriveFile {
  /** driveFileId。バッチ作成の sourceRef に使う。 */
  id: string;
  name: string;
  mimeType?: string | null;
  /** Drive はフォルダも mimeType で表すが、利便のため明示フラグも受ける。 */
  isFolder?: boolean;
  size?: number | null;
  modifiedTime?: string | null;
  iconLink?: string | null;
}

/**
 * Drive ファイル一覧レスポンス。
 * - connected=false: 未接続（getAuthUrl→認証が必要）。
 * - email: 接続済みアカウント（任意表示）。
 */
export interface DriveFileList {
  connected: boolean;
  email?: string | null;
  files: DriveFile[];
}

/**
 * Drive 機能が未設定/未許可（401 や 404、env 未設定）を表す番兵エラー。
 * これを catch した UI は「未設定」表示にして他タブを使えるままにする。
 */
export class DriveNotConfiguredError extends Error {
  constructor(message = 'Google Drive 連携は未設定です') {
    super(message);
    this.name = 'DriveNotConfiguredError';
  }
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
  /** グラフ全体（nodes + edges + documents）。GET /api/projects/:id/knowledge/graph */
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
// Google Drive（Phase 3）API
// ---------------------------------------------------------------------------

/**
 * Drive 機能が未設定/未許可とみなす HTTP ステータス:
 *   401（未認証）/ 403（権限なし）/ 404（ルート/接続なし）/
 *   501（未実装）/ 503（連携サービス未設定・未起動）。
 * UI はこれを catch して「未設定」表示にし、他タブは使えるままにする。
 */
function isDriveNotConfigured(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 501 ||
    status === 503
  );
}

export const driveApi = {
  /**
   * 認証 URL を取得（未接続のとき新規ウィンドウで開いて OAuth）。
   * GET /api/projects/:id/drive/auth-url
   */
  async getAuthUrl(projectId: string): Promise<DriveAuthUrl> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/drive/auth-url`,
      { headers: headers() },
    );
    if (!res.ok) {
      if (isDriveNotConfigured(res.status)) throw new DriveNotConfiguredError();
      await throwApiError(res, 'Drive 認証 URL の取得に失敗しました');
    }
    return res.json() as Promise<DriveAuthUrl>;
  },

  /**
   * 接続済みなら Drive のファイル一覧。folderId 指定でそのフォルダ配下。
   * GET /api/projects/:id/drive/files?folderId=（backend は @Query('folderId')）
   */
  async listFiles(projectId: string, folderId?: string): Promise<DriveFileList> {
    const params = new URLSearchParams();
    if (folderId) params.set('folderId', folderId);
    const qs = params.toString();
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/drive/files${qs ? `?${qs}` : ''}`,
      { headers: headers() },
    );
    if (!res.ok) {
      if (isDriveNotConfigured(res.status)) throw new DriveNotConfiguredError();
      await throwApiError(res, 'Drive ファイル一覧の取得に失敗しました');
    }
    return res.json() as Promise<DriveFileList>;
  },

  /**
   * Drive 接続を解除（refresh token 破棄）。
   * DELETE /api/projects/:id/drive/connection
   */
  async deleteConnection(projectId: string): Promise<{ success: boolean }> {
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/drive/connection`,
      { method: 'DELETE', headers: headers() },
    );
    if (!res.ok) {
      if (isDriveNotConfigured(res.status)) throw new DriveNotConfiguredError();
      await throwApiError(res, 'Drive 接続の解除に失敗しました');
    }
    return res.json() as Promise<{ success: boolean }>;
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

// ---------------------------------------------------------------------------
// 一覧編集（ナレッジグラフ要素の編集）API — Phase 2 一覧編集ページで利用
//
// 編集系エンドポイント（すべて assertProjectAccess(edit)。グローバル prefix `api`）:
//   ノード:
//     PATCH  /api/knowledge-nodes/:id        部分更新（label/description/color/entityKind/type/position）
//     POST   /api/knowledge-nodes/:id/merge  { targetNodeId } → 統合先ノードを返す
//     DELETE /api/knowledge-nodes/:id        → { success }
//   文書:
//     PATCH  /api/knowledge-documents/:id     { title?, summary? }
//     DELETE /api/knowledge-documents/:id     → { success }
//   関係:
//     PATCH  /api/knowledge-relations/:id     { label?, type? }
//     DELETE /api/knowledge-relations/:id     → { success }
// ---------------------------------------------------------------------------

/** ノード更新リクエスト（部分更新）。 */
export interface UpdateKnowledgeNodeInput {
  label?: string;
  description?: string | null;
  color?: string | null;
  entityKind?: string | null;
  type?: KnowledgeNodeType;
  positionX?: number | null;
  positionY?: number | null;
}

/** 文書更新リクエスト（部分更新）。 */
export interface UpdateKnowledgeDocumentInput {
  title?: string;
  summary?: string | null;
}

/** 関係更新リクエスト（部分更新）。 */
export interface UpdateKnowledgeRelationInput {
  label?: string | null;
  type?: string | null;
}

export const knowledgeEditApi = {
  /**
   * ノード更新（label/description/color/entityKind/type/position の部分更新）。
   * PATCH /api/knowledge-nodes/:id
   */
  async updateNode(
    id: string,
    input: UpdateKnowledgeNodeInput,
  ): Promise<KnowledgeNode> {
    const res = await fetch(`${API_URL}/api/knowledge-nodes/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return ok<KnowledgeNode>(res, 'ノードの更新に失敗しました');
  },

  /**
   * ノードを別ノードへ統合（mentions/relations を付け替え、:id を削除）。
   * POST /api/knowledge-nodes/:id/merge  body { targetNodeId }
   * 統合先（target）ノードを返す。
   */
  async mergeNodes(id: string, targetNodeId: string): Promise<KnowledgeNode> {
    const res = await fetch(`${API_URL}/api/knowledge-nodes/${id}/merge`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ targetNodeId }),
    });
    return ok<KnowledgeNode>(res, 'ノードの統合に失敗しました');
  },

  /** ノード削除。DELETE /api/knowledge-nodes/:id */
  async deleteNode(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_URL}/api/knowledge-nodes/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    return ok<{ success: boolean }>(res, 'ノードの削除に失敗しました');
  },

  /** 文書更新（title/summary）。PATCH /api/knowledge-documents/:id */
  async updateDocument(
    id: string,
    input: UpdateKnowledgeDocumentInput,
  ): Promise<KnowledgeDocument> {
    const res = await fetch(`${API_URL}/api/knowledge-documents/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return ok<KnowledgeDocument>(res, '文書の更新に失敗しました');
  },

  /** 文書削除（文書＋mentions を削除、関連ノードの mentionCount 再計算）。DELETE /api/knowledge-documents/:id */
  async deleteDocument(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_URL}/api/knowledge-documents/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    return ok<{ success: boolean }>(res, '文書の削除に失敗しました');
  },

  /** 関係更新（label/type）。PATCH /api/knowledge-relations/:id */
  async updateRelation(
    id: string,
    input: UpdateKnowledgeRelationInput,
  ): Promise<KnowledgeEdge> {
    const res = await fetch(`${API_URL}/api/knowledge-relations/${id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(input),
    });
    return ok<KnowledgeEdge>(res, '関係の更新に失敗しました');
  },

  /** 関係削除。DELETE /api/knowledge-relations/:id */
  async deleteRelation(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`${API_URL}/api/knowledge-relations/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    return ok<{ success: boolean }>(res, '関係の削除に失敗しました');
  },
};

/**
 * 個別 export のショートハンド（タスク指定の関数名で直接呼びたい場合に流用）。
 * いずれも knowledgeEditApi の薄いラッパ。
 */
export const updateNode = knowledgeEditApi.updateNode;
export const mergeNodes = knowledgeEditApi.mergeNodes;
export const deleteNode = knowledgeEditApi.deleteNode;
export const updateDocument = knowledgeEditApi.updateDocument;
export const deleteDocument = knowledgeEditApi.deleteDocument;
export const updateRelation = knowledgeEditApi.updateRelation;
export const deleteRelation = knowledgeEditApi.deleteRelation;
