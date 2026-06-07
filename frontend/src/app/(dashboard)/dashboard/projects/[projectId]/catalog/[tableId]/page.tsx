'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table as TableIcon,
  ArrowLeft,
  Plus,
  Trash2,
  Key,
  Link as LinkIcon,
  Loader2,
  GitBranch,
  User,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Column = {
  id: string;
  name: string;
  displayName?: string;
  dataType: string;
  description?: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isNullable: boolean;
  isUnique: boolean;
  foreignKeyTable?: string;
  foreignKeyColumn?: string;
  order: number;
};

type CrudMapping = {
  id: string;
  columnId: string;
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';
  roleId: string;
  flowId?: string;
  flowNodeId?: string;
  how?: string;
  condition?: string;
  description?: string;
  role?: { id: string; name: string; color: string };
  flow?: { id: string; name: string };
  flowNode?: { id: string; label: string };
};

type TableData = {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  tags: string[];
  columns: Column[];
  projectId: string;
};

type Role = {
  id: string;
  name: string;
  color: string;
  type: string;
};

type Flow = {
  id: string;
  name: string;
  depth: number;
};

export default function ProjectTableDetailPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const tableId = params.tableId as string;

  const [tableData, setTableData] = useState<TableData | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [crudMappings, setCrudMappings] = useState<Record<string, CrudMapping[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<Column | null>(null);
  const [isAddMappingOpen, setIsAddMappingOpen] = useState(false);
  const [newMapping, setNewMapping] = useState({
    operation: 'CREATE' as const,
    roleId: '',
    flowId: '',
    how: '',
    description: '',
  });

  const howToRef = useRef<HTMLSpanElement>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  // テーブルデータ取得
  const fetchTableData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();

      // テーブル詳細取得
      const tableRes = await fetch(`${API_URL}/api/tables/${tableId}`, { headers });
      if (!tableRes.ok) throw new Error('Failed to fetch table');
      const table = await tableRes.json();
      
      // エラーチェック
      if (table.error) {
        throw new Error(table.error);
      }
      
      // columnsが配列でない場合は空配列をセット
      if (!Array.isArray(table.columns)) {
        table.columns = [];
      }
      
      setTableData(table);

      // 各カラムのCRUDマッピング取得
      const mappingsMap: Record<string, CrudMapping[]> = {};
      for (const column of table.columns) {
        const mappingRes = await fetch(
          `${API_URL}/api/tables/${tableId}/columns/${column.id}/crud-mappings`,
          { headers }
        );
        if (mappingRes.ok) {
          mappingsMap[column.id] = await mappingRes.json();
        }
      }
      setCrudMappings(mappingsMap);

      // ロール取得
      const rolesRes = await fetch(`${API_URL}/api/roles/project/${projectId}`, { headers });
      if (rolesRes.ok) setRoles(await rolesRes.json());

      // フロー取得
      const flowsRes = await fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
        headers,
      });
      if (flowsRes.ok) setFlows(await flowsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [tableId, projectId, getHeaders]);

  useEffect(() => {
    fetchTableData();
  }, [fetchTableData]);

  // キーボードショートカット
  const openFirstColumnMapping = useCallback(() => {
    const first = tableData?.columns?.[0];
    if (!first) return;
    setSelectedColumn(first);
    setIsAddMappingOpen(true);
  }, [tableData]);

  useKeyboardShortcuts([
    { combo: 'mod+enter', handler: () => openFirstColumnMapping() },
    { combo: 'n', handler: () => openFirstColumnMapping() },
    { combo: 'escape', handler: () => setIsAddMappingOpen(false) },
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
  ]);

  // CRUDマッピング追加
  const handleAddMapping = async () => {
    if (!selectedColumn || !newMapping.roleId) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/tables/crud-mappings`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          columnId: selectedColumn.id,
          operation: newMapping.operation,
          roleId: newMapping.roleId,
          flowId: newMapping.flowId || null,
          how: newMapping.how || null,
          description: newMapping.description || null,
        }),
      });

      if (res.ok) {
        // 再取得
        const mappingRes = await fetch(
          `${API_URL}/api/tables/${tableId}/columns/${selectedColumn.id}/crud-mappings`,
          { headers }
        );
        if (mappingRes.ok) {
          const newMappings = await mappingRes.json();
          setCrudMappings((prev) => ({
            ...prev,
            [selectedColumn.id]: newMappings,
          }));
        }
        setIsAddMappingOpen(false);
        setNewMapping({ operation: 'CREATE', roleId: '', flowId: '', how: '', description: '' });
      }
    } catch (err) {
      console.error('Failed to add mapping:', err);
    }
  };

  // CRUDマッピング削除
  const handleDeleteMapping = async (mappingId: string, columnId: string) => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/tables/crud-mappings/${mappingId}`, {
        method: 'DELETE',
        headers,
      });

      if (res.ok) {
        setCrudMappings((prev) => ({
          ...prev,
          [columnId]: prev[columnId].filter((m) => m.id !== mappingId),
        }));
      }
    } catch (err) {
      console.error('Failed to delete mapping:', err);
    }
  };

  const operationColors = {
    CREATE: 'bg-green-100 text-green-800 border-green-300',
    READ: 'bg-blue-100 text-blue-800 border-blue-300',
    UPDATE: 'bg-amber-100 text-amber-800 border-amber-300',
    DELETE: 'bg-red-100 text-red-800 border-red-300',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !tableData) {
    return (
      <div className="space-y-4">
        <Link href={`/dashboard/projects/${projectId}/catalog`}>
          <Button variant="ghost" className="text-gray-600">
            <ArrowLeft className="w-4 h-4 mr-2" />
            カタログに戻る
          </Button>
        </Link>
        <Card className="bg-white border-red-200">
          <CardContent className="py-8 text-center">
            <p className="text-red-600">{error || 'テーブルが見つかりません'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}/catalog`}>
            <Button variant="ghost" className="text-gray-600">
              <ArrowLeft className="w-4 h-4 mr-2" />
              カタログ
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <TableIcon className="w-6 h-6 text-blue-600" />
              {tableData.displayName || tableData.name}
            </h1>
            <code className="text-sm text-gray-500">{tableData.name}</code>
          </div>
        </div>
        <span ref={howToRef} className="inline-flex">
          <HowToPanel
            steps={[
              'このテーブルが持つカラム（項目）の一覧です。鍵アイコン＝主キー(PK)、リンクアイコン＝外部キー(FK)を表します。',
              'カラムごとに「CRUD追加」を押すと、そのカラムを「どのロールが・どの業務フローで・どう操作するか」を定義できます。',
              'CRUD操作タイプはC（作成）/R（参照）/U（更新）/D（削除）。ロールと業務フロー（任意）を紐付けると、CRUD表やER図に反映されます。',
              '不要なCRUD操作はゴミ箱アイコンで削除できます。',
            ]}
            shortcuts={[
              { keys: '⌘/Ctrl+Enter', desc: '先頭カラムのCRUD追加を開く' },
              { keys: 'n', desc: '先頭カラムのCRUD追加を開く' },
              { keys: 'Esc', desc: 'CRUD追加ダイアログを閉じる' },
              { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
            ]}
          />
        </span>
      </div>

      {tableData.description && (
        <p className="text-gray-600">{tableData.description}</p>
      )}

      {/* タグ */}
      {tableData.tags && tableData.tags.length > 0 && (
        <div className="flex gap-2">
          {tableData.tags.map((tag) => (
            <span key={tag} className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* カラム一覧 */}
      <Card className="bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="text-gray-900 flex items-center gap-2">
            カラム一覧
            <HelpTooltip text="カラム＝テーブルの各項目（列）。鍵アイコンは主キー(PK＝行を一意に識別する項目)、リンクアイコンは外部キー(FK＝他テーブルを参照する項目)を表します。" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tableData.columns.length === 0 ? (
            <p className="text-gray-500 text-center py-8">カラムがありません</p>
          ) : (
            <div className="space-y-4">
              {tableData.columns.map((column) => (
                <div key={column.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        {column.isPrimaryKey && (
                          <span title="Primary Key">
                            <Key className="w-4 h-4 text-amber-500" />
                          </span>
                        )}
                        {column.isForeignKey && (
                          <span title="Foreign Key">
                            <LinkIcon className="w-4 h-4 text-blue-500" />
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">
                          {column.displayName || column.name}
                        </div>
                        <code className="text-xs text-gray-500">{column.name}</code>
                        <span className="ml-2 text-xs text-gray-400">{column.dataType}</span>
                      </div>
                    </div>
                    <Dialog
                      open={isAddMappingOpen && selectedColumn?.id === column.id}
                      onOpenChange={(open) => {
                        setIsAddMappingOpen(open);
                        if (open) setSelectedColumn(column);
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedColumn(column)}
                        >
                          <Plus className="w-4 h-4 mr-1" />
                          CRUD追加
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="bg-white border-gray-200">
                        <DialogHeader>
                          <DialogTitle className="text-gray-900">CRUD操作を追加</DialogTitle>
                          <DialogDescription className="text-gray-500">
                            {column.displayName || column.name} に対するCRUD操作を定義
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label className="text-gray-700 flex items-center gap-1.5">
                              操作タイプ
                              <HelpTooltip text="CRUD＝データに対する4つの基本操作。C=Create(作成)、R=Read(参照)、U=Update(更新)、D=Delete(削除)。「誰がこのカラムに対して何をできるか」を1操作ずつ定義します。" />
                            </Label>
                            <Select
                              value={newMapping.operation}
                              onValueChange={(v) =>
                                setNewMapping({ ...newMapping, operation: v as any })
                              }
                            >
                              <SelectTrigger className="bg-white border-gray-300">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-white">
                                <SelectItem value="CREATE">CREATE (作成)</SelectItem>
                                <SelectItem value="READ">READ (参照)</SelectItem>
                                <SelectItem value="UPDATE">UPDATE (更新)</SelectItem>
                                <SelectItem value="DELETE">DELETE (削除)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-700">ロール</Label>
                            <Select
                              value={newMapping.roleId}
                              onValueChange={(v) => setNewMapping({ ...newMapping, roleId: v })}
                            >
                              <SelectTrigger className="bg-white border-gray-300">
                                <SelectValue placeholder="ロールを選択" />
                              </SelectTrigger>
                              <SelectContent className="bg-white">
                                {roles.map((role) => (
                                  <SelectItem key={role.id} value={role.id}>
                                    <span className="flex items-center gap-2">
                                      <span
                                        className="w-3 h-3 rounded-full"
                                        style={{ backgroundColor: role.color }}
                                      />
                                      {role.name}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-700">業務フロー（任意）</Label>
                            <Select
                              value={newMapping.flowId}
                              onValueChange={(v) =>
                                setNewMapping({ ...newMapping, flowId: v === '__none__' ? '' : v })
                              }
                            >
                              <SelectTrigger className="bg-white border-gray-300">
                                <SelectValue placeholder="フローを選択（任意）" />
                              </SelectTrigger>
                              <SelectContent className="bg-white">
                                <SelectItem value="__none__">なし</SelectItem>
                                {flows.map((flow) => (
                                  <SelectItem key={flow.id} value={flow.id}>
                                    {'　'.repeat(flow.depth)}{flow.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-700 flex items-center gap-1.5">
                              どのように操作するか
                              <HelpTooltip text="その操作の具体的な「打ち手（実装方針）」を一言で。例：ユーザー入力値をそのまま保存／承認後に自動採番／論理削除フラグを立てる。後工程の実装やレビューの手がかりになります。" />
                            </Label>
                            <Input
                              value={newMapping.how}
                              onChange={(e) => setNewMapping({ ...newMapping, how: e.target.value })}
                              placeholder="例: ユーザー入力値をそのまま保存"
                              className="bg-white border-gray-300"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-gray-700">説明</Label>
                            <Input
                              value={newMapping.description}
                              onChange={(e) =>
                                setNewMapping({ ...newMapping, description: e.target.value })
                              }
                              placeholder="この操作の説明"
                              className="bg-white border-gray-300"
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsAddMappingOpen(false)}>
                            キャンセル
                          </Button>
                          <Button
                            onClick={handleAddMapping}
                            disabled={!newMapping.roleId}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            追加
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  {column.description && (
                    <p className="text-sm text-gray-500 mt-2">{column.description}</p>
                  )}

                  {/* CRUDマッピング表示 */}
                  {crudMappings[column.id] && crudMappings[column.id].length > 0 && (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-medium text-gray-500 uppercase">CRUD操作</div>
                      <div className="space-y-2">
                        {crudMappings[column.id].map((mapping) => {
                          const role = roles.find((r) => r.id === mapping.roleId);
                          const flow = flows.find((f) => f.id === mapping.flowId);

                          return (
                            <div
                              key={mapping.id}
                              className={`flex items-center justify-between p-2 rounded-lg border ${
                                operationColors[mapping.operation]
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-mono font-bold text-sm">
                                  {mapping.operation.charAt(0)}
                                </span>
                                <div className="text-sm">
                                  <div className="flex items-center gap-2">
                                    {role && (
                                      <span className="flex items-center gap-1">
                                        <User className="w-3 h-3" />
                                        <span
                                          className="px-2 py-0.5 rounded-full text-xs"
                                          style={{
                                            backgroundColor: `${role.color}20`,
                                            color: role.color,
                                          }}
                                        >
                                          {role.name}
                                        </span>
                                      </span>
                                    )}
                                    {flow && (
                                      <Link
                                        href={`/dashboard/projects/${projectId}/flows/${flow.id}`}
                                        className="flex items-center gap-1 text-gray-600 hover:text-blue-600"
                                      >
                                        <GitBranch className="w-3 h-3" />
                                        <span className="text-xs">{flow.name}</span>
                                      </Link>
                                    )}
                                  </div>
                                  {mapping.how && (
                                    <div className="text-xs text-gray-600 mt-0.5">{mapping.how}</div>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-gray-400 hover:text-red-600"
                                onClick={() => handleDeleteMapping(mapping.id, column.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

