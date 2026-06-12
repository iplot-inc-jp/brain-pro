/**
 * マスタ（領域/情報種別/システム/制約/ロール）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'sub_project_list',
    '領域（サブプロジェクト）一覧を取得する。フロー・リスク・ステークホルダー等の領域紐付けの基盤マスタ。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/sub-projects`)),
  );

  server.tool(
    'sub_project_create',
    '領域（サブプロジェクト）を作成する。parentId で領域→サブ領域の入れ子にできる。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('領域名'),
      description: z.string().optional().describe('説明'),
      parentId: z.string().optional().describe('親領域ID（入れ子にする場合）'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/sub-projects`, { body })),
  );

  server.tool(
    'information_type_list',
    '情報種別マスタ一覧を取得する（具体帳票の添付件数付き）。フロー入出力・DFD・KPI測定対象の基盤マスタ。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/information-types`)),
  );

  server.tool(
    'information_type_create',
    '情報種別を作成する。flow_node_io_set / flow_edge_create の informationTypeId として使う基盤マスタ。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('情報種別名（例: 受注票、請求書）'),
      category: z
        .enum(['INFORMATION', 'OBJECT', 'DOCUMENT'])
        .optional()
        .describe('情報カテゴリ（INFORMATION=情報 / OBJECT=モノ / DOCUMENT=帳票）'),
      description: z.string().optional().describe('説明'),
      subProjectId: z.string().optional().describe('紐づく領域（サブプロジェクト）ID'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/information-types`, { body })),
  );

  server.tool(
    'system_list',
    'システムマスタ一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/systems`)),
  );

  server.tool(
    'system_create',
    'システムを作成する。kind で対象システム/周辺システムを区別。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('システム名'),
      kind: z
        .enum(['PERIPHERAL', 'TARGET'])
        .optional()
        .describe('システム種別（TARGET=構築対象 / PERIPHERAL=周辺システム）'),
      description: z.string().optional().describe('説明'),
      subProjectId: z.string().optional().describe('領域（サブプロジェクト）ID'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/systems`, { body })),
  );

  server.tool(
    'constraint_list',
    '制約条件・前提条件の一覧を取得する。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/constraints`)),
  );

  server.tool(
    'constraint_create',
    '制約条件（または前提条件）を作成する。',
    {
      projectId: z.string().describe('プロジェクトID'),
      title: z.string().describe('制約条件タイトル（内容）'),
      description: z.string().optional().describe('説明'),
      category: z.string().optional().describe('カテゴリ（例: 予算/期間/技術/体制）'),
      kind: z
        .enum(['CONSTRAINT', 'ASSUMPTION'])
        .optional()
        .describe('種別（CONSTRAINT=制約 / ASSUMPTION=前提条件）'),
      subProjectId: z.string().optional().describe('領域（サブプロジェクト）ID'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/constraints`, { body })),
  );

  server.tool(
    'role_list',
    'ロール一覧を取得する。スイムレーン（業務フロー）のレーン定義であり、flow_node_create の roleId に使う。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/roles/project/${projectId}`)),
  );

  server.tool(
    'role_create',
    'ロールを作成する（責務・決裁範囲・KPI・色）。スイムレーンのレーンとして使われる。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('ロール名（例: 営業、経理、基幹システム）'),
      type: z
        .enum(['HUMAN', 'SYSTEM', 'OTHER'])
        .describe('ロールタイプ（HUMAN=人 / SYSTEM=システム / OTHER=その他）'),
      description: z.string().optional().describe('説明'),
      responsibility: z.string().optional().describe('責務'),
      decisionScope: z.string().optional().describe('決裁範囲'),
      kpi: z.string().optional().describe('このロールのKPI'),
      color: z.string().optional().describe('カラー（HEX形式。例: #4F46E5）'),
      systemId: z.string().optional().describe('所属システムID'),
      subProjectId: z.string().optional().describe('所属領域（サブプロジェクト）ID'),
    },
    wrap((body) => call('POST', '/roles', { body })),
  );
}
