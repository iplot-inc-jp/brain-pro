/**
 * PM（プロジェクト憲章/KPI/導入状況/変更履歴）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

const kpiFields = {
  category: z
    .enum(['BUSINESS', 'AI_QUALITY'])
    .optional()
    .describe('KPIカテゴリ（BUSINESS=業務KPI / AI_QUALITY=AI精度KPI）'),
  flowId: z.string().optional().describe('紐づく業務フローID（業務KPI向け）'),
  systemId: z.string().optional().describe('紐づくシステムID（AI精度KPI向け）'),
  description: z.string().optional().describe('説明'),
  definition: z.string().optional().describe('KPI定義（計算式など）'),
  unit: z.string().optional().describe('単位（例: %, 件, 時間）'),
  baselineValue: z.number().optional().describe('ベースライン値'),
  targetValue: z.number().optional().describe('目標値'),
  currentValue: z.number().optional().describe('現在値'),
  direction: z
    .enum(['INCREASE', 'DECREASE', 'MAINTAIN'])
    .optional()
    .describe('改善方向（INCREASE=増やす / DECREASE=減らす / MAINTAIN=維持）'),
  frequency: z
    .enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'])
    .optional()
    .describe('測定頻度'),
  measurementMethod: z.string().optional().describe('測定方法'),
  ownerRoleId: z.string().optional().describe('オーナーロールID'),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional().describe('ステータス'),
  order: z.number().optional().describe('並び順'),
};

export function registerTools(server, call) {
  server.tool(
    'charter_get',
    'プロジェクト憲章を取得する（未作成なら null）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/charter`)),
  );

  server.tool(
    'charter_upsert',
    'プロジェクト憲章を upsert する（背景・目的・成功基準・スコープ・承認者。全フィールド任意）。',
    {
      projectId: z.string().describe('プロジェクトID'),
      background: z.string().optional().describe('背景'),
      purpose: z.string().optional().describe('目的'),
      successCriteria: z.string().optional().describe('成功基準'),
      scopeIn: z.string().optional().describe('スコープ内'),
      scopeOut: z.string().optional().describe('スコープ外'),
      budgetNote: z.string().optional().describe('予算メモ'),
      approverStakeholderId: z.string().optional().describe('承認者ステークホルダーID'),
      sponsorStakeholderId: z.string().optional().describe('スポンサーステークホルダーID'),
    },
    wrap(({ projectId, ...body }) => call('PUT', `/projects/${projectId}/charter`, { body })),
  );

  server.tool(
    'kpi_list',
    'KPI一覧を取得する（category / flowId / systemId でフィルタ可）。業務KPI×AI精度KPIの両方を扱う。',
    {
      projectId: z.string().describe('プロジェクトID'),
      category: z.enum(['BUSINESS', 'AI_QUALITY']).optional().describe('カテゴリフィルタ'),
      flowId: z.string().optional().describe('業務フローIDフィルタ'),
      systemId: z.string().optional().describe('システムIDフィルタ'),
    },
    wrap(({ projectId, ...query }) => call('GET', `/projects/${projectId}/kpis`, { query })),
  );

  server.tool(
    'kpi_create',
    'KPIを作成する（業務KPI / AI精度KPI）。測定対象の情報種別は api_request の PUT /kpis/:id/information-types で設定。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('KPI名'),
      ...kpiFields,
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/kpis`, { body })),
  );

  server.tool(
    'kpi_update',
    'KPIを部分更新する（PATCH。渡したフィールドだけ更新）。SMART採点は api_request で smartSpecific 等を渡す。',
    {
      id: z.string().describe('KPI ID'),
      name: z.string().optional().describe('KPI名'),
      ...kpiFields,
    },
    wrap(({ id, ...body }) => call('PATCH', `/kpis/${id}`, { body })),
  );

  server.tool(
    'adoption_status_list',
    '導入状況（定着度）一覧を取得する（ステークホルダー×システム）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/adoption-statuses`)),
  );

  server.tool(
    'adoption_status_upsert',
    '導入状況を upsert する（(projectId, stakeholderId, systemId) で一意。定着段階・阻害要因・次アクション）。',
    {
      projectId: z.string().describe('プロジェクトID'),
      stakeholderId: z.string().describe('ステークホルダーID'),
      systemId: z.string().nullable().optional().describe('対象システムID（null/省略 = プロジェクト全体）'),
      stage: z
        .enum(['NOT_STARTED', 'INFORMED', 'TRAINED', 'TRIAL', 'LIVE', 'ESTABLISHED'])
        .optional()
        .describe('定着度（未着手/説明済/トレーニング済/試行中/本番利用/定着）'),
      blockers: z.string().optional().describe('阻害要因'),
      nextAction: z.string().optional().describe('次のアクション'),
      note: z.string().optional().describe('メモ'),
      lastContactAt: z.string().optional().describe('最終接触日時（ISO 8601）'),
    },
    wrap(({ projectId, ...body }) =>
      call('PUT', `/projects/${projectId}/adoption-statuses/upsert`, { body }),
    ),
  );

  server.tool(
    'change_log_list',
    'プロジェクトの変更履歴を取得する（新しい順）。誰が何をいつ変えたかの監査ログ。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/change-logs`)),
  );
}
