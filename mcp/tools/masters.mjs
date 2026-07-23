/**
 * マスタ（領域/情報種別/システム/制約/ロール/用語集）
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

  server.tool(
    'glossary_term_list',
    'プロジェクトの用語集を用語対応（mappings）付きで取得する。各用語は「意味(definition)」「正(sourceOfTruth: 値が食い違ったときどこを信じるか)」「名前の対応(mappings)」を持つ。実装前に必ず参照して命名の揺れと値の取り違えを防ぐ。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/glossary-terms`)),
  );

  server.tool(
    'glossary_term_create',
    '用語を作成する。mappings を同時に渡すと用語対応（現場の言い方 / DBカラム / 画面項目 / 電文フィールド / 使用禁止語）もまとめて登録できる。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('正式用語（例: 得意先）'),
      termCode: z.string().optional().describe('概念コード（例: CPT-001）。プロジェクト内で一意'),
      definition: z.string().optional().describe('意味（それは何か）'),
      sourceOfTruth: z
        .string()
        .optional()
        .describe('正（source of truth）: 値が食い違ったときにどこを信じるか（例: 倉庫管理システム）'),
      sourceOfTruthNote: z.string().optional().describe('正の補足（更新経路・更新できる人）'),
      category: z.string().optional().describe('ドメイン分類（例: 取引先 / 商品 / 在庫）'),
      status: z.enum(['APPROVED', 'DRAFT', 'DEPRECATED']).optional().describe('状態'),
      notes: z.string().optional().describe('備考（紛らわしい別概念との違いなど）'),
      order: z.number().optional().describe('並び順'),
      subProjectId: z.string().optional().describe('所属領域（サブプロジェクト）ID'),
      mappings: z
        .array(
          z.object({
            context: z
              .enum(['ALIAS', 'ENGLISH', 'DB', 'SCREEN', 'INTERFACE', 'CODE', 'FORBIDDEN', 'OTHER'])
              .optional()
              .describe(
                'ALIAS=現場の言い方 / ENGLISH=英語 / DB=テーブル.カラム / SCREEN=画面項目 / INTERFACE=電文フィールド / CODE=コード上の識別子 / FORBIDDEN=使ってはいけない言い方 / OTHER',
              ),
            systemName: z.string().optional().describe('どのシステム・電文での呼び名か（例: 基幹DB / WMS電文 / EDI）'),
            value: z.string().describe('実際の名前（例: customer.customer_cd）'),
            note: z.string().optional().describe('補足'),
            order: z.number().optional().describe('並び順'),
          }),
        )
        .optional()
        .describe('用語対応をまとめて登録する場合'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/glossary-terms`, { body })),
  );

  server.tool(
    'glossary_term_update',
    '用語を更新する（意味・正・カテゴリ・状態など）。',
    {
      id: z.string().describe('用語ID'),
      name: z.string().optional().describe('正式用語'),
      termCode: z.string().optional().describe('概念コード'),
      definition: z.string().optional().describe('意味'),
      sourceOfTruth: z.string().optional().describe('正（source of truth）'),
      sourceOfTruthNote: z.string().optional().describe('正の補足'),
      category: z.string().optional().describe('ドメイン分類'),
      status: z.enum(['APPROVED', 'DRAFT', 'DEPRECATED']).optional().describe('状態'),
      notes: z.string().optional().describe('備考'),
      order: z.number().optional().describe('並び順'),
      subProjectId: z.string().optional().describe('所属領域ID'),
    },
    wrap(({ id, ...body }) => call('PATCH', `/glossary-terms/${id}`, { body })),
  );

  server.tool(
    'glossary_mapping_create',
    '既存の用語に用語対応を1件追加する（この概念がどこで何と呼ばれているか）。',
    {
      termId: z.string().describe('用語ID'),
      value: z.string().describe('実際の名前（例: customer.customer_cd）'),
      context: z
        .enum(['ALIAS', 'ENGLISH', 'DB', 'SCREEN', 'INTERFACE', 'CODE', 'FORBIDDEN', 'OTHER'])
        .optional()
        .describe('文脈'),
      systemName: z.string().optional().describe('どのシステム・電文での呼び名か'),
      note: z.string().optional().describe('補足'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ termId, ...body }) => call('POST', `/glossary-terms/${termId}/mappings`, { body })),
  );
}
