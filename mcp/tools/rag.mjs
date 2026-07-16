/**
 * プロジェクト横断RAG索引。
 *
 * 各機能の情報をClaudeで全体概要／コンポーネント概要へ圧縮し、
 * IPROエージェントが短い検索語や想定質問から元ページを見つけるための入口。
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

const featureType = z.enum([
  'BUSINESS_FLOW',
  'REQUIREMENT',
  'ISSUE_TREE',
  'TASK',
  'STAKEHOLDER',
  'RISK',
  'KPI',
  'SYSTEM',
  'DATA_CATALOG',
  'MEETING',
]);

export function registerTools(server, call) {
  server.tool(
    'rag_search',
    'プロジェクトのRAG索引を横断検索する（view権限）。Claudeで圧縮した概要・キーワード・別名・' +
      '想定質問を検索し、元機能の sourceUrl を返す。qを省略すると最近の索引一覧として使える。' +
      'まずこのツールで候補を絞り、必要なら返却された sourceUrl または各機能の取得ツールで原文を読む。',
    {
      projectId: z.string().describe('検索対象のプロジェクトID'),
      q: z.string().optional().describe('自然文、業務名、別名、キーワード。省略すると索引一覧'),
      featureType: featureType.optional().describe('対象機能で絞り込み'),
      scopeLevel: z.enum(['OVERVIEW', 'COMPONENT']).optional().describe('全体概要または個別要素で絞り込み'),
      limit: z.number().int().min(1).max(50).optional().describe('取得件数。既定20、最大50'),
    },
    wrap(({ projectId, q, featureType: type, scopeLevel, limit }) =>
      call('GET', `/projects/${projectId}/rag/search`, {
        query: { q, featureType: type, scopeLevel, limit },
      }),
    ),
  );

  server.tool(
    'rag_generate',
    '指定機能のRAG概要生成を開始する（edit権限）。Claudeが全体概要とコンポーネント概要を生成し、' +
      '非同期ジョブの { jobId, status } を返す。ai_job_getで完了を確認する。' +
      'targetIdは業務フローまたはイシューツリーの個別ページを索引化するときに指定する。',
    {
      projectId: z.string().describe('プロジェクトID'),
      featureType: featureType.describe('索引化する機能'),
      targetId: z.string().optional().describe('個別の業務フローIDまたはイシューツリーID'),
    },
    wrap(({ projectId, featureType: type, targetId }) =>
      call('POST', `/projects/${projectId}/rag/generate`, {
        body: { featureType: type, ...(targetId ? { targetId } : {}) },
      }),
    ),
  );

  server.tool(
    'rag_status',
    '指定機能のRAG索引状態を取得する（view権限）。UNGENERATED/FRESH/STALE、文書数、生成日時、' +
      'モデル、全体概要を返す。STALEなら元データ更新後の再生成が必要。',
    {
      projectId: z.string().describe('プロジェクトID'),
      featureType: featureType.describe('状態を確認する機能'),
      targetId: z.string().optional().describe('個別の業務フローIDまたはイシューツリーID'),
    },
    wrap(({ projectId, featureType: type, targetId }) =>
      call('GET', `/projects/${projectId}/rag/status`, {
        query: { featureType: type, ...(targetId ? { targetId } : {}) },
      }),
    ),
  );
}
