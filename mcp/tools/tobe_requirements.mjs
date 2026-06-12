/**
 * TOBE（ビジョン/ロードマップ）・要求
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'tobe_vision_list',
    'TOBEビジョン一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/tobe-visions`)),
  );

  server.tool(
    'tobe_vision_create',
    'TOBEビジョンを作成する（領域・施策・効果・ASISフロー紐付け）。更新は api_request の PATCH /tobe-visions/:id。',
    {
      projectId: z.string().describe('プロジェクトID'),
      area: z.string().optional().describe('領域'),
      vision: z.string().optional().describe('ビジョン・あるべき姿'),
      countermeasure: z.string().optional().describe('施策・対応'),
      effect: z.string().optional().describe('効果'),
      order: z.number().optional().describe('並び順'),
      subProjectId: z.string().optional().describe('領域（サブプロジェクト）ID'),
      asisFlowId: z.string().optional().describe('紐づくASIS業務フローID'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/tobe-visions`, { body })),
  );

  server.tool(
    'tobe_roadmap_list',
    'TOBEロードマップ一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/tobe-roadmaps`)),
  );

  server.tool(
    'tobe_roadmap_create',
    'TOBEロードマップ行を作成する（フェーズ・施策・ROI・コスト・回収期間）。更新は api_request の PATCH /tobe-roadmaps/:id。',
    {
      projectId: z.string().describe('プロジェクトID'),
      phase: z.string().optional().describe('フェーズ（例: 第1期）'),
      measure: z.string().optional().describe('施策'),
      roi: z.string().optional().describe('ROI'),
      cost: z.string().optional().describe('コスト'),
      payback: z.string().optional().describe('回収期間'),
      scope: z.string().optional().describe('範囲'),
      order: z.number().optional().describe('並び順'),
      subProjectId: z.string().optional().describe('領域（サブプロジェクト）ID'),
      tobeVisionId: z.string().optional().describe('元になったTOBEビジョンID'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/tobe-roadmaps`, { body })),
  );

  server.tool(
    'requirement_list',
    'プロジェクトの要求一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/requirements/project/${projectId}`)),
  );

  server.tool(
    'requirement_create',
    '要求を作成する。自然言語からの一括生成は api_request の POST /requirements/parse も使える。',
    {
      projectId: z.string().describe('プロジェクトID'),
      title: z.string().describe('要求タイトル'),
      description: z.string().optional().describe('説明'),
      parentId: z.string().optional().describe('親要求ID（階層化する場合）'),
      originalText: z.string().optional().describe('元の発言・原文'),
      type: z.string().optional().describe('要求種別（例: FUNCTIONAL / NON_FUNCTIONAL）'),
      priority: z.string().optional().describe('優先度（例: HIGH / MEDIUM / LOW）'),
      status: z.string().optional().describe('ステータス'),
    },
    wrap((body) => call('POST', '/requirements', { body })),
  );

  server.tool(
    'requirement_update',
    '要求を更新する。',
    {
      id: z.string().describe('要求ID'),
      title: z.string().optional().describe('要求タイトル'),
      description: z.string().optional().describe('説明'),
      type: z.string().optional().describe('要求種別'),
      priority: z.string().optional().describe('優先度'),
      status: z.string().optional().describe('ステータス'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ id, ...body }) => call('PUT', `/requirements/${id}`, { body })),
  );

  server.tool(
    'requirement_link_flow',
    '要求を業務フロー（任意でフローノード）に紐付ける。要件↔TOBEフローのトレーサビリティを作る。' +
      '解除は api_request の DELETE /requirements/:id/link-flow/:mappingId。',
    {
      id: z.string().describe('要求ID'),
      flowId: z.string().describe('紐付ける業務フローID'),
      flowNodeId: z.string().optional().describe('紐付けるフローノードID（任意）'),
      description: z.string().optional().describe('紐付けの説明'),
    },
    wrap(({ id, ...body }) => call('POST', `/requirements/${id}/link-flow`, { body })),
  );
}
