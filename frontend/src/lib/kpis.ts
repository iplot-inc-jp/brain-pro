// KPI（業務KPI・AI精度KPI）の API クライアント。
// fetch 作法・headers()・エラーメッセージは dfd.ts の informationTypeApi / data-objects.ts を踏襲する。

import { enqueueAiJob, getJob, isTerminalStatus } from '@/lib/jobs';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ========== 型 ==========

/** KPI区分: 業務KPI / AI精度KPI */
export type KpiCategory = 'BUSINESS' | 'AI_QUALITY';
/** 望ましい方向: 増やす / 減らす / 維持 */
export type KpiDirection = 'INCREASE' | 'DECREASE' | 'MAINTAIN';
/** 測定頻度 */
export type KpiFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
/** ステータス: 下書き（AI生成直後）/ 運用中 / アーカイブ */
export type KpiStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export const KPI_CATEGORY_LABELS: Record<KpiCategory, string> = {
  BUSINESS: '業務KPI',
  AI_QUALITY: 'AI精度指標',
};

export const KPI_CATEGORY_OPTIONS: ReadonlyArray<{ value: KpiCategory; label: string }> = [
  { value: 'BUSINESS', label: '業務KPI' },
  { value: 'AI_QUALITY', label: 'AI精度指標' },
];

export const KPI_DIRECTION_LABELS: Record<KpiDirection, string> = {
  INCREASE: '増やす',
  DECREASE: '減らす',
  MAINTAIN: '維持',
};

export const KPI_DIRECTION_OPTIONS: ReadonlyArray<{ value: KpiDirection; label: string }> = [
  { value: 'INCREASE', label: '増やす' },
  { value: 'DECREASE', label: '減らす' },
  { value: 'MAINTAIN', label: '維持' },
];

export const KPI_FREQUENCY_LABELS: Record<KpiFrequency, string> = {
  DAILY: '日次',
  WEEKLY: '週次',
  MONTHLY: '月次',
  QUARTERLY: '四半期',
};

export const KPI_FREQUENCY_OPTIONS: ReadonlyArray<{ value: KpiFrequency; label: string }> = [
  { value: 'DAILY', label: '日次' },
  { value: 'WEEKLY', label: '週次' },
  { value: 'MONTHLY', label: '月次' },
  { value: 'QUARTERLY', label: '四半期' },
];

export const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  DRAFT: '下書き',
  ACTIVE: '運用中',
  ARCHIVED: 'アーカイブ',
};

export const KPI_STATUS_OPTIONS: ReadonlyArray<{ value: KpiStatus; label: string }> = [
  { value: 'DRAFT', label: '下書き' },
  { value: 'ACTIVE', label: '運用中' },
  { value: 'ARCHIVED', label: 'アーカイブ' },
];

/** KPIに紐づく情報種別の参照（category は dfd.ts の InformationCategory と同じ: INFORMATION | OBJECT | DOCUMENT） */
export interface KpiInformationTypeRefDto {
  id: string;
  name: string;
  category: string;
}

export interface KpiDto {
  id: string;
  projectId: string;
  category: KpiCategory;
  flowId: string | null;
  /** ASIS業務フロー（任意） */
  asisFlowId: string | null;
  /** TOBE業務フロー（任意） */
  tobeFlowId: string | null;
  systemId: string | null;
  name: string;
  description: string | null;
  /** 計算式・定義（例: 欠品率 = 欠品件数 / 発注明細数） */
  definition: string | null;
  unit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
  direction: KpiDirection;
  frequency: KpiFrequency;
  /** 測定方法・データソースの説明 */
  measurementMethod: string | null;
  ownerRoleId: string | null;
  /** SMART採点（0〜5） */
  smartSpecific: number | null;
  smartMeasurable: number | null;
  smartAchievable: number | null;
  smartRelevant: number | null;
  smartTimeBound: number | null;
  smartComment: string | null;
  aiGenerated: boolean;
  status: KpiStatus;
  order: number;
  /** 測定対象の情報種別 */
  informationTypes: KpiInformationTypeRefDto[];
  /** 対象業務フロー名（解決済み） */
  flowName: string | null;
  /** ASIS業務フロー名（解決済み） */
  asisFlowName: string | null;
  /** TOBE業務フロー名（解決済み） */
  tobeFlowName: string | null;
  /** 対象システム名（解決済み） */
  systemName: string | null;
  /** 責任者ロール名（解決済み） */
  ownerRoleName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** KPI作成/更新の編集可能フィールド */
export interface KpiUpsertBody {
  name?: string;
  category?: KpiCategory;
  flowId?: string | null;
  asisFlowId?: string | null;
  tobeFlowId?: string | null;
  systemId?: string | null;
  description?: string | null;
  definition?: string | null;
  unit?: string | null;
  baselineValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  direction?: KpiDirection;
  frequency?: KpiFrequency;
  measurementMethod?: string | null;
  ownerRoleId?: string | null;
  smartSpecific?: number | null;
  smartMeasurable?: number | null;
  smartAchievable?: number | null;
  smartRelevant?: number | null;
  smartTimeBound?: number | null;
  smartComment?: string | null;
  status?: KpiStatus;
  order?: number;
}

/** KPI一覧の任意フィルタ */
export interface KpiListFilter {
  category?: KpiCategory;
  flowId?: string;
  systemId?: string;
}

/** フローIOサマリ：1情報種別の出現元（ノードの入出力 or 矢印上のデータ） */
export interface IoSummarySourceDto {
  kind: 'node' | 'edge';
  /** ノードならノードのラベル、矢印なら「矢印ラベル」または「始点→終点」 */
  label: string;
  /** ノードの場合のみ */
  direction?: 'INPUT' | 'OUTPUT';
}

/** フローIOサマリ：重複排除済みの情報種別1件 */
export interface IoSummaryItemDto {
  id: string;
  name: string;
  category: string;
  description: string | null;
  sources: IoSummarySourceDto[];
}

/** AI生成リクエスト */
export interface GenerateKpisBody {
  category: KpiCategory;
  flowId?: string | null;
  systemId?: string | null;
  informationTypeIds: string[];
  instructions?: string | null;
  /** 生成件数（既定 5） */
  count?: number;
}

// ========== APIクライアント ==========

export const kpiApi = {
  /** KPI一覧（任意フィルタ category/flowId/systemId）。GET /api/projects/:projectId/kpis */
  async list(projectId: string, filter?: KpiListFilter): Promise<KpiDto[]> {
    const params = new URLSearchParams();
    if (filter?.category) params.set('category', filter.category);
    if (filter?.flowId) params.set('flowId', filter.flowId);
    if (filter?.systemId) params.set('systemId', filter.systemId);
    const qs = params.toString();
    const res = await fetch(
      `${API_URL}/api/projects/${projectId}/kpis${qs ? `?${qs}` : ''}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error('KPIの取得に失敗しました');
    return res.json();
  },

  /** KPI作成。POST /api/projects/:projectId/kpis */
  async create(projectId: string, body: KpiUpsertBody & { name: string }): Promise<KpiDto> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/kpis`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('KPIの作成に失敗しました');
    return res.json();
  },

  /** KPI更新（全編集可能フィールド）。PATCH /api/kpis/:id */
  async update(id: string, patch: KpiUpsertBody): Promise<KpiDto> {
    const res = await fetch(`${API_URL}/api/kpis/${id}`, {
      method: 'PATCH', headers: headers(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('KPIの更新に失敗しました');
    return res.json();
  },

  /** KPI削除。DELETE /api/kpis/:id */
  async delete(id: string): Promise<void> {
    const res = await fetch(`${API_URL}/api/kpis/${id}`, { method: 'DELETE', headers: headers() });
    if (!res.ok) throw new Error('KPIの削除に失敗しました');
  },

  /** 測定対象の情報種別を全置換。PUT /api/kpis/:id/information-types */
  async setInformationTypes(id: string, informationTypeIds: string[]): Promise<KpiDto> {
    const res = await fetch(`${API_URL}/api/kpis/${id}/information-types`, {
      method: 'PUT', headers: headers(), body: JSON.stringify({ informationTypeIds }),
    });
    if (!res.ok) throw new Error('情報種別の紐づけに失敗しました');
    return res.json();
  },

  /** フローの入出力情報種別サマリ（重複排除＋出現元付き）。GET /api/business-flows/:flowId/io-summary */
  async getFlowIoSummary(flowId: string): Promise<IoSummaryItemDto[]> {
    const res = await fetch(`${API_URL}/api/business-flows/${flowId}/io-summary`, {
      headers: headers(),
    });
    if (!res.ok) throw new Error('フロー入出力サマリの取得に失敗しました');
    return res.json();
  },

  /** AIでKPI候補を生成（status=DRAFT・aiGenerated=true で保存される）。POST /api/projects/:projectId/kpis/generate */
  async generate(projectId: string, body: GenerateKpisBody): Promise<KpiDto[]> {
    const res = await fetch(`${API_URL}/api/projects/${projectId}/kpis/generate`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body),
    });
    if (!res.ok) {
      // バックエンドは AI鍵未設定 / 解析失敗を 400 + message で返す
      let message = 'KPIのAI生成に失敗しました';
      try {
        const data = await res.json();
        if (typeof data?.message === 'string' && data.message.length > 0) message = data.message;
        else if (typeof data?.error === 'string' && data.error.length > 0) message = data.error;
      } catch {
        // JSONでなければ既定メッセージのまま
      }
      throw new Error(message);
    }
    return res.json();
  },

  /**
   * AIでKPI候補を生成（バックグラウンドジョブ AI_KPI 経由）。
   *
   * ジョブを起票し 1.5 秒間隔でポーリングして終端まで待つ。
   *   SUCCEEDED: result = { kind: 'KPIS', kpis } の kpis を返す。
   *   FAILED:    job.error を throw（同期 generate と同じくダイアログがエラー表示）。
   * onEnqueued は起票直後（jobId 確定時）に一度だけ呼ばれる（一覧の更新トリガー用）。
   *
   * 無限ポーリング防止:
   *   - options.signal: 呼び出し側（コンポーネント）のアンマウント時に abort して
   *     ポーリングを即停止できる（AbortError を throw。呼び出し側で握り潰す想定）。
   *   - options.timeoutMs: 上限経過時間（既定 5 分）。QStash の publish 失敗で job が
   *     QUEUED のまま、または RUNNING のまま終端化しないケースで永久に回り続けないよう、
   *     これを超えたらタイムアウト error を throw する。
   */
  async generateViaJob(
    projectId: string,
    body: GenerateKpisBody,
    onEnqueued?: (jobId: string) => void,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<KpiDto[]> {
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs ?? 5 * 60 * 1000; // 既定 5 分

    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw new DOMException('KPI生成のポーリングを中止しました', 'AbortError');
      }
    };

    throwIfAborted();
    const { jobId } = await enqueueAiJob(projectId, 'AI_KPI', {
      category: body.category,
      flowId: body.flowId ?? null,
      systemId: body.systemId ?? null,
      informationTypeIds: body.informationTypeIds,
      instructions: body.instructions ?? null,
      count: body.count,
    });
    onEnqueued?.(jobId);

    const POLL_MS = 1500;
    const startedAt = Date.now();
    // abort されたら sleep を即解除する sleep。
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('KPI生成のポーリングを中止しました', 'AbortError'));
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timer);
          reject(new DOMException('KPI生成のポーリングを中止しました', 'AbortError'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });

    for (;;) {
      throwIfAborted();
      const job = await getJob(jobId);
      if (isTerminalStatus(job.status)) {
        if (job.status === 'FAILED') {
          throw new Error(job.error ?? 'KPIのAI生成に失敗しました');
        }
        const result = job.result as { kind?: string; kpis?: KpiDto[] } | null;
        return result?.kpis ?? [];
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          'KPIのAI生成がタイムアウトしました（時間をおいて再試行するか、ジョブ一覧をご確認ください）',
        );
      }
      await sleep(POLL_MS);
    }
  },
};
