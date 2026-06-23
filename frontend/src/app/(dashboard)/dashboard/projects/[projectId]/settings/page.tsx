'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeft, FolderCog, Users, Loader2, Trash2, AlertTriangle } from 'lucide-react'
import { HelpTooltip } from '@/components/ui/help-tooltip'
import { HowToPanel } from '@/components/ui/how-to-panel'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { useTabParam } from '@/hooks/use-tab-param'
import { useReadOnly } from '@/components/read-only-context'
import { EditGate } from '@/components/edit-gate'
import { ProjectBundleIo } from '@/components/io/ProjectBundleIo'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
}

interface Role {
  id: string;
  name: string;
  type: string;
  color: string;
  description?: string;
}

export default function ProjectSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  // タブ（一般 / ロール）を URL ?tab= で駆動し、左サイドメニューの子項目と同期。
  const [tab, setTab] = useTabParam('general');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchProject = useCallback(async () => {
    try {
      const headers = getHeaders();
      const orgId = 'e42e4464-e601-47f6-bf99-22412af4bfeb'; // TODO: 動的に取得
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/projects/${projectId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setName(data.name);
        setSlug(data.slug || '');
        setDescription(data.description || '');
      }
    } catch (err) {
      console.error('Failed to fetch project:', err);
    }
  }, [projectId, getHeaders]);

  const fetchRoles = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/roles/project/${projectId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setRoles(data);
      }
    } catch (err) {
      console.error('Failed to fetch roles:', err);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([fetchProject(), fetchRoles()]);
      setLoading(false);
    };
    load();
  }, [fetchProject, fetchRoles]);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    setMessage(null);
    try {
      const headers = getHeaders();
      const orgId = 'e42e4464-e601-47f6-bf99-22412af4bfeb';
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/projects/${projectId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name, slug, description }),
      });
      
      if (res.ok) {
        setMessage({ type: 'success', text: 'プロジェクト設定を保存しました' });
        fetchProject();
      } else {
        throw new Error('Failed to save');
      }
    } catch (err) {
      setMessage({ type: 'error', text: '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const headers = getHeaders();
      const orgId = 'e42e4464-e601-47f6-bf99-22412af4bfeb';
      const res = await fetch(`${API_URL}/api/organizations/${orgId}/projects/${projectId}`, {
        method: 'DELETE',
        headers,
      });
      
      if (res.ok) {
        router.push('/dashboard/projects');
      } else {
        setMessage({ type: 'error', text: '削除に失敗しました' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: '削除に失敗しました' });
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  // キーボードショートカット
  const openHowTo = useCallback(() => {
    document
      .getElementById('howto-trigger-settings')
      ?.querySelector<HTMLButtonElement>('button')
      ?.click();
  }, []);

  useKeyboardShortcuts([
    {
      combo: 'mod+s',
      whenTyping: true,
      handler: () => {
        if (!saving && canEdit) handleSave();
      },
    },
    { combo: 'shift+/', handler: openHowTo },
  ]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/projects">
          <Button variant="ghost" className="text-gray-600">
            <ArrowLeft className="w-4 h-4 mr-2" />
            プロジェクト一覧
          </Button>
        </Link>
        <Card className="bg-white border-gray-200">
          <CardContent className="py-8 text-center">
            <p className="text-gray-500">プロジェクトが見つかりません</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" className="text-gray-600">
              <ArrowLeft className="w-4 h-4 mr-2" />
              戻る
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">プロジェクト設定</h1>
            <p className="text-gray-500 mt-1">{project.name} の設定を管理</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectBundleIo
            projectId={projectId}
            projectName={project.name}
            canEdit={canEdit}
            onDone={() => {
              if (typeof window !== 'undefined') window.location.reload();
            }}
          />
          <span id="howto-trigger-settings" className="contents">
            <HowToPanel
              steps={[
                '「基本設定」タブでプロジェクト名・スラッグ・説明を編集し、「保存」を押します。',
                '「ロール」タブでは登録済みロールの一覧を確認できます（追加・編集はロール管理ページへ）。',
                '不要になったプロジェクトは「危険ゾーン」から削除できます（テーブル・フロー・ロールも全削除）。',
                '「プロジェクト全体をエクスポート/インポート」で、プロジェクト全体を1つのJSONとして保存・取り込みできます。',
                '入力中でも ⌘/Ctrl+S で保存できます。',
              ]}
              shortcuts={[
                { keys: '⌘/Ctrl+S', desc: '基本設定を保存' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </span>
        </div>
      </div>

      {/* メッセージ表示 */}
      {message && (
        <div
          className={`p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-6">
        <TabsList className="bg-gray-100 border border-gray-200">
          <TabsTrigger value="general" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <FolderCog className="h-4 w-4 mr-2" />
            基本設定
          </TabsTrigger>
          <TabsTrigger value="roles" className="data-[state=active]:bg-white data-[state=active]:text-gray-900">
            <Users className="h-4 w-4 mr-2" />
            ロール
          </TabsTrigger>
        </TabsList>

        {/* General Tab */}
        <TabsContent value="general">
          <EditGate dim={false}>
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900">基本設定</CardTitle>
              <CardDescription className="text-gray-500">
                プロジェクトの基本情報を設定します
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-gray-700">プロジェクト名</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-gray-700">スラッグ</Label>
                  <HelpTooltip text="URLに使われる識別子です。半角英数字とハイフンで構成し、プロジェクトを短く一意に表します（例：sales-system）。変更すると共有済みのURLが変わる点に注意してください。" />
                </div>
                <Input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                  placeholder="project-slug"
                />
                <p className="text-xs text-gray-500">URLに使用される識別子です</p>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">説明</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-white border-gray-300 text-gray-900"
                  rows={3}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  保存
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 危険ゾーン */}
          <Card className="bg-white border-red-200 mt-6">
            <CardHeader>
              <CardTitle className="text-red-700 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                危険ゾーン
                <HelpTooltip text="ここでの操作は取り消せません。プロジェクトを削除すると、紐づくテーブル・業務フロー・ロール・要求定義などすべてのデータが完全に失われます。実行前に必ず確認してください。" />
              </CardTitle>
              <CardDescription className="text-gray-500">
                この操作は取り消せません
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-4 border border-red-200 rounded-lg bg-red-50">
                <div>
                  <h4 className="font-medium text-red-900">プロジェクトを削除</h4>
                  <p className="text-sm text-red-700">
                    このプロジェクトとすべてのデータが完全に削除されます
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="bg-red-600 hover:bg-red-700"
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  削除
                </Button>
              </div>
            </CardContent>
          </Card>
          </EditGate>
        </TabsContent>

        {/* Roles Tab */}
        <TabsContent value="roles">
          <Card className="bg-white border-gray-200">
            <CardHeader>
              <CardTitle className="text-gray-900 flex items-center gap-1.5">
                ロール管理
                <HelpTooltip text="ロールは業務フロー図のスイムレーンに対応する担当主体（人・システム・その他）です。ここでは一覧確認のみで、追加・編集・色の変更は「ロール管理ページへ」から行います。" />
              </CardTitle>
              <CardDescription className="text-gray-500">
                業務フローで使用するロールを管理します
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {roles.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    ロールがありません
                  </p>
                ) : (
                  <div className="divide-y divide-gray-200">
                    {roles.map((role) => (
                      <div
                        key={role.id}
                        className="flex items-center justify-between py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-4 h-4 rounded-full"
                            style={{ backgroundColor: role.color }}
                          />
                          <div>
                            <p className="font-medium text-gray-900">{role.name}</p>
                            <p className="text-sm text-gray-500">{role.type}</p>
                          </div>
                        </div>
                        <Link href={`/dashboard/projects/${projectId}/roles`}>
                          <Button variant="ghost" size="sm" className="text-gray-600">
                            編集
                          </Button>
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
                <div className="pt-4 border-t border-gray-200">
                  <Link href={`/dashboard/projects/${projectId}/roles`}>
                    <Button variant="outline" className="w-full">
                      ロール管理ページへ
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 削除確認モーダル */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              プロジェクトを削除しますか？
            </h3>
            <p className="text-gray-600 mb-6">
              「{project.name}」とすべてのテーブル、業務フロー、ロールが完全に削除されます。
              この操作は取り消せません。
            </p>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
              >
                キャンセル
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={saving}
                className="bg-red-600 hover:bg-red-700"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                削除する
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

