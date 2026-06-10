'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
import { Users, Plus, User, Server, HelpCircle, Pencil, Trash2, Loader2, ChevronLeft } from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { systemApi, type SystemMaster } from '@/lib/masters';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type RoleData = {
  id: string;
  name: string;
  type: string;
  description?: string;
  color: string;
  usageCount?: number;
  /** 紐づくシステムID（type=SYSTEM のとき）。未指定なら null。 */
  systemId?: string | null;
};

// システム種別ラベル（周辺／対象）。一覧の表示で利用。
const systemKindLabel: Record<SystemMaster['kind'], string> = {
  PERIPHERAL: '周辺',
  TARGET: '対象',
};

const roleTypeConfig = {
  HUMAN: { label: '人', icon: User, color: 'text-blue-600' },
  SYSTEM: { label: 'システム', icon: Server, color: 'text-green-600' },
  OTHER: { label: 'その他', icon: HelpCircle, color: 'text-yellow-600' },
};

export default function ProjectRolesPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [roles, setRoles] = useState<RoleData[]>([]);
  // 共通マスタのシステム一覧（type=SYSTEM のロールに紐付ける）。
  const [systems, setSystems] = useState<SystemMaster[]>([]);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [newRole, setNewRole] = useState({
    name: '',
    type: 'HUMAN',
    description: '',
    color: '#3B82F6',
    systemId: '' as string,
  });
  // 編集ダイアログ用の状態（対象ロールと編集フォーム）。
  const [editingRole, setEditingRole] = useState<RoleData | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    type: 'HUMAN',
    description: '',
    color: '#3B82F6',
    systemId: '' as string,
  });

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchRoles = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles/project/${projectId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setRoles(data);
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  // 共通マスタのシステム一覧を取得（システム種別ロールの紐付け候補に使う）。
  const fetchSystems = useCallback(async () => {
    try {
      const data = await systemApi.list(projectId);
      setSystems(data);
    } catch (err) {
      console.error('Failed to fetch systems:', err);
    }
  }, [projectId]);

  useEffect(() => {
    fetchRoles();
    fetchSystems();
  }, [fetchRoles, fetchSystems]);

  const handleCreateRole = async () => {
    if (!newRole.name) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          name: newRole.name,
          type: newRole.type,
          description: newRole.description || null,
          color: newRole.color,
          // システム種別のときだけ紐付けを送る（未選択は null）。
          systemId: newRole.type === 'SYSTEM' ? newRole.systemId || null : null,
        }),
      });
      if (res.ok) {
        await fetchRoles();
        setIsCreateDialogOpen(false);
        setNewRole({ name: '', type: 'HUMAN', description: '', color: '#3B82F6', systemId: '' });
      }
    } catch (err) {
      console.error('Failed to create role:', err);
    }
  };

  // 編集ダイアログを開き、対象ロールの値をフォームに展開する。
  const openEditDialog = (role: RoleData) => {
    setEditingRole(role);
    setEditForm({
      name: role.name,
      type: role.type,
      description: role.description || '',
      color: role.color,
      systemId: role.systemId || '',
    });
  };

  const handleUpdateRole = async () => {
    if (!editingRole || !editForm.name) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles/${editingRole.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          name: editForm.name,
          type: editForm.type,
          description: editForm.description || null,
          color: editForm.color,
          // システム種別のときだけ紐付けを送る（未選択は null で解除）。
          systemId: editForm.type === 'SYSTEM' ? editForm.systemId || null : null,
        }),
      });
      if (res.ok) {
        await fetchRoles();
        setEditingRole(null);
      }
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (!confirm('このロールを削除しますか？')) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        await fetchRoles();
      }
    } catch (err) {
      console.error('Failed to delete role:', err);
    }
  };

  const colorOptions = [
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16',
  ];

  // キーボードショートカット
  const openHowTo = useCallback(() => {
    document
      .getElementById('howto-trigger-roles')
      ?.querySelector<HTMLButtonElement>('button')
      ?.click();
  }, []);

  useKeyboardShortcuts([
    { combo: 'n', handler: () => setIsCreateDialogOpen(true) },
    { combo: 'mod+enter', handler: () => setIsCreateDialogOpen(true) },
    { combo: 'shift+/', handler: openHowTo },
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="w-4 h-4 mr-1" />
              戻る
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-3xl font-bold text-gray-900">ロール管理</h1>
              <HelpTooltip text="ロールとは業務フローの「スイムレーン」に並ぶ担当主体です。人（顧客・営業など）／システム（基幹システム・外部APIなど）／その他に分類し、誰が・何が処理を担うのかを表します。" />
            </div>
            <p className="text-gray-500 mt-1">業務を担当する主体（人・システム）を定義</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span id="howto-trigger-roles" className="contents">
            <HowToPanel
              steps={[
                '「ロール追加」を押し、ロール名（例：顧客、受注システム）を入力します。',
                '種別を 人／システム／その他 から選びます。種別ごとにアイコン（人＝User／システム＝Server）と色で区別されます。',
                '種別が「システム」のときは、共通マスタのシステム（周辺／対象）を紐付けられます。',
                'スイムレーンカラーを選びます。この色は業務フロー図のレーンの色として使われます。',
                '作成したロールは各カードの編集ボタンから種別・紐付けシステム・色などを変更でき、削除や使用中フロー数の確認もできます。',
              ]}
              shortcuts={[
                { keys: 'N', desc: 'ロール追加ダイアログを開く' },
                { keys: '⌘/Ctrl+Enter', desc: 'ロール追加ダイアログを開く' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </span>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              ロール追加
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-white border-gray-200">
            <DialogHeader>
              <DialogTitle className="text-gray-900">新規ロール作成</DialogTitle>
              <DialogDescription className="text-gray-500">
                業務フローで使用するロールを追加します
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-gray-700">ロール名</Label>
                <Input
                  value={newRole.name}
                  onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                  placeholder="顧客"
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">種別</Label>
                <Select
                  value={newRole.type}
                  onValueChange={(value) => setNewRole({ ...newRole, type: value })}
                >
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="HUMAN" className="text-gray-700">人</SelectItem>
                    <SelectItem value="SYSTEM" className="text-gray-700">システム</SelectItem>
                    <SelectItem value="OTHER" className="text-gray-700">その他</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* システム種別のときだけ、共通マスタのシステムを紐付ける選択を出す。 */}
              {newRole.type === 'SYSTEM' && (
                <div className="space-y-2">
                  <Label className="text-gray-700">紐付けシステム</Label>
                  <Select
                    value={newRole.systemId || '__none__'}
                    onValueChange={(value) =>
                      setNewRole({ ...newRole, systemId: value === '__none__' ? '' : value })
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                      <SelectValue placeholder="システムを選択" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200">
                      <SelectItem value="__none__" className="text-gray-500">未設定</SelectItem>
                      {systems.map((sys) => (
                        <SelectItem key={sys.id} value={sys.id} className="text-gray-700">
                          {sys.name}（{systemKindLabel[sys.kind]}）
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label className="text-gray-700">説明</Label>
                <Input
                  value={newRole.description}
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                  placeholder="ロールの説明"
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">カラー</Label>
                <div className="flex gap-2">
                  {colorOptions.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`w-8 h-8 rounded-full border-2 ${
                        newRole.color === color ? 'border-gray-900' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      onClick={() => setNewRole({ ...newRole, color })}
                    />
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)} className="border-gray-300 text-gray-700">
                キャンセル
              </Button>
              <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateRole}>
                作成
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Roles Grid */}
      {roles.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => {
            const typeConfig = roleTypeConfig[role.type as keyof typeof roleTypeConfig] || roleTypeConfig.OTHER;
            const TypeIcon = typeConfig.icon;
            // 紐付けシステム（type=SYSTEM のとき表示。周辺／対象も併記）。
            const linkedSystem = role.systemId
              ? systems.find((s) => s.id === role.systemId)
              : undefined;

            return (
              <Card key={role.id} className="bg-white border-gray-200">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: `${role.color}20` }}
                      >
                        <TypeIcon className="h-5 w-5" style={{ color: role.color }} />
                      </div>
                      <div>
                        <CardTitle className="text-gray-900 text-lg">{role.name}</CardTitle>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-xs ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-gray-900"
                        onClick={() => openEditDialog(role)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-red-600"
                        onClick={() => handleDeleteRole(role.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-500 mb-2">
                    {role.description || '説明なし'}
                  </p>
                  {/* システム種別ロールの紐付けシステム（周辺／対象を併記）。 */}
                  {role.type === 'SYSTEM' && (
                    <div className="flex items-center gap-1.5 mb-4 text-xs">
                      <Server className="h-3.5 w-3.5 text-green-600" />
                      {linkedSystem ? (
                        <span className="text-gray-600">
                          {linkedSystem.name}
                          <span className="text-gray-400">（{systemKindLabel[linkedSystem.kind]}システム）</span>
                        </span>
                      ) : (
                        <span className="text-gray-400">システム未紐付け</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: role.color }}
                      />
                      <span className="text-gray-500">スイムレーンカラー</span>
                    </div>
                    {role.usageCount !== undefined && (
                      <span className="text-gray-500">{role.usageCount} フローで使用中</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Users className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">ロールがまだありません</p>
            <p className="text-sm text-gray-400 mb-4">
              業務フローで使用するロールを追加しましょう
            </p>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              ロール追加
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 編集ダイアログ（種別・紐付けシステム含む） */}
      <Dialog open={!!editingRole} onOpenChange={(open) => { if (!open) setEditingRole(null); }}>
        <DialogContent className="bg-white border-gray-200">
          <DialogHeader>
            <DialogTitle className="text-gray-900">ロール編集</DialogTitle>
            <DialogDescription className="text-gray-500">
              ロールの種別やシステム紐付けを変更します
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-gray-700">ロール名</Label>
              <Input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="顧客"
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">種別</Label>
              <Select
                value={editForm.type}
                onValueChange={(value) => setEditForm({ ...editForm, type: value })}
              >
                <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-gray-200">
                  <SelectItem value="HUMAN" className="text-gray-700">人</SelectItem>
                  <SelectItem value="SYSTEM" className="text-gray-700">システム</SelectItem>
                  <SelectItem value="OTHER" className="text-gray-700">その他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* システム種別のときだけ、共通マスタのシステムを紐付ける選択を出す。 */}
            {editForm.type === 'SYSTEM' && (
              <div className="space-y-2">
                <Label className="text-gray-700">紐付けシステム</Label>
                <Select
                  value={editForm.systemId || '__none__'}
                  onValueChange={(value) =>
                    setEditForm({ ...editForm, systemId: value === '__none__' ? '' : value })
                  }
                >
                  <SelectTrigger className="bg-white border-gray-300 text-gray-900">
                    <SelectValue placeholder="システムを選択" />
                  </SelectTrigger>
                  <SelectContent className="bg-white border-gray-200">
                    <SelectItem value="__none__" className="text-gray-500">未設定</SelectItem>
                    {systems.map((sys) => (
                      <SelectItem key={sys.id} value={sys.id} className="text-gray-700">
                        {sys.name}（{systemKindLabel[sys.kind]}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-gray-700">説明</Label>
              <Input
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="ロールの説明"
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-gray-700">カラー</Label>
              <div className="flex gap-2">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-8 h-8 rounded-full border-2 ${
                      editForm.color === color ? 'border-gray-900' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditForm({ ...editForm, color })}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRole(null)} className="border-gray-300 text-gray-700">
              キャンセル
            </Button>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleUpdateRole}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

