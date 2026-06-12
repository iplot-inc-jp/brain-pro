/**
 * DFD・データオブジェクト（関係性マップ/ER図）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'dfd_level1_get',
    'プロジェクトの第1レベルDFDを取得する（get-or-create。無ければ空の図を作って返す）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/dfd`)),
  );

  server.tool(
    'dfd_level1_sync',
    '第1レベルDFDを業務フロー＋FlowNodeLink から冪等に生成・同期する。フローや入出力を編集した後に呼ぶ。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('POST', `/projects/${projectId}/dfd`, { body: {} })),
  );

  server.tool(
    'dfd_level2_get',
    'フロー単位の第2レベルDFDを取得する（get-or-create）。',
    {
      flowId: z.string().describe('業務フローID'),
    },
    wrap(({ flowId }) => call('GET', `/business-flows/${flowId}/dfd`)),
  );

  server.tool(
    'dfd_level2_sync',
    '第2レベルDFDをノード入出力（flow_node_io_set の結果）から冪等に生成・同期する。',
    {
      flowId: z.string().describe('業務フローID'),
    },
    wrap(({ flowId }) => call('POST', `/business-flows/${flowId}/dfd`, { body: {} })),
  );

  server.tool(
    'dfd_node_add',
    'DFDノード（プロセス/データストア/外部実体）を手動追加する。更新・削除は api_request の PATCH/DELETE /dfd-nodes/:id。',
    {
      diagramId: z.string().describe('DFD図ID（dfd_level1_get / dfd_level2_get で取得）'),
      label: z.string().describe('ノードのラベル'),
      kind: z
        .enum(['FUNCTION', 'EXTERNAL_ENTITY', 'DATA_STORE'])
        .describe('ノード種別（FUNCTION=プロセス / EXTERNAL_ENTITY=外部実体 / DATA_STORE=データストア）'),
      number: z.string().optional().describe('プロセス番号（例: "1.0"）'),
      dataObjectId: z.string().optional().describe('紐づくデータオブジェクトID（データストアの場合）'),
      positionX: z.number().optional().describe('X座標'),
      positionY: z.number().optional().describe('Y座標'),
    },
    wrap(({ diagramId, ...body }) => call('POST', `/dfd-diagrams/${diagramId}/nodes`, { body })),
  );

  server.tool(
    'dfd_dataflow_add',
    'DFDのデータフロー（矢印）を追加する。dataItem が矢印のラベル（流れるデータ名）。' +
      '更新・削除は api_request の PATCH/DELETE /dfd-flows/:id。',
    {
      diagramId: z.string().describe('DFD図ID'),
      sourceNodeId: z.string().describe('接続元DFDノードID'),
      targetNodeId: z.string().describe('接続先DFDノードID'),
      dataItem: z.string().optional().describe('流れるデータ名（矢印のラベル）'),
      informationTypeId: z.string().optional().describe('情報種別マスタID'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ diagramId, ...body }) => call('POST', `/dfd-diagrams/${diagramId}/flows`, { body })),
  );

  server.tool(
    'data_object_list',
    'オブジェクト関係性マップを取得する（objects＋relations）。ER図グラフは api_request の GET /projects/:projectId/er-graph。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/data-objects`)),
  );

  server.tool(
    'data_object_create',
    'データオブジェクトを作成する。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('オブジェクト名（例: 受注、顧客）'),
      description: z.string().optional().describe('説明'),
      color: z.string().optional().describe('カラー（HEX形式）'),
      positionX: z.number().optional().describe('X座標'),
      positionY: z.number().optional().describe('Y座標'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/data-objects`, { body })),
  );

  server.tool(
    'data_object_update',
    'データオブジェクトを部分更新する（name / description / color / order）。',
    {
      id: z.string().describe('データオブジェクトID'),
      name: z.string().optional().describe('オブジェクト名'),
      description: z.string().optional().describe('説明'),
      color: z.string().optional().describe('カラー（HEX形式）'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ id, ...body }) => call('PATCH', `/data-objects/${id}`, { body })),
  );

  server.tool(
    'data_object_relation_create',
    'オブジェクト間の関係線を作成する（source=target は拒否される）。' +
      '更新・削除は api_request の PATCH/DELETE /data-object-relations/:id。',
    {
      projectId: z.string().describe('プロジェクトID'),
      sourceObjectId: z.string().describe('接続元オブジェクトID'),
      targetObjectId: z.string().describe('接続先オブジェクトID'),
      cardinality: z
        .enum(['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'])
        .optional()
        .describe('多重度（1:1 / 1:N / N:N）'),
      label: z.string().optional().describe('関係線のラベル'),
      description: z.string().optional().describe('説明'),
    },
    wrap(({ projectId, ...body }) =>
      call('POST', `/projects/${projectId}/data-object-relations`, { body }),
    ),
  );

  server.tool(
    'data_object_import_from_dfd',
    '第1レベルDFDのデータストアからデータオブジェクトを冪等に取り込む（DFD→オブジェクトの橋渡し）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('POST', `/projects/${projectId}/data-objects/import-from-dfd`, { body: {} })),
  );

  server.tool(
    'data_object_link_table',
    'データカタログのテーブルをデータオブジェクトに紐付け/解除する（ER図統合）。dataObjectId に null を渡すと解除。',
    {
      tableId: z.string().describe('テーブルID'),
      dataObjectId: z.string().nullable().describe('データオブジェクトID（null で紐付け解除）'),
    },
    wrap(({ tableId, dataObjectId }) =>
      call('PUT', `/tables/${tableId}/data-object`, { body: { dataObjectId } }),
    ),
  );
}
