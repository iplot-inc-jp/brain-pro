/**
 * データカタログ（テーブル/カラム/CRUD）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'table_list',
    'プロジェクトのテーブル一覧を取得する（データカタログ）。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/tables/project/${projectId}`)),
  );

  server.tool(
    'table_get',
    'テーブル詳細を取得する（カラム含む）。',
    {
      id: z.string().describe('テーブルID'),
    },
    wrap(({ id }) => call('GET', `/tables/${id}`)),
  );

  server.tool(
    'table_create',
    'テーブルを作成する。informationTypeId で情報種別マスタに紐付けられる。',
    {
      projectId: z.string().describe('プロジェクトID'),
      name: z.string().describe('テーブル物理名（例: orders）'),
      displayName: z.string().optional().describe('表示名（例: 受注）'),
      description: z.string().optional().describe('説明'),
      tags: z.array(z.string()).optional().describe('タグの配列'),
      informationTypeId: z.string().optional().describe('紐づく情報種別マスタID'),
    },
    wrap((body) => call('POST', '/tables', { body })),
  );

  server.tool(
    'table_update',
    'テーブルを更新する。',
    {
      id: z.string().describe('テーブルID'),
      name: z.string().optional().describe('テーブル物理名'),
      displayName: z.string().optional().describe('表示名'),
      description: z.string().optional().describe('説明'),
      tags: z.array(z.string()).optional().describe('タグの配列'),
      informationTypeId: z.string().nullable().optional().describe('情報種別マスタID（null で解除）'),
    },
    wrap(({ id, ...body }) => call('PUT', `/tables/${id}`, { body })),
  );

  server.tool(
    'column_create',
    'テーブルにカラムを作成する。',
    {
      tableId: z.string().describe('テーブルID'),
      name: z.string().describe('カラム物理名（例: order_id）'),
      displayName: z.string().optional().describe('表示名'),
      dataType: z.string().optional().describe('データ型（例: varchar, int, timestamp）'),
      description: z.string().optional().describe('説明'),
      isPrimaryKey: z.boolean().optional().describe('主キーか'),
      isForeignKey: z.boolean().optional().describe('外部キーか'),
      isNullable: z.boolean().optional().describe('NULL 許可か'),
      isUnique: z.boolean().optional().describe('一意制約か'),
      defaultValue: z.string().optional().describe('デフォルト値'),
      foreignKeyTable: z.string().optional().describe('参照先テーブル名（FKの場合）'),
      foreignKeyColumn: z.string().optional().describe('参照先カラム名（FKの場合）'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ tableId, ...body }) => call('POST', `/tables/${tableId}/columns`, { body })),
  );

  server.tool(
    'crud_mapping_create',
    'CRUDマッピングを作成する（カラム×ロール×操作。任意でフロー/フローノードに紐付け）。' +
      'columnId と roleId は必須。削除は api_request の DELETE /tables/crud-mappings/:id。',
    {
      columnId: z.string().describe('カラムID'),
      operation: z
        .enum(['CREATE', 'READ', 'UPDATE', 'DELETE'])
        .describe('操作（C/R/U/D）'),
      roleId: z.string().describe('操作するロールID（role_list で取得）'),
      flowId: z.string().optional().describe('紐付ける業務フローID'),
      flowNodeId: z.string().optional().describe('紐付けるフローノードID（工程）'),
      how: z.string().optional().describe('どうやって操作するか'),
      condition: z.string().optional().describe('操作の条件'),
      description: z.string().optional().describe('説明'),
    },
    wrap((body) => call('POST', '/tables/crud-mappings', { body })),
  );
}
