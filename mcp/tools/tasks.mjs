/**
 * タスク（WBS・推進）
 */

import { z } from 'zod';
import { wrap } from '../lib/api.mjs';

export function registerTools(server, call) {
  server.tool(
    'task_list',
    'プロジェクトのタスク一覧を取得する（フラットな tasks[] と dependencies[]）。WBS/ガントの元データ。',
    {
      projectId: z.string().describe('プロジェクトID'),
    },
    wrap(({ projectId }) => call('GET', `/projects/${projectId}/tasks`)),
  );

  server.tool(
    'task_get',
    'タスク詳細を取得する。',
    {
      id: z.string().describe('タスクID'),
    },
    wrap(({ id }) => call('GET', `/tasks/${id}`)),
  );

  server.tool(
    'task_create',
    'タスクを作成する。parentId で WBS の親子化、issueNodeId / riskId でイシュー・リスクへの紐付けができる。',
    {
      projectId: z.string().describe('プロジェクトID'),
      title: z.string().describe('タスク名'),
      description: z.string().optional().describe('説明'),
      parentId: z.string().optional().describe('親タスクID（サブタスクにする場合）'),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional().describe('ステータス'),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().describe('優先度'),
      assigneeName: z.string().optional().describe('担当者名'),
      assigneeRoleId: z.string().optional().describe('担当ロールID'),
      issueNodeId: z.string().optional().describe('紐付けるイシューノードID（ISSUE/CAUSE/COUNTERMEASURE）'),
      riskId: z.string().optional().describe('紐付けるリスクID（リスク対応タスク）'),
      startDate: z.string().optional().describe('開始日（ISO 8601 文字列）'),
      dueDate: z.string().optional().describe('期限日（ISO 8601 文字列）'),
      progress: z.number().optional().describe('進捗（0-100）'),
      estimatedHours: z.number().optional().describe('予定工数（時間）'),
      actualHours: z.number().optional().describe('実績工数（時間）'),
      milestone: z.string().optional().describe('マイルストーン'),
      category: z.string().optional().describe('カテゴリ'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ projectId, ...body }) => call('POST', `/projects/${projectId}/tasks`, { body })),
  );

  server.tool(
    'task_update',
    'タスクを更新する（親付け替え・ステータス・進捗・期日・担当・並び順など）。' +
      'issueNodeId / riskId は null で紐付け解除、省略で変更なし。',
    {
      id: z.string().describe('タスクID'),
      title: z.string().optional().describe('タスク名'),
      description: z.string().optional().describe('説明'),
      parentId: z.string().nullable().optional().describe('親タスクID（null でルート化）'),
      status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional().describe('ステータス'),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional().describe('優先度'),
      assigneeName: z.string().optional().describe('担当者名'),
      assigneeRoleId: z.string().nullable().optional().describe('担当ロールID（null で解除）'),
      issueNodeId: z.string().nullable().optional().describe('イシューノードID（null で解除 / 省略で変更なし）'),
      riskId: z.string().nullable().optional().describe('リスクID（null で解除 / 省略で変更なし）'),
      startDate: z.string().nullable().optional().describe('開始日（ISO 8601）'),
      dueDate: z.string().nullable().optional().describe('期限日（ISO 8601）'),
      progress: z.number().optional().describe('進捗（0-100）'),
      estimatedHours: z.number().nullable().optional().describe('予定工数（時間）'),
      actualHours: z.number().nullable().optional().describe('実績工数（時間）'),
      milestone: z.string().nullable().optional().describe('マイルストーン'),
      category: z.string().nullable().optional().describe('カテゴリ'),
      order: z.number().optional().describe('並び順'),
    },
    wrap(({ id, ...body }) => call('PUT', `/tasks/${id}`, { body })),
  );

  server.tool(
    'task_delete',
    'タスクを削除する（子タスク・依存関係はカスケード削除）。',
    {
      id: z.string().describe('タスクID'),
    },
    wrap(({ id }) => call('DELETE', `/tasks/${id}`)),
  );

  server.tool(
    'task_dependency_add',
    'タスク依存を追加する（id のタスクを後続として、predecessorId の先行タスクに依存させる）。' +
      '削除は api_request の DELETE /tasks/dependencies/:depId。',
    {
      id: z.string().describe('後続タスクID'),
      predecessorId: z.string().describe('先行タスクID（このタスクが終わってから後続を開始する）'),
    },
    wrap(({ id, predecessorId }) => call('POST', `/tasks/${id}/dependencies`, { body: { predecessorId } })),
  );
}
