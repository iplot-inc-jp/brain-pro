/**
 * 共有リンク（図の閲覧URLの発行・取得・無効化）
 *
 * 対象は4種: FLOW（業務フロー図）/ DFD / OBJECT_MAP（オブジェクト関係性マップ）/ ISSUE_TREE。
 * 発行された token から閲覧URLを組み立てて共有する:
 *   https://brain-pro.iplot.jp/share/{flow|dfd|object-map|issue-tree}/<token>
 * （kind→パス: FLOW=flow / DFD=dfd / OBJECT_MAP=object-map / ISSUE_TREE=issue-tree）
 * このURLはチャットに貼るとOGPで図のプレビューが展開される（PUBLICのみ。ORGは中身を出さない）。
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

const KINDS = ['FLOW', 'DFD', 'OBJECT_MAP', 'ISSUE_TREE'];
const SCOPES = ['PUBLIC', 'ORG'];

const kindDesc =
  '共有対象の種別。FLOW=業務フロー図（targetId=フローID）/ DFD（targetId=DFD図ID。dfd_level1_sync 等の応答 id）/ ' +
  'OBJECT_MAP=オブジェクト関係性マップ（targetId=プロジェクトID）/ ISSUE_TREE=イシューツリー（targetId=ツリーID）';

export function registerTools(server, call) {
  server.tool(
    'share_link_get',
    '図の共有リンクの発行状態を取得する（token が null なら未発行）。' +
      '閲覧URLは https://brain-pro.iplot.jp/share/{flow|dfd|object-map|issue-tree}/<token>。',
    {
      projectId: z.string().describe('プロジェクトID'),
      kind: z.enum(KINDS).describe(kindDesc),
      targetId: z.string().describe('共有対象ID（kind の説明を参照）'),
    },
    wrap(({ projectId, kind, targetId }) =>
      call('GET', `/projects/${projectId}/share-links`, {
        query: { kind, targetId },
      }),
    ),
  );

  server.tool(
    'share_link_issue',
    '図の共有リンクを発行する（既にあれば scope のみ更新・token は維持＝配布済みURLはそのまま）。' +
      'scope: PUBLIC=リンクを知っていれば誰でも閲覧（ログイン不要）/ ORG=同組織のログインユーザーのみ。' +
      '返る token から閲覧URLを組み立てる: https://brain-pro.iplot.jp/share/{flow|dfd|object-map|issue-tree}/<token>。' +
      'チャットに貼るとOGPプレビューが展開される（PUBLICのみ図を描画）。',
    {
      projectId: z.string().describe('プロジェクトID'),
      kind: z.enum(KINDS).describe(kindDesc),
      targetId: z.string().describe('共有対象ID（kind の説明を参照）'),
      scope: z.enum(SCOPES).optional().describe('公開範囲（既定 PUBLIC）'),
    },
    wrap(({ projectId, kind, targetId, scope }) =>
      call('POST', `/projects/${projectId}/share-links`, {
        body: { kind, targetId, scope: scope ?? 'PUBLIC' },
      }),
    ),
  );

  server.tool(
    'share_link_revoke',
    '図の共有リンクを無効化する（配布済みURLも開けなくなる）。',
    {
      projectId: z.string().describe('プロジェクトID'),
      kind: z.enum(KINDS).describe(kindDesc),
      targetId: z.string().describe('共有対象ID'),
    },
    wrap(({ projectId, kind, targetId }) =>
      call('DELETE', `/projects/${projectId}/share-links`, {
        query: { kind, targetId },
      }),
    ),
  );
}
