'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { Card, CardContent } from '@/components/ui/card';
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
  ChevronRight,
  Plus,
  Loader2,
  Trash2,
  GitBranch,
  Search,
  Lightbulb,
  HelpCircle,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type IssueTreeType = 'WHY' | 'SOLUTION';

type IssueTree = {
  id: string;
  projectId: string;
  type: IssueTreeType;
  name: string;
  rootQuestion: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type FilterType = 'ALL' | IssueTreeType;

type GapItemOption = {
  id: string;
  businessArea: string;
  gapDescription: string | null;
};

const NO_GAP = '__none__';

const typeMeta: Record<
  IssueTreeType,
  {
    label: string;
    sublabel: string;
    description: string;
    accent: string; // left border + icon bg accent
    badge: string; // badge classes
    icon: typeof Search;
    cardHover: string;
  }
> = {
  WHY: {
    label: 'なぜ型',
    sublabel: '調査・原因究明',
    description: '「なぜ？」を繰り返して問題の根本原因を掘り下げるツリーです。',
    accent: 'border-l-blue-500',
    badge: 'text-blue-700 bg-blue-50 border-blue-200',
    icon: Search,
    cardHover: 'hover:border-blue-300',
  },
  SOLUTION: {
    label: '打ち手型',
    sublabel: 'How・MECEアクション',
    description: '「どうやって？」をMECEに分解して具体的な打ち手を洗い出すツリーです。',
    accent: 'border-l-emerald-500',
    badge: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    icon: Lightbulb,
    cardHover: 'hover:border-emerald-300',
  },
};

export default function IssueTreesPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [trees, setTrees] = useState<IssueTree[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('ALL');

  // 作成ダイアログ
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTree, setNewTree] = useState<{
    type: IssueTreeType;
    name: string;
    rootQuestion: string;
    gapItemId: string;
  }>({
    type: 'WHY',
    name: '',
    rootQuestion: '',
    gapItemId: NO_GAP,
  });

  // GAP（課題）一覧（起点に出来る）
  const [gapItems, setGapItems] = useState<GapItemOption[]>([]);

  const howToRef = useRef<HTMLDivElement>(null);

  const openCreate = useCallback((type: IssueTreeType = 'WHY') => {
    setNewTree({ type, name: '', rootQuestion: '', gapItemId: NO_GAP });
    setCreateError(null);
    setIsCreateOpen(true);
  }, []);

  // n・⌘Enter … ツリー作成 / Shift+/（?） … 操作方法
  useKeyboardShortcuts([
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
    {
      combo: 'n',
      handler: () => openCreate('WHY'),
    },
    {
      combo: 'mod+enter',
      whenTyping: true,
      handler: () => openCreate('WHY'),
    },
  ]);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchTrees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/issue-trees`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTrees(Array.isArray(data) ? data : []);
      } else {
        setError('課題ツリーの取得に失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch issue trees:', err);
      setError('エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  const fetchGapItems = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/gap-items`, { headers });
      if (res.ok) {
        const data = await res.json();
        setGapItems(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch gap items:', err);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchTrees();
    fetchGapItems();
  }, [fetchTrees, fetchGapItems]);

  const handleCreate = async () => {
    if (!newTree.name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/issue-trees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: newTree.type,
          name: newTree.name.trim(),
          rootQuestion: newTree.rootQuestion.trim() || undefined,
          gapItemId: newTree.gapItemId !== NO_GAP ? newTree.gapItemId : undefined,
        }),
      });
      if (res.ok) {
        await fetchTrees();
        await fetchGapItems();
        setIsCreateOpen(false);
        setNewTree({ type: 'WHY', name: '', rootQuestion: '', gapItemId: NO_GAP });
      } else {
        const data = await res.json().catch(() => ({}));
        setCreateError(data.message || 'ツリーの作成に失敗しました');
      }
    } catch (err) {
      console.error('Failed to create issue tree:', err);
      setCreateError('エラーが発生しました');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (tree: IssueTree) => {
    if (!confirm(`「${tree.name}」を削除してもよろしいですか？ノードもすべて削除されます。`)) return;
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/issue-trees/${tree.id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        await fetchTrees();
      } else {
        alert('削除に失敗しました');
      }
    } catch (err) {
      console.error('Failed to delete issue tree:', err);
      alert('エラーが発生しました');
    }
  };

  const filteredTrees =
    filter === 'ALL' ? trees : trees.filter((t) => t.type === filter);

  const whyCount = trees.filter((t) => t.type === 'WHY').length;
  const solutionCount = trees.filter((t) => t.type === 'SOLUTION').length;

  const filterTabs: { value: FilterType; label: string; count: number }[] = [
    { value: 'ALL', label: 'すべて', count: trees.length },
    { value: 'WHY', label: 'なぜ型', count: whyCount },
    { value: 'SOLUTION', label: '打ち手型', count: solutionCount },
  ];

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
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-gray-900">課題ツリー</h1>
              <HelpTooltip text="問題をツリー状に分解して構造化する道具です。「なぜ型」で原因を深掘りし、「打ち手型」で対策をMECEに洗い出します。GAP（課題）を起点に紐づけられます。" />
            </div>
            <p className="text-gray-500 mt-1">問題の構造化・原因究明・打ち手の検討</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div ref={howToRef}>
            <HowToPanel
              title="課題ツリー一覧の使い方"
              steps={[
                '「ツリー作成」で「なぜ型」または「打ち手型」を選び、ツリー名とルートの問いを入力します。',
                '必要なら GAP（課題）を起点に選ぶと、その課題にツリーが紐づきます。',
                'カードをクリックするとマインドマップ編集画面が開きます。',
                '上部のタブ（すべて／なぜ型／打ち手型）で一覧を絞り込めます。',
              ]}
              shortcuts={[
                { keys: 'N', desc: 'ツリー作成ダイアログを開く' },
                { keys: '⌘/Ctrl+Enter', desc: 'ツリー作成ダイアログを開く' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </div>
          <Button
            onClick={() => openCreate('WHY')}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            ツリー作成
          </Button>
        </div>
      </div>

      {/* 型の説明 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['WHY', 'SOLUTION'] as IssueTreeType[]).map((t) => {
          const meta = typeMeta[t];
          const Icon = meta.icon;
          return (
            <div
              key={t}
              className={`flex items-start gap-3 p-4 rounded-lg border bg-white border-l-4 ${meta.accent}`}
            >
              <div
                className={`mt-0.5 w-9 h-9 rounded-lg flex items-center justify-center border ${meta.badge}`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{meta.label}</span>
                  <span className="text-xs text-gray-400">{meta.sublabel}</span>
                </div>
                <p className="text-sm text-gray-500 mt-1">{meta.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* フィルタ */}
      <div className="flex flex-wrap items-center gap-2">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              filter === tab.value
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            <span
              className={`ml-2 text-xs ${
                filter === tab.value ? 'text-gray-300' : 'text-gray-400'
              }`}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* エラー */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 一覧 */}
      {filteredTrees.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTrees.map((tree) => {
            const meta = typeMeta[tree.type] ?? typeMeta.WHY;
            const Icon = meta.icon;
            return (
              <Card
                key={tree.id}
                className={`group relative bg-white border-gray-200 border-l-4 ${meta.accent} transition-colors ${meta.cardHover}`}
              >
                <CardContent className="p-5">
                  <Link
                    href={`/dashboard/projects/${projectId}/issue-trees/${tree.id}`}
                    className="block"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border ${meta.badge}`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {meta.label}
                      </span>
                      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                    </div>
                    <h3 className="font-semibold text-gray-900 mb-1 line-clamp-2 pr-8">
                      {tree.name}
                    </h3>
                    {tree.rootQuestion ? (
                      <p className="text-sm text-gray-500 flex items-start gap-1.5 line-clamp-2">
                        <HelpCircle className="h-4 w-4 shrink-0 mt-0.5 text-gray-400" />
                        <span>{tree.rootQuestion}</span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-300 italic">ルートの問い 未設定</p>
                    )}
                  </Link>

                  {/* 削除 */}
                  <button
                    onClick={() => handleDelete(tree)}
                    title="削除"
                    className="absolute bottom-3 right-3 p-1.5 rounded text-gray-300 opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <GitBranch className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-500 mb-2">
              {filter === 'ALL'
                ? '課題ツリーがありません'
                : `${filter === 'WHY' ? 'なぜ型' : '打ち手型'}のツリーがありません`}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              「なぜ型」で原因を掘り下げ、「打ち手型」で対策を検討しましょう
            </p>
            <Button
              onClick={() => {
                setNewTree({
                  type: filter === 'SOLUTION' ? 'SOLUTION' : 'WHY',
                  name: '',
                  rootQuestion: '',
                  gapItemId: NO_GAP,
                });
                setCreateError(null);
                setIsCreateOpen(true);
              }}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              ツリー作成
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 作成ダイアログ */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-white border-gray-200">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-blue-600" />
              課題ツリーを作成
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              型を選び、ツリー名とルートの問いを入力してください
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* 型選択 */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-gray-700">型</Label>
                <HelpTooltip text="なぜ型＝「なぜ？」を繰り返し原因を深掘りするツリー。打ち手型＝「どうやって？」をMECE（モレなくダブりなく）に分解し対策を洗い出すツリーです。" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {(['WHY', 'SOLUTION'] as IssueTreeType[]).map((t) => {
                  const meta = typeMeta[t];
                  const Icon = meta.icon;
                  const selected = newTree.type === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewTree({ ...newTree, type: t })}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        selected
                          ? `${meta.badge} ring-2 ring-offset-1 ${
                              t === 'WHY' ? 'ring-blue-300' : 'ring-emerald-300'
                            }`
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          className={`h-4 w-4 ${
                            selected
                              ? t === 'WHY'
                                ? 'text-blue-600'
                                : 'text-emerald-600'
                              : 'text-gray-400'
                          }`}
                        />
                        <span
                          className={`font-medium ${
                            selected ? 'text-gray-900' : 'text-gray-700'
                          }`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{meta.sublabel}</p>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400">
                {typeMeta[newTree.type].description}
              </p>
            </div>

            {/* GAP（課題）を起点にする */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-gray-700">GAP（課題）を起点にする（任意）</Label>
                <HelpTooltip text="GAP は ASIS（現状）と TOBE（あるべき姿）の差から生まれた課題です。GAP を起点にすると、その課題を解くためのツリーとして紐づけて管理できます。" />
              </div>
              <Select
                value={newTree.gapItemId}
                onValueChange={(v) => setNewTree({ ...newTree, gapItemId: v })}
                disabled={gapItems.length === 0}
              >
                <SelectTrigger className="bg-white border-gray-300">
                  <SelectValue
                    placeholder={
                      gapItems.length === 0
                        ? 'GAP（課題）がありません'
                        : '起点にするGAPを選択（任意）'
                    }
                  />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value={NO_GAP}>起点にしない</SelectItem>
                  {gapItems.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.businessArea}
                      {g.gapDescription ? `：${g.gapDescription}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">
                選択したGAPにこのツリーが紐づきます（課題ツリー）。
              </p>
            </div>

            {/* ツリー名 */}
            <div className="space-y-2">
              <Label className="text-gray-700">ツリー名</Label>
              <Input
                placeholder={newTree.type === 'WHY' ? '解約率が高い' : '解約率を下げる'}
                value={newTree.name}
                onChange={(e) => setNewTree({ ...newTree, name: e.target.value })}
                className="bg-white border-gray-300"
                maxLength={200}
              />
            </div>

            {/* ルートの問い */}
            <div className="space-y-2">
              <Label className="text-gray-700">ルートの問い（任意）</Label>
              <Textarea
                placeholder={
                  newTree.type === 'WHY'
                    ? 'なぜ解約率が高いのか？'
                    : 'どうすれば解約率を下げられるか？'
                }
                value={newTree.rootQuestion}
                onChange={(e) => setNewTree({ ...newTree, rootQuestion: e.target.value })}
                className="bg-white border-gray-300"
              />
            </div>

            {createError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {createError}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newTree.name.trim() || creating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  作成中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  作成
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
