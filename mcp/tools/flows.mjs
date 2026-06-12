/**
 * 業務フロー（ASIS/TOBE スイムレーン・業務定義）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'flow_list',
    'プロジェクトの全業務フロー一覧を取得する（親子階層・ASIS/TOBE 種別を含む）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/business-flows/project/${projectId}/all`)),
  );

  server.tool(
    'flow_get',
    'フロー詳細を取得する（ノード・エッジ同梱）。スイムレーンの現状を読むときの基本ツール。',
    {
      id: z.string().describe('フローID'),
    },
    wrap(({ id }) => call('GET', `/business-flows/${id}`)),
  );

  server.tool(
    'flow_create',
    '業務フローを作成する。kind で ASIS/TOBE を指定。TOBE フローには asisFlowId で対応する ASIS を紐付けられる。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('フロー名'),
      description: z.string().optional().describe('説明'),
      kind: z.enum(['ASIS', 'TOBE']).optional().describe('フロー種別（ASIS=現状 / TOBE=あるべき姿）'),
      parentId: z.string().optional().describe('親フローID（ドリルダウン階層にする場合）'),
      subProjectId: z.string().optional().describe('領域（サブプロジェクト）ID'),
      asisFlowId: z.string().optional().describe('対応するASISフローID（TOBE作成時のトレーサビリティ）'),
      folderId: z.string().optional().describe('フローフォルダID'),
    },
    wrap((body) => call('POST', '/business-flows', { body })),
  );

  server.tool(
    'flow_update',
    'フローの名称・説明・種別・紐付け等を更新する。',
    {
      id: z.string().describe('フローID'),
      name: z.string().optional().describe('フロー名'),
      description: z.string().optional().describe('説明'),
      kind: z.enum(['ASIS', 'TOBE']).optional().describe('フロー種別'),
      subProjectId: z.string().nullable().optional().describe('領域（サブプロジェクト）ID。null で解除'),
      asisFlowId: z.string().nullable().optional().describe('対応するASISフローID。null で解除'),
      folderId: z.string().nullable().optional().describe('フローフォルダID。null で解除'),
    },
    wrap(({ id, ...body }) => call('PUT', `/business-flows/${id}`, { body })),
  );

  server.tool(
    'flow_delete',
    'フローを削除する。',
    {
      id: z.string().describe('フローID'),
    },
    wrap(({ id }) => call('DELETE', `/business-flows/${id}`)),
  );

  server.tool(
    'flow_node_create',
    'フローにノード（工程）を追加する。positionX/positionY は必須（スイムレーン座標。' +
      '横方向に約220px間隔、ロールのレーン内のY座標を指定）。roleId でレーン（担当ロール）を指定。',
    {
      flowId: z.string().describe('フローID'),
      label: z.string().describe('工程名（ノードのラベル）'),
      type: z.string().optional().describe('ノード種別（task など。省略可）'),
      description: z.string().optional().describe('説明'),
      positionX: z.number().describe('X座標（必須）'),
      positionY: z.number().describe('Y座標（必須）'),
      roleId: z.string().optional().describe('担当ロールID（スイムレーンのレーン。role_list で取得）'),
      processingTime: z.string().optional().describe('処理時間（例: "30分"）'),
      handledCount: z.string().optional().describe('対応件数（例: "10件/日"）'),
      supplement: z.string().optional().describe('補足'),
    },
    wrap(({ flowId, ...body }) => call('POST', `/business-flows/${flowId}/nodes`, { body })),
  );

  server.tool(
    'flow_node_update',
    'ノードを更新する（ラベル・ロール・位置・処理時間・補足など）。',
    {
      flowId: z.string().describe('フローID'),
      nodeId: z.string().describe('ノードID'),
      label: z.string().optional().describe('工程名'),
      description: z.string().optional().describe('説明'),
      roleId: z.string().optional().describe('担当ロールID'),
      positionX: z.number().optional().describe('X座標'),
      positionY: z.number().optional().describe('Y座標'),
      order: z.number().optional().describe('並び順'),
      processingTime: z.string().optional().describe('処理時間'),
      handledCount: z.string().optional().describe('対応件数'),
      supplement: z.string().optional().describe('補足'),
    },
    wrap(({ flowId, nodeId, ...body }) =>
      call('PUT', `/business-flows/${flowId}/nodes/${nodeId}`, { body }),
    ),
  );

  server.tool(
    'flow_node_delete',
    'ノードを削除する。',
    {
      flowId: z.string().describe('フローID'),
      nodeId: z.string().describe('ノードID'),
    },
    wrap(({ flowId, nodeId }) => call('DELETE', `/business-flows/${flowId}/nodes/${nodeId}`)),
  );

  server.tool(
    'flow_edge_create',
    'エッジ（矢印）を作成する。informationTypeId でこの矢印上を流れるデータ（情報種別マスタ）を紐付けられる。',
    {
      flowId: z.string().describe('フローID'),
      sourceNodeId: z.string().describe('接続元ノードID'),
      targetNodeId: z.string().describe('接続先ノードID'),
      label: z.string().optional().describe('エッジのラベル'),
      condition: z.string().optional().describe('分岐条件'),
      informationTypeId: z.string().optional().describe('この矢印上を流れるデータ（情報種別マスタID）'),
    },
    wrap(({ flowId, ...body }) => call('POST', `/business-flows/${flowId}/edges`, { body })),
  );

  server.tool(
    'flow_edge_delete',
    'エッジを削除する。',
    {
      flowId: z.string().describe('フローID'),
      edgeId: z.string().describe('エッジID'),
    },
    wrap(({ flowId, edgeId }) => call('DELETE', `/business-flows/${flowId}/edges/${edgeId}`)),
  );

  server.tool(
    'flow_node_io_set',
    'ノードの入出力（情報種別マスタ紐づけ）を一括置換する。DFD 生成（dfd_level1_sync / dfd_level2_sync）の元データになる。' +
      '空配列を渡すと全削除。',
    {
      flowId: z.string().describe('フローID'),
      nodeId: z.string().describe('ノードID'),
      links: z
        .array(
          z.object({
            informationTypeId: z.string().describe('情報種別マスタID（information_type_list で取得）'),
            direction: z.enum(['INPUT', 'OUTPUT']).describe('リンク方向（INPUT=入力 / OUTPUT=出力）'),
            order: z.number().optional().describe('並び順'),
          }),
        )
        .describe('入出力リンクの完全なリスト（既存は全置換される）'),
    },
    wrap(({ flowId, nodeId, links }) =>
      call('PUT', `/business-flows/${flowId}/nodes/${nodeId}/information-links`, { body: { links } }),
    ),
  );

  server.tool(
    'flow_mermaid_import',
    'Mermaid 図（flowchart）を AI 解析してフローへ一括取り込みする。ノード/エッジを効率よく一括生成する手段。' +
      '既存ノードがあるフローにも追記できる。',
    {
      id: z.string().describe('取り込み先フローID'),
      mermaid: z.string().describe('Mermaid flowchart のソーステキスト'),
    },
    wrap(({ id, mermaid }) => call('POST', `/business-flows/${id}/import-mermaid`, { body: { mermaid } })),
  );

  server.tool(
    'flow_definition_upsert',
    '業務定義シート③（フロー個別の目的・入出力・開始/終了条件など）を upsert する。' +
      '取得は api_request で GET /business-flows/:flowId/definition、' +
      '全フロー一覧は GET /projects/:projectId/flow-definitions。',
    {
      flowId: z.string().describe('フローID'),
      purpose: z.string().optional().describe('業務の目的'),
      owner: z.string().optional().describe('業務オーナー'),
      stakeholders: z.string().optional().describe('関係者'),
      input: z.string().optional().describe('インプット（開始条件）'),
      inputDetail: z.string().optional().describe('インプット詳細'),
      trigger: z.string().optional().describe('トリガー（開始のきっかけ）'),
      doSteps: z.array(z.string()).optional().describe('実施ステップ（Do）の配列'),
      output: z.string().optional().describe('アウトプット（終了条件）'),
      nextProcess: z.string().optional().describe('後続プロセス'),
      exceptionHandling: z.string().optional().describe('例外処理'),
      frequency: z.string().optional().describe('頻度'),
      system: z.string().optional().describe('使用システム'),
      tacitNotes: z.string().optional().describe('暗黙知メモ'),
    },
    wrap(({ flowId, ...body }) => call('PUT', `/business-flows/${flowId}/definition`, { body })),
  );
}
