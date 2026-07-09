/**
 * 組織・プロジェクト・フェーズ（Ph.0〜7）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'org_list',
    '所属組織の一覧を取得する。organizationId を得る起点ツール。',
    {},
    wrap(() => call('GET', '/organizations')),
  );

  server.tool(
    'project_list',
    '組織配下のプロジェクト一覧を取得する。',
    {
      organizationId: z.string().describe('組織ID（org_list で取得）'),
    },
    wrap(({ organizationId }) => call('GET', `/organizations/${organizationId}/projects`)),
  );

  server.tool(
    'project_create',
    'プロジェクトを作成する。作成後は phase_initialize で Ph.0〜7 を初期化するとよい。',
    {
      organizationId: z.string().describe('組織ID'),
      name: z.string().describe('プロジェクト名'),
      slug: z.string().describe('スラッグ（URL用識別子。英小文字とハイフン推奨）'),
      description: z.string().optional().describe('説明'),
    },
    wrap(({ organizationId, ...body }) =>
      call('POST', `/organizations/${organizationId}/projects`, { body }),
    ),
  );

  server.tool(
    'project_get',
    'プロジェクト詳細を取得する。',
    {
      id: z.string().describe('プロジェクトID'),
    },
    wrap(({ id }) => call('GET', `/projects/${id}`)),
  );

  server.tool(
    'phase_list',
    'プロジェクトの方法論フェーズ一覧（Ph.0〜7）を取得する。各フェーズの status / summary を確認できる。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/phases`)),
  );

  server.tool(
    'phase_initialize',
    'カノニカルな全8フェーズ（Ph.0〜7）を冪等に初期化する。既存フェーズがあれば重複作成しない。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('POST', `/projects/${projectId}/phases/initialize`, { body: {} })),
  );

  server.tool(
    'phase_update',
    'フェーズの summary / status / order / detail を更新する（状態遷移を含む）。' +
      '状態遷移だけなら api_request で POST /phases/:id/transition も使える。',
    {
      id: z.string().describe('フェーズID（phase_list で取得）'),
      summary: z.string().optional().describe('フェーズのサマリ'),
      detail: z.string().optional().describe('詳細本文'),
      status: z
        .enum(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'APPROVED', 'DONE'])
        .optional()
        .describe('フェーズ状態'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ id, ...body }) => call('PUT', `/phases/${id}`, { body })),
  );

  server.tool(
    'project_readiness_get',
    'プロジェクトの「設定の充実度」を定量集計で取得する。方法論エリア（背景・現状把握・課題・設計・推進など約20項目）' +
      'ごとの登録件数と 未着手/着手/充実 の状態、全体%を返す。プロジェクトの健康診断・次にやることの提案に使える。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/readiness`)),
  );

  server.tool(
    'project_readiness_analyze',
    '充実度をLLM（Haiku）に分析させ、いま優先して着手すべきこと・抜け漏れリスクの講評を得る' +
      '（会社/個人のAnthropic APIキーが必要。課金はLLM使用量として記録される）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) =>
      call('POST', `/projects/${projectId}/readiness/analyze`, { body: {} }),
    ),
  );
}
