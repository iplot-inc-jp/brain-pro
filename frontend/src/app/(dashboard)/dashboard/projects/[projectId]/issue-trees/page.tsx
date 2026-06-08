'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
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
  Layers,
  ListChecks,
  BarChart3,
  Download,
} from 'lucide-react';
import {
  ISSUE_TREE_PATTERNS,
  PATTERN_META,
  type IssueTreePattern,
} from '@/lib/issue-tree-patterns';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type IssueTree = {
  id: string;
  projectId: string;
  pattern?: IssueTreePattern;
  type?: 'WHY' | 'SOLUTION';
  name: string;
  rootQuestion: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type FilterType = 'ALL' | IssueTreePattern;

type GapItemOption = {
  id: string;
  businessArea: string;
  gapDescription: string | null;
};

const NO_GAP = '__none__';

// pattern ごとのアイコン（一覧/picker 共有）。
const PATTERN_ICON: Record<IssueTreePattern, typeof Search> = {
  ISSUE_POINT: Search,
  WHY: HelpCircle,
  WHAT: Layers,
  HOW: Lightbulb,
  MECE_ACTION: ListChecks,
  KPI: BarChart3,
};

// 旧 type(WHY/SOLUTION) しか持たない既存ツリーを pattern にフォールバック。
function patternOf(tree: IssueTree): IssueTreePattern {
  if (tree.pattern) return tree.pattern;
  if (tree.type === 'SOLUTION') return 'HOW';
  return 'WHY';
}

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
    pattern: IssueTreePattern;
    name: string;
    rootQuestion: string;
    gapItemId: string;
  }>({
    pattern: 'ISSUE_POINT',
    name: '',
    rootQuestion: '',
    gapItemId: NO_GAP,
  });

  // GAP（課題）一覧（起点に出来る）
  const [gapItems, setGapItems] = useState<GapItemOption[]>([]);

  const howToRef = useRef<HTMLDivElement>(null);

  const openCreate = useCallback((pattern: IssueTreePattern = 'ISSUE_POINT') => {
    setNewTree({ pattern, name: '', rootQuestion: '', gapItemId: NO_GAP });
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
      handler: () => openCreate('ISSUE_POINT'),
    },
    {
      combo: 'mod+enter',
      whenTyping: true,
      handler: () => openCreate('ISSUE_POINT'),
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
        // type は送らない（バックエンドが pattern から既定を決める）。
        body: JSON.stringify({
          pattern: newTree.pattern,
          name: newTree.name.trim(),
          rootQuestion: newTree.rootQuestion.trim() || undefined,
          gapItemId: newTree.gapItemId !== NO_GAP ? newTree.gapItemId : undefined,
        }),
      });
      if (res.ok) {
        await fetchTrees();
        await fetchGapItems();
        setIsCreateOpen(false);
        setNewTree({ pattern: 'ISSUE_POINT', name: '', rootQuestion: '', gapItemId: NO_GAP });
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
    filter === 'ALL' ? trees : trees.filter((t) => patternOf(t) === filter);

  // 作成ダイアログで選択中の GAP（「GAPから取り込む」ボタンの出し分けに使う）。
  const selectedGap =
    newTree.gapItemId !== NO_GAP
      ? gapItems.find((g) => g.id === newTree.gapItemId) ?? null
      : null;

  const filterTabs: { value: FilterType; label: string; count: number }[] = [
    { value: 'ALL', label: 'すべて', count: trees.length },
    ...ISSUE_TREE_PATTERNS.map((p) => ({
      value: p as FilterType,
      label: PATTERN_META[p].label,
      count: trees.filter((t) => patternOf(t) === p).length,
    })),
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
              <HelpTooltip text="問題をツリー状に分解して構造化する道具です。論点（イシュー）・原因（Why）・対象分割（What）・打ち手（How/MECE）・KPI の6パターンから選んで作成できます。GAP（課題）を起点に紐づけられます。" />
            </div>
            <p className="text-gray-500 mt-1">論点・原因究明・対象分割・打ち手・KPI の構造化</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div ref={howToRef}>
            <HowToPanel
              title="課題ツリー一覧の使い方"
              steps={[
                '「ツリー作成」で6つのパターン（イシューツリー／Why／What／How／MECEアクション／KPI）から1つ選び、ツリー名とルートの問いを入力します。',
                'パターンは「開始テンプレ」です。作成後はノード種別を混在させたり、後から変更できます。',
                '必要なら GAP（課題）を起点に選ぶと、その課題にツリーが紐づきます。',
                'カードをクリックするとマインドマップ編集画面が開きます。',
                '上部のタブでパターン別に一覧を絞り込めます。',
              ]}
              shortcuts={[
                { keys: 'N', desc: 'ツリー作成ダイアログを開く' },
                { keys: '⌘/Ctrl+Enter', desc: 'ツリー作成ダイアログを開く' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </div>
          <ManualButton feature="issue-trees" />
          <Button
            onClick={() => openCreate('ISSUE_POINT')}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            ツリー作成
          </Button>
        </div>
      </div>

      {/* パターンの説明 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {ISSUE_TREE_PATTERNS.map((p) => {
          const meta = PATTERN_META[p];
          const Icon = PATTERN_ICON[p];
          return (
            <button
              key={p}
              type="button"
              onClick={() => openCreate(p)}
              title="このパターンでツリー作成"
              className={`flex items-start gap-3 p-3 rounded-lg border bg-white border-l-4 text-left transition-colors hover:bg-gray-50 ${meta.accent}`}
            >
              <div
                className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center border ${meta.badge}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900">{meta.label}</span>
                  <span className="text-[10px] text-gray-400">{meta.sublabel}</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{meta.description}</p>
              </div>
            </button>
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
            const pattern = patternOf(tree);
            const meta = PATTERN_META[pattern];
            const Icon = PATTERN_ICON[pattern];
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
                : `${PATTERN_META[filter].label}のツリーがありません`}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              論点を分解し、原因を掘り下げ、打ち手を検討しましょう
            </p>
            <Button
              onClick={() => openCreate(filter === 'ALL' ? 'ISSUE_POINT' : filter)}
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
        <DialogContent className="bg-white border-gray-200 sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-blue-600" />
              課題ツリーを作成
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              パターンを選び、ツリー名とルートの問いを入力してください
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* パターン選択 */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-gray-700">パターン（開始テンプレ）</Label>
                <HelpTooltip text="目的に合うテンプレを選びます。種別は混在可・配置は強制されません（後から変更可）。イシューツリー＝論点を疑問形で分解し仮説検証、Why＝原因の深掘り、What＝対象を構成要素に分割、How＝打ち手の発散、MECEアクション＝行動の網羅、KPI＝指標の分解。" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {ISSUE_TREE_PATTERNS.map((p) => {
                  const meta = PATTERN_META[p];
                  const Icon = PATTERN_ICON[p];
                  const selected = newTree.pattern === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewTree({ ...newTree, pattern: p })}
                      className={`text-left p-2.5 rounded-lg border transition-colors ${
                        selected
                          ? `${meta.badge} ring-2 ring-offset-1 ${meta.ring}`
                          : 'bg-white border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          className={`h-4 w-4 ${selected ? meta.iconColor : 'text-gray-400'}`}
                        />
                        <span
                          className={`font-medium text-sm ${selected ? 'text-gray-900' : 'text-gray-700'}`}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">{meta.sublabel}</p>
                    </button>
                  );
                })}
              </div>
              {/* 選択中パターンの ガイド + 開始例（ルート例＋子例） */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <p className="text-xs leading-relaxed text-gray-600">
                  {PATTERN_META[newTree.pattern].guide}
                </p>
                <div className="rounded-md border border-gray-200 bg-white p-2.5">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                    <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                    開始例
                  </div>
                  <div className="flex items-start gap-1.5 text-xs text-gray-800">
                    <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className="font-medium">
                      {PATTERN_META[newTree.pattern].example.rootLabel}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-1 pl-5">
                    {PATTERN_META[newTree.pattern].example.children.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-[11px] text-gray-600"
                      >
                        <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-gray-300" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
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
                placeholder={PATTERN_META[newTree.pattern].nameExample}
                value={newTree.name}
                onChange={(e) => setNewTree({ ...newTree, name: e.target.value })}
                className="bg-white border-gray-300"
                maxLength={200}
              />
            </div>

            {/* ルートの問い */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-gray-700">ルートの問い（任意）</Label>
                {selectedGap && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const text = selectedGap.gapDescription?.trim() || selectedGap.businessArea;
                      setNewTree((prev) => ({ ...prev, rootQuestion: text }));
                    }}
                    className="h-7 gap-1 border-blue-200 px-2 text-xs text-blue-700 hover:bg-blue-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    GAPから取り込む
                  </Button>
                )}
              </div>
              <Textarea
                placeholder={PATTERN_META[newTree.pattern].rootExample}
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
