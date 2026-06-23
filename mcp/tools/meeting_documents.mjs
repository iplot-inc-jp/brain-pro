/**
 * 会議（Meeting）と会議別ドキュメント（MeetingDocument）。
 *
 * IPROくん（AIアシスタント）がこの領域に Google 関係のもの
 * （Googleドキュメント / スプレッドシート / スライド / Drive ファイルのリンク）を
 * 「会議別ドキュメント」として保存できるようにするツール群。
 *
 * ドキュメント種別:
 *   - INTERNAL   : アプリ内のリアルタイム共同編集本文（Liveblocks）。本文はAPIでは保存しない。
 *   - GOOGLE_DOC : 外部 Google ドキュメント等の URL（googleDocUrl）。← Google関係の保存はこちら。
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  // ---- 会議（Meeting） ----
  server.tool(
    'meeting_list',
    '会議（ミーティング）一覧を取得する。会議別ドキュメントを保存する先（meetingId）を知るために使う。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/meetings`)),
  );

  server.tool(
    'meeting_create',
    '会議（ミーティング）を作成する。会議別ドキュメントの保存先が無いときに先に作る。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('会議名（例: 発注DX週次定例）'),
      purpose: z.string().optional().describe('目的'),
      frequency: z.string().optional().describe('頻度（例: 週次 / 月次）'),
      goal: z.string().optional().describe('ゴール/アウトプット'),
      note: z.string().optional().describe('メモ'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/meetings`, { body })),
  );

  // ---- 会議別ドキュメント（MeetingDocument） ----
  server.tool(
    'meeting_document_list',
    '会議別ドキュメント一覧を取得する。meetingId を指定するとその会議の分のみ。',
    {
      projectId: z.string().describe('プロジェクトID'),
      meetingId: z.string().optional().describe('会議IDで絞り込む（任意）'),
    },
    wrap(({ projectId, meetingId }) =>
      call('GET', `/projects/${projectId}/meeting-documents`, {
        query: meetingId ? { meetingId } : undefined,
      }),
    ),
  );

  server.tool(
    'meeting_document_create',
    [
      '会議別ドキュメントを作成する。',
      'Google関係のもの（Googleドキュメント/スプレッドシート/スライド/Driveファイルのリンク）を保存するときは',
      "kind='GOOGLE_DOC' とし googleDocUrl に共有URL（https://docs.google.com/... もしくは https://drive.google.com/...）を渡す。",
      "アプリ内で編集する本文を作るときは kind='INTERNAL'（本文は別途アプリ上で編集）。",
    ].join(' '),
    {
      projectId: z.string().describe('プロジェクトID'),
      meetingId: z.string().describe('保存先の会議ID（meeting_list で取得）'),
      kind: z
        .enum(['INTERNAL', 'GOOGLE_DOC'])
        .optional()
        .describe('種別（既定 INTERNAL）。Googleリンク保存は GOOGLE_DOC'),
      title: z.string().optional().describe('ドキュメントのタイトル'),
      googleDocUrl: z
        .string()
        .optional()
        .describe('GOOGLE_DOC のとき: Googleドキュメント/シート/スライド/Drive の共有URL'),
    },
    wrap(({ projectId, ...body }) =>
      call('POST', `/projects/${projectId}/meeting-documents`, { body }),
    ),
  );

  server.tool(
    'meeting_document_update',
    '既存の会議別ドキュメントを更新する（タイトル / GoogleURL / 所属会議 / 並び順）。',
    {
      id: z.string().describe('会議別ドキュメントID'),
      title: z.string().optional().describe('タイトル'),
      googleDocUrl: z
        .string()
        .nullable()
        .optional()
        .describe('Google URL（null で解除）。GOOGLE_DOC のリンク差し替えに使う'),
      meetingId: z.string().optional().describe('別の会議へ移動する場合の会議ID'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ id, ...body }) => call('PATCH', `/meeting-documents/${id}`, { body })),
  );

  server.tool(
    'meeting_document_delete',
    '会議別ドキュメントを削除する。',
    {
      id: z.string().describe('会議別ドキュメントID'),
    },
    wrap(({ id }) => call('DELETE', `/meeting-documents/${id}`)),
  );
}
