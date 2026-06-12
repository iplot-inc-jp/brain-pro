/**
 * イシューツリー・GAP（課題分析）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

const NODE_KINDS = [
  'ISSUE',
  'CAUSE',
  'COUNTERMEASURE',
  'POINT',
  'HYPOTHESIS',
  'VERIFICATION',
  'RESULT',
  'ELEMENT',
  'OPTION',
  'ACTION',
  'METRIC',
];

export function registerTools(server, call) {
  server.tool(
    'issue_tree_list',
    'イシューツリー一覧を取得する（任意で型フィルタ）。WHY=なぜ型（原因分析）/ SOLUTION=打ち手型。',
    {
      projectId: z.string().describe('プロジェクトID'),
      type: z.enum(['WHY', 'SOLUTION']).optional().describe('ツリー型フィルタ'),
    },
    wrap(({ projectId, type }) =>
      call('GET', `/projects/${projectId}/issue-trees`, { query: { type } }),
    ),
  );

  server.tool(
    'issue_tree_get',
    'イシューツリー詳細を取得する（全ノード同梱）。',
    {
      id: z.string().describe('イシューツリーID'),
    },
    wrap(({ id }) => call('GET', `/issue-trees/${id}`)),
  );

  server.tool(
    'issue_tree_create',
    'イシューツリーを作成する。gapItemId を指定すると作成したツリーがその GAP に紐付く（GAP→打ち手ツリーのトレーサビリティ）。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('ツリー名'),
      type: z.enum(['WHY', 'SOLUTION']).optional().describe('ツリー型（WHY=なぜ型 / SOLUTION=打ち手型）。省略時 WHY'),
      pattern: z
        .enum(['ISSUE_POINT', 'WHY', 'WHAT', 'HOW', 'MECE_ACTION', 'KPI'])
        .optional()
        .describe('ツリーパターン（作成テンプレ）。省略時 ISSUE_POINT'),
      rootQuestion: z.string().optional().describe('ルートの問い'),
      gapItemId: z.string().optional().describe('リンクする GAP のID（このGAPの打ち手ツリーとして紐付け）'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/issue-trees`, { body })),
  );

  server.tool(
    'issue_node_add',
    'イシューツリーにノードを追加する（親子構造・種別・検証状態・根拠）。parentId 省略でルートノード。',
    {
      treeId: z.string().describe('イシューツリーID'),
      label: z.string().describe('ノードのラベル（課題・原因・打ち手などの内容）'),
      parentId: z.string().optional().describe('親ノードID（ルートの場合は省略）'),
      kind: z
        .enum(NODE_KINDS)
        .optional()
        .describe('ノード種別（ISSUE=課題 / CAUSE=原因 / COUNTERMEASURE=打ち手 など）'),
      verification: z
        .enum(['CONFIRMED', 'REJECTED', 'UNKNOWN', 'NEEDS_HEARING', 'NA'])
        .optional()
        .describe('検証状態（CONFIRMED=○ / REJECTED=× / UNKNOWN=△ / NEEDS_HEARING=要ヒアリング）'),
      recommendation: z
        .enum(['ADOPT', 'HOLD', 'REJECT', 'NA'])
        .optional()
        .describe('推奨アクション（ADOPT=採用 / HOLD=保留 / REJECT=却下）'),
      evidence: z.string().optional().describe('根拠'),
      order: z.number().optional().describe('兄弟内の表示順序'),
    },
    wrap(({ treeId, ...body }) => call('POST', `/issue-trees/${treeId}/nodes`, { body })),
  );

  server.tool(
    'issue_node_update',
    'イシューノードを更新する（ラベル・検証状態・推奨アクション・親付け替え等）。',
    {
      treeId: z.string().describe('イシューツリーID'),
      nodeId: z.string().describe('ノードID'),
      label: z.string().optional().describe('ラベル'),
      kind: z.enum(NODE_KINDS).optional().describe('ノード種別'),
      verification: z
        .enum(['CONFIRMED', 'REJECTED', 'UNKNOWN', 'NEEDS_HEARING', 'NA'])
        .optional()
        .describe('検証状態'),
      recommendation: z
        .enum(['ADOPT', 'HOLD', 'REJECT', 'NA'])
        .optional()
        .describe('推奨アクション'),
      evidence: z.string().optional().describe('根拠'),
      parentId: z.string().nullable().optional().describe('親ノードID（null でルート化）'),
      order: z.number().optional().describe('兄弟内の表示順序'),
    },
    wrap(({ treeId, nodeId, ...body }) =>
      call('PUT', `/issue-trees/${treeId}/nodes/${nodeId}`, { body }),
    ),
  );

  server.tool(
    'issue_node_delete',
    'イシューノードを削除する。',
    {
      treeId: z.string().describe('イシューツリーID'),
      nodeId: z.string().describe('ノードID'),
    },
    wrap(({ treeId, nodeId }) => call('DELETE', `/issue-trees/${treeId}/nodes/${nodeId}`)),
  );

  server.tool(
    'gap_list',
    'GAP（ASIS↔TOBE の差分＝本当の課題）一覧を取得する。status / priority / phaseId でフィルタ可。',
    {
      projectId: z.string().describe('プロジェクトID'),
      status: z.string().optional().describe('ステータスフィルタ（例: OPEN / RESOLVED）'),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().describe('優先度フィルタ'),
      phaseId: z.string().optional().describe('フェーズIDフィルタ'),
    },
    wrap(({ projectId, ...query }) => call('GET', `/projects/${projectId}/gap-items`, { query })),
  );

  server.tool(
    'gap_create',
    'GAP を作成する。ASIS/TOBE フロー・ノード・打ち手ツリー（issueTreeId）へのトレーサビリティ付き。',
    {
      projectId: z.string().describe('プロジェクトID'),
      businessArea: z.string().describe('業務領域'),
      asisDescription: z.string().optional().describe('ASIS（現状）の説明'),
      tobeDescription: z.string().optional().describe('TOBE（あるべき姿）の説明'),
      gapDescription: z.string().optional().describe('GAP（差分＝本当の課題）の説明'),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().describe('優先度'),
      ownerName: z.string().optional().describe('担当者名'),
      order: z.number().optional().describe('表示順'),
      phaseId: z.string().optional().describe('フェーズID'),
      asisFlowId: z.string().optional().describe('ASISフローID'),
      asisNodeId: z.string().optional().describe('ASISノードID'),
      tobeFlowId: z.string().optional().describe('TOBEフローID'),
      tobeNodeId: z.string().optional().describe('TOBEノードID'),
      issueTreeId: z.string().optional().describe('この GAP を改善する打ち手ツリー（SOLUTION型）のID'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/gap-items`, { body })),
  );

  server.tool(
    'gap_update',
    'GAP を更新する（内容・優先度・担当・スコープ外フラグ等）。' +
      '解決/再オープンは api_request で POST /gap-items/:id/resolve・/reopen を使う。',
    {
      id: z.string().describe('GAP ID'),
      businessArea: z.string().optional().describe('業務領域'),
      asisDescription: z.string().optional().describe('ASIS（現状）の説明'),
      tobeDescription: z.string().optional().describe('TOBE（あるべき姿）の説明'),
      gapDescription: z.string().optional().describe('GAP（差分）の説明'),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().describe('優先度'),
      ownerName: z.string().optional().describe('担当者名'),
      order: z.number().optional().describe('表示順'),
      outOfScope: z.boolean().optional().describe('スコープ外フラグ（今回の取り組み範囲から除外）'),
      asisFlowId: z.string().nullable().optional().describe('ASISフローID（null で解除）'),
      asisNodeId: z.string().nullable().optional().describe('ASISノードID（null で解除）'),
      tobeFlowId: z.string().nullable().optional().describe('TOBEフローID（null で解除）'),
      tobeNodeId: z.string().nullable().optional().describe('TOBEノードID（null で解除）'),
      issueTreeId: z.string().nullable().optional().describe('打ち手ツリーID（null で解除）'),
    },
    wrap(({ id, ...body }) => call('PUT', `/gap-items/${id}`, { body })),
  );
}
