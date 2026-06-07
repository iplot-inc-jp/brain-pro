'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChevronLeft,
  Plus,
  Loader2,
  FileText,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Link as LinkIcon,
  Trash2,
  Edit,
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Requirement = {
  id: string;
  code: string;
  title: string;
  description?: string;
  originalText?: string;
  type: string;
  priority: string;
  status: string;
  depth: number;
  order: number;
  children?: Requirement[];
  flowMappings?: any[];
  crudMappings?: any[];
};

const typeLabels: Record<string, string> = {
  FUNCTIONAL: '機能要求',
  NON_FUNCTIONAL: '非機能要求',
  BUSINESS_RULE: 'ビジネスルール',
  CONSTRAINT: '制約',
  INTERFACE: 'インターフェース',
  DATA: 'データ要求',
};

const priorityLabels: Record<string, { label: string; color: string }> = {
  HIGH: { label: '高', color: 'text-red-600 bg-red-50 border-red-200' },
  MEDIUM: { label: '中', color: 'text-amber-600 bg-amber-50 border-amber-200' },
  LOW: { label: '低', color: 'text-green-600 bg-green-50 border-green-200' },
};

const statusLabels: Record<string, { label: string; color: string }> = {
  DRAFT: { label: '下書き', color: 'text-gray-600 bg-gray-100' },
  REVIEW: { label: 'レビュー中', color: 'text-blue-600 bg-blue-100' },
  APPROVED: { label: '承認済', color: 'text-green-600 bg-green-100' },
  IMPLEMENTED: { label: '実装済', color: 'text-purple-600 bg-purple-100' },
  VERIFIED: { label: '検証済', color: 'text-emerald-600 bg-emerald-100' },
};

export default function RequirementsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // AI変換
  const [isAiDialogOpen, setIsAiDialogOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // 手動追加
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newRequirement, setNewRequirement] = useState({
    title: '',
    description: '',
    type: 'FUNCTIONAL',
    priority: 'MEDIUM',
    parentId: '',
  });

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchRequirements = useCallback(async () => {
    setLoading(true);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/requirements/project/${projectId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setRequirements(data);
      }
    } catch (err) {
      console.error('Failed to fetch requirements:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchRequirements();
  }, [fetchRequirements]);

  // AI変換実行
  const handleAiParse = async () => {
    if (!aiInput.trim()) return;

    setAiLoading(true);
    setAiError(null);

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/requirements/parse`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          text: aiInput,
        }),
      });

      if (res.ok) {
        await fetchRequirements();
        setIsAiDialogOpen(false);
        setAiInput('');
      } else {
        const data = await res.json();
        setAiError(data.message || 'AI変換に失敗しました');
      }
    } catch (err) {
      setAiError('エラーが発生しました');
    } finally {
      setAiLoading(false);
    }
  };

  // 手動追加
  const handleAddRequirement = async () => {
    if (!newRequirement.title.trim()) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/requirements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          ...newRequirement,
          parentId: newRequirement.parentId || undefined,
        }),
      });

      if (res.ok) {
        await fetchRequirements();
        setIsAddDialogOpen(false);
        setNewRequirement({
          title: '',
          description: '',
          type: 'FUNCTIONAL',
          priority: 'MEDIUM',
          parentId: '',
        });
      }
    } catch (err) {
      console.error('Failed to add requirement:', err);
    }
  };

  // 削除
  const handleDelete = async (id: string) => {
    if (!confirm('この要求を削除してもよろしいですか？子要求も削除されます。')) return;

    try {
      const headers = getHeaders();
      await fetch(`${API_URL}/api/requirements/${id}`, {
        method: 'DELETE',
        headers,
      });
      await fetchRequirements();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  // 展開/折りたたみ
  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // キーボードショートカット
  const openHowTo = useCallback(() => {
    document
      .getElementById('howto-trigger-requirements')
      ?.querySelector<HTMLButtonElement>('button')
      ?.click();
  }, []);

  const openManualAdd = useCallback(() => {
    setNewRequirement((prev) => ({ ...prev, parentId: '' }));
    setIsAddDialogOpen(true);
  }, []);

  useKeyboardShortcuts([
    { combo: 'n', handler: openManualAdd },
    { combo: 'mod+enter', handler: openManualAdd },
    { combo: 'g', handler: () => setIsAiDialogOpen(true) },
    { combo: 'shift+/', handler: openHowTo },
  ]);

  // 要求ツリーを再帰的に表示
  const renderRequirementTree = (items: Requirement[], depth: number = 0) => {
    return items.map((req) => {
      const isExpanded = expandedIds.has(req.id);
      const hasChildren = req.children && req.children.length > 0;
      const priority = priorityLabels[req.priority] || priorityLabels.MEDIUM;
      const status = statusLabels[req.status] || statusLabels.DRAFT;

      return (
        <div key={req.id} className="group">
          <div
            className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors ${
              depth > 0 ? 'ml-6 border-l-2 border-gray-200 pl-4' : ''
            }`}
          >
            {/* 展開ボタン */}
            <button
              onClick={() => toggleExpand(req.id)}
              className={`mt-1 p-0.5 rounded hover:bg-gray-200 ${!hasChildren ? 'invisible' : ''}`}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-gray-500" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-500" />
              )}
            </button>

            {/* メインコンテンツ */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-gray-400">{req.code}</span>
                <span className={`text-xs px-2 py-0.5 rounded border ${priority.color}`}>
                  {priority.label}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${status.color}`}>
                  {status.label}
                </span>
                <span className="text-xs text-gray-400">
                  {typeLabels[req.type] || req.type}
                </span>
              </div>
              <h3 className="font-medium text-gray-900">{req.title}</h3>
              {req.description && (
                <p className="text-sm text-gray-500 mt-1 line-clamp-2">{req.description}</p>
              )}
              {/* 紐付け情報 */}
              {((req.flowMappings?.length ?? 0) > 0 || (req.crudMappings?.length ?? 0) > 0) && (
                <div className="flex gap-2 mt-2">
                  {(req.flowMappings?.length ?? 0) > 0 && (
                    <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                      <LinkIcon className="h-3 w-3 inline mr-1" />
                      {req.flowMappings?.length} フロー
                    </span>
                  )}
                  {(req.crudMappings?.length ?? 0) > 0 && (
                    <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                      <LinkIcon className="h-3 w-3 inline mr-1" />
                      {req.crudMappings?.length} CRUD
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* アクション */}
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => {
                  setNewRequirement({ ...newRequirement, parentId: req.id });
                  setIsAddDialogOpen(true);
                }}
                title="子要求を追加"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={() => handleDelete(req.id)}
                title="削除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 子要求 */}
          {hasChildren && isExpanded && (
            <div className="mt-1">{renderRequirementTree(req.children!, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

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
              <h1 className="text-3xl font-bold text-gray-900">要求定義</h1>
              <HelpTooltip text="要求定義は「システムが満たすべきこと」を構造化したものです。機能要求・非機能要求・制約などを親子ツリーで整理し、業務フローやCRUD（データ操作）と紐付けて、なぜ必要か（なぜ型）と何を実装するか（打ち手）を明確にします。" />
            </div>
            <p className="text-gray-500 mt-1">システム要求を定義・管理</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <span id="howto-trigger-requirements" className="contents">
            <HowToPanel
              steps={[
                '「AIで生成」を押し、システムの要望を自然言語で入力すると、AIが要求ツリーに変換します。',
                '手動で追加する場合は「要求を追加」からタイトル・説明・タイプ・優先度を入力します。',
                '各行にカーソルを合わせると現れる「＋」で子要求を、ゴミ箱で削除ができます（子要求も一緒に削除）。',
                'コード・優先度・ステータス・タイプのバッジで状態を確認し、フロー／CRUDの紐付け件数も把握できます。',
              ]}
              shortcuts={[
                { keys: 'N', desc: '要求を手動追加するダイアログを開く' },
                { keys: '⌘/Ctrl+Enter', desc: '要求を手動追加するダイアログを開く' },
                { keys: 'G', desc: 'AIで生成ダイアログを開く' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </span>
          <Button
            variant="outline"
            onClick={() => setIsAiDialogOpen(true)}
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            AIで生成
          </Button>
          <Button
            onClick={() => {
              setNewRequirement({ ...newRequirement, parentId: '' });
              setIsAddDialogOpen(true);
            }}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            要求を追加
          </Button>
        </div>
      </div>

      {/* 要求一覧 */}
      {requirements.length > 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-4">{renderRequirementTree(requirements)}</CardContent>
        </Card>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">要求がありません</p>
            <p className="text-sm text-gray-400 mb-4">
              AIで自然言語から生成するか、手動で追加してください
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsAiDialogOpen(true)}
                className="border-purple-300 text-purple-700"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                AIで生成
              </Button>
              <Button
                onClick={() => setIsAddDialogOpen(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="h-4 w-4 mr-2" />
                手動で追加
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI生成ダイアログ */}
      <Dialog open={isAiDialogOpen} onOpenChange={setIsAiDialogOpen}>
        <DialogContent className="bg-white border-gray-200 max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              AIで要求を生成
              <HelpTooltip text="自然言語の要望を、構造化された要求ツリーに自動変換します。生成後は各要求を業務フローやCRUD（Create=作成 / Read=参照 / Update=更新 / Delete=削除）と紐付けて、データ操作との対応を管理できます。" />
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              自然言語でシステムの要望を入力すると、要求定義に変換されます
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Textarea
              placeholder={`例：
ユーザー登録機能が必要です。メールアドレスとパスワードで登録でき、確認メールを送信します。パスワードは8文字以上で、英数字を含む必要があります。

また、ログイン機能も必要で、3回ログインに失敗するとアカウントがロックされます。`}
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              className="min-h-[200px] bg-white border-gray-300"
            />

            {aiError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {aiError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAiDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleAiParse}
              disabled={!aiInput.trim() || aiLoading}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {aiLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  変換中...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  要求に変換
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手動追加ダイアログ */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="bg-white border-gray-200">
          <DialogHeader>
            <DialogTitle className="text-gray-900">要求を追加</DialogTitle>
            <DialogDescription className="text-gray-500">
              {newRequirement.parentId ? '子要求として追加されます' : '新しい要求を追加します'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-gray-700">タイトル</Label>
              <Input
                placeholder="ユーザー登録機能"
                value={newRequirement.title}
                onChange={(e) => setNewRequirement({ ...newRequirement, title: e.target.value })}
                className="bg-white border-gray-300"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-700">説明</Label>
              <Textarea
                placeholder="要求の詳細な説明..."
                value={newRequirement.description}
                onChange={(e) =>
                  setNewRequirement({ ...newRequirement, description: e.target.value })
                }
                className="bg-white border-gray-300"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-gray-700">タイプ</Label>
                  <HelpTooltip text="要求の種類です。機能要求（ユーザーができること）／非機能要求（性能・セキュリティなど）／ビジネスルール／制約／インターフェース／データ要求を選びます。" />
                </div>
                <Select
                  value={newRequirement.type}
                  onValueChange={(v) => setNewRequirement({ ...newRequirement, type: v })}
                >
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {Object.entries(typeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label className="text-gray-700">優先度</Label>
                  <HelpTooltip text="この要求の実装優先度です。高＝必須、中＝重要、低＝余裕があれば。限られた工数の中で「どの打ち手から着手するか」の判断材料になります。" />
                </div>
                <Select
                  value={newRequirement.priority}
                  onValueChange={(v) => setNewRequirement({ ...newRequirement, priority: v })}
                >
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {Object.entries(priorityLabels).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleAddRequirement}
              disabled={!newRequirement.title.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

