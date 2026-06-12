/**
 * リスク（RBS）・ステークホルダー（RACI）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

const riskFields = {
  code: z.string().optional().describe('リスクID（表示用コード）'),
  type: z.string().optional().describe('種別（リスク/ボトルネック）'),
  event: z.string().optional().describe('事象内容'),
  causeCategory: z.string().optional().describe('原因区分（人/情報/決裁/技術/外部）'),
  probability: z.string().optional().describe('発生確率（高/中/低）'),
  impact: z.string().optional().describe('影響度（高/中/低）'),
  probabilityScore: z.number().optional().describe('発生確率スコア（1-5）'),
  impactScore: z.number().optional().describe('影響度スコア（1-5）'),
  priority: z.string().optional().describe('優先度'),
  riskType: z.string().optional().describe('リスク種別（THREAT / OPPORTUNITY）'),
  strategy: z.string().optional().describe('対応戦略（回避/転嫁/軽減/受容/活用/共有/強化）'),
  countermeasure: z.string().optional().describe('対応策（予防・軽減）'),
  responsePlan: z.string().optional().describe('対応計画'),
  contingencyPlan: z.string().optional().describe('コンティンジェンシー計画'),
  trigger: z.string().optional().describe('トリガー条件'),
  lifecycle: z.string().optional().describe('ライフサイクル（IDENTIFIED / ANALYZED / RESPONDING / MONITORING / OCCURRED / CLOSED）'),
  deadline: z.string().optional().describe('期限'),
  owner: z.string().optional().describe('担当'),
  ownerStakeholderId: z.string().optional().describe('リスクオーナー（ステークホルダー）ID'),
  status: z.string().optional().describe('ステータス'),
  note: z.string().optional().describe('備考'),
  order: z.number().optional().describe('並び順'),
  categoryId: z.string().optional().describe('RBSカテゴリID（risk_category_list で取得。null で未分類）'),
  subProjectId: z.string().optional().describe('対象領域（サブプロジェクト）ID'),
};

export function registerTools(server, call) {
  server.tool(
    'risk_list',
    'リスク・ボトルネック一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/risks`)),
  );

  server.tool(
    'risk_create',
    'リスクを作成する（事象・発生確率/影響スコア・対応戦略・コンティンジェンシー等）。全フィールド任意。',
    {
      projectId: z.string().describe('プロジェクトID'),
      ...riskFields,
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/risks`, { body })),
  );

  server.tool(
    'risk_update',
    'リスクを部分更新する（PATCH。渡したフィールドだけ更新）。',
    {
      id: z.string().describe('リスクID'),
      ...riskFields,
    },
    wrap(({ id, ...body }) => call('PATCH', `/risks/${id}`, { body })),
  );

  server.tool(
    'risk_delete',
    'リスクを削除する。',
    {
      id: z.string().describe('リスクID'),
    },
    wrap(({ id }) => call('DELETE', `/risks/${id}`)),
  );

  server.tool(
    'risk_category_list',
    'リスクカテゴリ（RBS）一覧を取得する。0件の場合は PMBOK 初期カテゴリが自動シードされる。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/risk-categories`)),
  );

  server.tool(
    'stakeholder_list',
    'ステークホルダー一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/stakeholders`)),
  );

  server.tool(
    'stakeholder_create',
    'ステークホルダーを作成する（所属・関心・影響度・エンゲージメント方針など）。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('ステークホルダー名'),
      affiliation: z.string().optional().describe('所属'),
      role: z.string().optional().describe('役割'),
      interest: z.string().optional().describe('関心事'),
      concern: z.string().optional().describe('懸念'),
      influence: z.string().optional().describe('影響度'),
      support: z.string().optional().describe('支持度'),
      engagement: z.string().optional().describe('エンゲージメント方針'),
      reportFrequency: z.string().optional().describe('報告頻度'),
      contactMethod: z.string().optional().describe('連絡手段'),
      side: z.enum(['INTERNAL', 'EXTERNAL']).optional().describe('内部/外部区分'),
      note: z.string().optional().describe('備考'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/stakeholders`, { body })),
  );

  server.tool(
    'stakeholder_update',
    'ステークホルダーを部分更新する（PATCH。渡したフィールドだけ更新）。',
    {
      id: z.string().describe('ステークホルダーID'),
      name: z.string().optional().describe('ステークホルダー名'),
      affiliation: z.string().optional().describe('所属'),
      role: z.string().optional().describe('役割'),
      interest: z.string().optional().describe('関心事'),
      concern: z.string().optional().describe('懸念'),
      influence: z.string().optional().describe('影響度'),
      support: z.string().optional().describe('支持度'),
      engagement: z.string().optional().describe('エンゲージメント方針'),
      reportFrequency: z.string().optional().describe('報告頻度'),
      contactMethod: z.string().optional().describe('連絡手段'),
      side: z.enum(['INTERNAL', 'EXTERNAL']).optional().describe('内部/外部区分'),
      note: z.string().optional().describe('備考'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ id, ...body }) => call('PATCH', `/stakeholders/${id}`, { body })),
  );

  server.tool(
    'stakeholder_domain_assign',
    'ステークホルダーの担当領域（サブプロジェクト×RACI）をまるごと置き換える。' +
      'プロジェクト全体の割当一覧は api_request で GET /projects/:projectId/stakeholder-assignments。',
    {
      id: z.string().describe('ステークホルダーID'),
      items: z
        .array(
          z.object({
            subProjectId: z.string().describe('サブプロジェクト（領域）ID'),
            raci: z.enum(['R', 'A', 'C', 'I']).describe('RACI（R=実行 / A=説明責任 / C=協議 / I=報告）'),
          }),
        )
        .describe('割当一覧（既存はまるごと置き換え）'),
    },
    wrap(({ id, items }) => call('PUT', `/stakeholders/${id}/domain-assignments`, { body: { items } })),
  );
}
