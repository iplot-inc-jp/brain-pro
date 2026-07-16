const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ========== 型 ==========

/** バックグラウンドジョブの状態（Prisma enum BackgroundJobStatus と一致）。 */
export type JobStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/**
 * 起票可能な AI ジョブ種別。
 * バックエンド JobService.ALLOWED_TYPES と一致させる。
 *   - AI_MERMAID_OBJECTMAP … Mermaid → オブジェクト関係性マップ（parse + 永続）
 *   - AI_MERMAID_FLOW       … Mermaid → 業務フロー（parse 結果を result に返す compute）
 *   - AI_KPI                … KPI 生成（DRAFT で永続）
 *   - AI_ISSUE_SUGGEST      … 課題ノード提案（parse 結果を result に返す compute）
 */
export type JobType =
  | 'AI_MERMAID_OBJECTMAP'
  | 'AI_MERMAID_FLOW'
  | 'AI_KPI'
  | 'AI_ISSUE_SUGGEST'
  | 'AI_RAG_SUMMARIZE';

/**
 * 試行ごとの記録（BackgroundJobAttempt）。
 * batch-jobs 一覧・getJob で job.attemptRecords として新しい順（attemptNo 降順）に同梱される。
 */
export interface JobAttempt {
  id: string;
  jobId: string;
  /** 1 始まりの試行番号。 */
  attemptNo: number;
  /** 試行の状態（RUNNING / SUCCEEDED / FAILED）。 */
  status: JobStatus;
  /** 失敗時のエラーメッセージ全文。 */
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  /** 実行時間（ms）。未完了は null。 */
  durationMs: number | null;
}

/** バックグラウンドジョブ（GET /api/jobs/:id・一覧のレスポンス形）。 */
export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  /** 完了時の結果（type ごとに { kind, ... } 構造。未完了は null）。 */
  result: unknown | null;
  /** 失敗時のエラーメッセージ。 */
  error: string | null;
  /** 進捗（0〜100）。 */
  progress: number;
  /** リトライ回数（実行を試みた回数）。 */
  attempts: number;
  /** 自動リトライを含む最大試行回数。 */
  maxAttempts?: number;
  projectId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** payload は一覧/取得で返るが本文では基本未使用。 */
  payload?: Record<string, unknown> | null;
  /** 試行ごとの履歴（batch-jobs / getJob で同梱）。一覧 API では未同梱のことがある。 */
  attemptRecords?: JobAttempt[];
}

/** ジョブ起票レスポンス（POST /api/projects/:projectId/ai-jobs）。 */
export interface EnqueueJobResult {
  jobId: string;
  status: JobStatus;
}

// ========== 内部ヘルパ ==========

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
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

// ========== API ==========

/**
 * AI ジョブを起票する。POST /api/projects/:projectId/ai-jobs {type, payload}
 *
 * 本番（QStash あり）では QUEUED の {jobId, status} を即返し、実行は別プロセスで進む。
 * ローカル（QStash なし）では inline 実行され、status は SUCCEEDED/FAILED で返ることがある。
 * いずれの場合も getJob でポーリングして終端状態を待てばよい。
 */
export async function enqueueAiJob(
  projectId: string,
  type: JobType,
  payload?: Record<string, unknown>,
): Promise<EnqueueJobResult> {
  const res = await fetch(`${API_URL}/api/projects/${projectId}/ai-jobs`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ type, payload }),
  });
  if (!res.ok) {
    await throwApiError(res, 'ジョブの起票に失敗しました');
  }
  return res.json();
}

/** 単一ジョブ取得（ポーリング用）。GET /api/jobs/:id */
export async function getJob(id: string): Promise<Job> {
  const res = await fetch(`${API_URL}/api/jobs/${id}`, { headers: headers() });
  if (!res.ok) {
    await throwApiError(res, 'ジョブの取得に失敗しました');
  }
  return res.json();
}

/**
 * API エラー。HTTP ステータスを保持し、403（管理者でない）等を呼び出し側で判別できる。
 */
export class JobApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'JobApiError';
  }
}

/**
 * 【管理者】バッチジョブ一覧。GET /api/projects/:projectId/batch-jobs?status=&limit=
 *
 * 各 job に attemptRecords（試行記録）・attempts/maxAttempts を含む。
 * 非管理者は 403（JobApiError.status===403）になるため、呼び出し側で「管理者のみ」案内を出す。
 */
export async function listBatchJobs(
  projectId: string,
  opts?: { status?: JobStatus; limit?: number },
): Promise<Job[]> {
  const params = new URLSearchParams();
  if (opts?.status) params.set('status', opts.status);
  if (typeof opts?.limit === 'number' && opts.limit > 0) {
    params.set('limit', String(opts.limit));
  }
  const q = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_URL}/api/projects/${projectId}/batch-jobs${q}`, {
    headers: headers(),
  });
  if (!res.ok) {
    let msg = 'バッチジョブ一覧の取得に失敗しました';
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
    throw new JobApiError(msg, res.status);
  }
  return res.json();
}

/**
 * 【管理者】ジョブの手動リトライ。POST /api/jobs/:id/retry
 * FAILED の job を QUEUED に戻して再起票する。再起票後の job を返す。
 */
export async function retryJob(id: string): Promise<Job> {
  const res = await fetch(`${API_URL}/api/jobs/${id}/retry`, {
    method: 'POST',
    headers: headers(),
  });
  if (!res.ok) {
    let msg = 'ジョブの再実行に失敗しました';
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
    throw new JobApiError(msg, res.status);
  }
  return res.json();
}

/** プロジェクトの直近ジョブ一覧。GET /api/projects/:projectId/jobs?limit= */
export async function listJobs(projectId: string, limit?: number): Promise<Job[]> {
  const q = typeof limit === 'number' && limit > 0 ? `?limit=${limit}` : '';
  const res = await fetch(`${API_URL}/api/projects/${projectId}/jobs${q}`, {
    headers: headers(),
  });
  if (!res.ok) {
    await throwApiError(res, 'ジョブ一覧の取得に失敗しました');
  }
  return res.json();
}

/** 終端状態（これ以上ポーリング不要）か。 */
export function isTerminalStatus(status: JobStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED';
}
