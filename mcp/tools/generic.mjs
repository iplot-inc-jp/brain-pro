/**
 * 汎用・コアツール（フォールバック / 接続確認）
 *
 * - list_capabilities: OpenAPI 全ルートをタグ別に列挙（curated ツールにない操作を探す）
 * - api_request:       任意ルートを直接叩く脱出ハッチ
 * - whoami:            GET /auth/me による疎通・認証確認
 */

import { z } from 'zod';
import { ok, wrap } from '../lib/api.mjs';
import { listOperations } from '../lib/openapi.mjs';

export function registerTools(server, call) {
  server.tool(
    'list_capabilities',
    'バックエンドの OpenAPI 全ルート（約292操作）をタグ（ドメイン）別に列挙する。' +
      'curated ツールにない操作（管理系・一括置換シート・添付・AI生成・スナップショット等）はまずこれで探し、' +
      '見つけた method/path を api_request で叩くこと。domain でタグ名を部分一致フィルタできる' +
      '（例: "GAP", "添付", "KPI", "DFD", "Business Flows"）。',
    {
      domain: z
        .string()
        .optional()
        .describe('タグ名の部分一致フィルタ（大文字小文字無視）。省略時は全タグを返す'),
    },
    async ({ domain } = {}) => {
      try {
        return ok(await listOperations(domain));
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    },
  );

  server.tool(
    'api_request',
    'OpenAPI の任意ルートを直接叩く汎用フォールバック。curated ツールに無い操作' +
      '（GAP の /resolve・/reopen、フェーズの /transition、スナップショット、一括置換シート、添付メタ更新、AI生成系など）を網羅する。' +
      'path は /projects/xxx/... のような形式で指定（/api プレフィックスは不要）。' +
      '使う前に list_capabilities で正確な method/path を確認すること。',
    {
      method: z
        .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
        .describe('HTTP メソッド'),
      path: z
        .string()
        .describe('API パス（例: /gap-items/abc123/resolve）。/api プレフィックスは付けない'),
      query: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe('クエリパラメータ（キー: 値）'),
      body: z.any().optional().describe('リクエストボディ（JSON）。GET/DELETE では通常省略'),
    },
    wrap(({ method, path, query, body }) => call(method, path, { body, query })),
  );

  server.tool(
    'whoami',
    '現在の認証ユーザー情報を取得する（GET /auth/me）。AIDATAFLOW_API_KEY の疎通・権限確認用スモークテスト。' +
      'まず最初にこれを呼んで接続を確認するとよい。',
    {},
    wrap(() => call('GET', '/auth/me')),
  );
}
