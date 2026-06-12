'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
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
  Ban,
  ChevronLeft,
  Plus,
  Loader2,
  GitCompareArrows,
  Trash2,
  Check,
  RotateCcw,
  Filter,
  GitBranch,
  ExternalLink,
  BarChart3,
  ClipboardList,
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { SortableTh } from '@/components/ui/sortable-th';
import { useTableSort } from '@/lib/use-table-sort';
import { ManualButton } from '@/components/ui/manual-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { AnalysisTab } from './_components/analysis-tab';
import { LedgerTab } from './_components/ledger-tab';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type GapStatus = 'OPEN' | 'RESOLVED';

type GapItem = {
  id: string;
  projectId: string;
  phaseId: string | null;
  businessArea: string;
  asisDescription: string | null;
  tobeDescription: string | null;
  gapDescription: string | null;
  priority: Priority;
  status: GapStatus;
  ownerName: string | null;
  order: number;
  outOfScope: boolean;
  asisFlowId: string | null;
  asisNodeId: string | null;
  tobeFlowId: string | null;
  tobeNodeId: string | null;
  issueTreeId: string | null;
  createdAt: string;
  updatedAt: string;
};

const priorityMeta: Record<Priority, { label: string; badge: string; row: string }> = {
  HIGH: {
    label: 'HIGH',
    badge: 'text-red-700 bg-red-50 border-red-300',
    row: 'border-l-red-500',
  },
  MEDIUM: {
    label: 'MEDIUM',
    badge: 'text-amber-700 bg-amber-50 border-amber-300',
    row: 'border-l-amber-500',
  },
  LOW: {
    label: 'LOW',
    badge: 'text-green-700 bg-green-50 border-green-300',
    row: 'border-l-green-500',
  },
};

const statusMeta: Record<GapStatus, { label: string; badge: string }> = {
  OPEN: { label: 'OPEN', badge: 'text-blue-700 bg-blue-50 border-blue-200' },
  RESOLVED: { label: 'RESOLVED', badge: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
};

// 優先度ソート用の序列（昇順 = HIGH → MEDIUM → LOW）
const priorityRank: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

type EditableField =
  | 'businessArea'
  | 'asisDescription'
  | 'tobeDescription'
  | 'gapDescription'
  | 'ownerName';

type FlowSummary = {
  id: string;
  name: string;
  kind: 'ASIS' | 'TOBE';
};

type FlowNodeSummary = {
  id: string;
  label: string;
};

const ALL = 'ALL';
// 選択式 Select の「未選択 / 指定なし」を表す番兵値（空文字は Radix Select で不可）
const NONE = '__none__';

// スコープフィルタ（既定「すべて」。スコープ外バッジで判別できるようにする）
type ScopeFilter = 'ALL' | 'IN' | 'OUT';
const SCOPE_FILTERS: { value: ScopeFilter; label: string }[] = [
  { value: 'ALL', label: 'すべて' },
  { value: 'IN', label: '対応対象のみ' },
  { value: 'OUT', label: 'スコープ外のみ' },
];

export default function GapItemsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [items, setItems] = useState<GapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 課題ツリー作成中のGAP id
  const [creatingTreeId, setCreatingTreeId] = useState<string | null>(null);

  // フィルタ
  const [priorityFilter, setPriorityFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  // スコープフィルタ（クライアント側で絞り込み。既定「すべて」）
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('ALL');

  // 作成ダイアログ
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // キーボードショートカット
  // - mod+Enter / n : GAP追加ダイアログを開く
  // - mod+s         : 既定の保存挙動を抑止（各セルは blur で自動保存されるため）
  // - shift+/（?）   : 操作方法ダイアログを開く
  useKeyboardShortcuts([
    { combo: 'mod+enter', handler: () => setIsCreateOpen(true) },
    { combo: 'n', handler: () => setIsCreateOpen(true) },
    { combo: 'mod+s', handler: () => { /* blur で自動保存。ブラウザ保存ダイアログを抑止 */ }, whenTyping: true },
    { combo: 'shift+/', handler: () => setHowToOpen(true) },
  ]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState({
    businessArea: '',
    asisDescription: '',
    tobeDescription: '',
    gapDescription: '',
    priority: 'MEDIUM' as Priority,
    ownerName: '',
    targetFlowId: '' as string,
    asisFlowId: '' as string,
    asisNodeId: '' as string,
    tobeFlowId: '' as string,
    tobeNodeId: '' as string,
  });

  // 業務フロー（対象業務 / ASIS / TOBE 選択用）
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  // 選択中の ASIS / TOBE フローのノード一覧（フォーム内のノード選択用）
  const [asisNodes, setAsisNodes] = useState<FlowNodeSummary[]>([]);
  const [tobeNodes, setTobeNodes] = useState<FlowNodeSummary[]>([]);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();
      const query = new URLSearchParams();
      if (priorityFilter !== ALL) query.set('priority', priorityFilter);
      if (statusFilter !== ALL) query.set('status', statusFilter);
      const qs = query.toString();
      const res = await fetch(
        `${API_URL}/api/projects/${projectId}/gap-items${qs ? `?${qs}` : ''}`,
        { headers },
      );
      if (res.ok) {
        const data: GapItem[] = await res.json();
        data.sort((a, b) => a.order - b.order);
        setItems(data);
      } else {
        setError('GAP一覧の取得に失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch gap items:', err);
      setError('エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, priorityFilter, statusFilter, getHeaders]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // 業務フロー一覧（対象業務 / ASIS / TOBE 選択用）をマウント時に取得
  const fetchFlows = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(
        `${API_URL}/api/business-flows/project/${projectId}/all`,
        { headers },
      );
      if (res.ok) {
        const data: FlowSummary[] = await res.json();
        setFlows(data);
      }
    } catch (err) {
      console.error('Failed to fetch business flows:', err);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchFlows();
  }, [fetchFlows]);

  // 指定フローのノード一覧を取得（ASIS/TOBE のノード選択用）
  const fetchNodes = useCallback(
    async (flowId: string): Promise<FlowNodeSummary[]> => {
      try {
        const headers = getHeaders();
        const res = await fetch(`${API_URL}/api/business-flows/${flowId}`, {
          headers,
        });
        if (!res.ok) return [];
        const data: { nodes?: FlowNodeSummary[] } = await res.json();
        return (data.nodes ?? []).map((n) => ({ id: n.id, label: n.label }));
      } catch (err) {
        console.error('Failed to fetch flow nodes:', err);
        return [];
      }
    },
    [getHeaders],
  );

  // フロー名 → フロー の解決マップ（一覧チップ表示用）
  const flowById = new Map(flows.map((f) => [f.id, f]));
  const asisFlowOptions = flows.filter((f) => f.kind === 'ASIS');
  const tobeFlowOptions = flows.filter((f) => f.kind === 'TOBE');

  // 既存GAPで使われている gapDescription の重複なし候補（GAPセルのコンボボックス候補）
  const gapDescriptionOptions = Array.from(
    new Set(
      items
        .map((it) => it.gapDescription?.trim())
        .filter((v): v is string => !!v),
    ),
  );

  // ASISセル: 行の asisFlowId を既存ASISフローから選択して PUT 更新
  const handleAsisFlowSelect = (item: GapItem, value: string) => {
    const next = value === NONE ? null : value;
    if ((item.asisFlowId ?? null) === next) return;
    patchItem(item.id, { asisFlowId: next });
  };

  // TOBEセル: 行の tobeFlowId を既存TOBEフローから選択して PUT 更新（ASISと対称）
  const handleTobeFlowSelect = (item: GapItem, value: string) => {
    const next = value === NONE ? null : value;
    if ((item.tobeFlowId ?? null) === next) return;
    patchItem(item.id, { tobeFlowId: next });
  };

  // 対象業務フロー選択（フロー名を businessArea に入れる）
  const handleTargetFlowChange = (value: string) => {
    if (value === NONE) {
      setNewItem((prev) => ({ ...prev, targetFlowId: '' }));
      return;
    }
    const flow = flowById.get(value);
    setNewItem((prev) => ({
      ...prev,
      targetFlowId: value,
      businessArea: flow ? flow.name : prev.businessArea,
    }));
  };

  const handleAsisFlowChange = async (value: string) => {
    if (value === NONE) {
      setNewItem((prev) => ({ ...prev, asisFlowId: '', asisNodeId: '' }));
      setAsisNodes([]);
      return;
    }
    setNewItem((prev) => ({ ...prev, asisFlowId: value, asisNodeId: '' }));
    setAsisNodes(await fetchNodes(value));
  };

  const handleTobeFlowChange = async (value: string) => {
    if (value === NONE) {
      setNewItem((prev) => ({ ...prev, tobeFlowId: '', tobeNodeId: '' }));
      setTobeNodes([]);
      return;
    }
    setNewItem((prev) => ({ ...prev, tobeFlowId: value, tobeNodeId: '' }));
    setTobeNodes(await fetchNodes(value));
  };

  // 作成
  const handleCreate = async () => {
    if (!newItem.businessArea.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/gap-items`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          businessArea: newItem.businessArea.trim(),
          asisDescription: newItem.asisDescription || undefined,
          tobeDescription: newItem.tobeDescription || undefined,
          gapDescription: newItem.gapDescription || undefined,
          priority: newItem.priority,
          ownerName: newItem.ownerName || undefined,
          asisFlowId: newItem.asisFlowId || undefined,
          asisNodeId: newItem.asisNodeId || undefined,
          tobeFlowId: newItem.tobeFlowId || undefined,
          tobeNodeId: newItem.tobeNodeId || undefined,
        }),
      });
      if (res.ok) {
        await fetchItems();
        setIsCreateOpen(false);
        setNewItem({
          businessArea: '',
          asisDescription: '',
          tobeDescription: '',
          gapDescription: '',
          priority: 'MEDIUM',
          ownerName: '',
          targetFlowId: '',
          asisFlowId: '',
          asisNodeId: '',
          tobeFlowId: '',
          tobeNodeId: '',
        });
        setAsisNodes([]);
        setTobeNodes([]);
      } else {
        const data = await res.json().catch(() => null);
        setCreateError(
          (data && (Array.isArray(data.message) ? data.message.join(' / ') : data.message)) ||
            'GAPの作成に失敗しました',
        );
      }
    } catch (err) {
      setCreateError('エラーが発生しました');
    } finally {
      setCreating(false);
    }
  };

  // 部分更新（PUT）
  const patchItem = async (id: string, body: Record<string, unknown>) => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/gap-items/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated: GapItem = await res.json();
        setItems((prev) => prev.map((it) => (it.id === id ? updated : it)));
      } else {
        await fetchItems();
      }
    } catch (err) {
      console.error('Failed to update gap item:', err);
      await fetchItems();
    }
  };

  // セル inline 編集（blur 時に値が変わっていれば PUT）
  const handleCellBlur = (item: GapItem, field: EditableField, value: string) => {
    const next = value.trim() === '' ? null : value;
    const current = item[field] ?? null;
    if (next === current) return;
    patchItem(item.id, { [field]: next });
  };

  const handlePriorityChange = (item: GapItem, priority: Priority) => {
    if (item.priority === priority) return;
    patchItem(item.id, { priority });
  };

  // スコープ外トグル（既存のGAP更新経路 PUT /api/gap-items/:id で保存）
  const handleToggleOutOfScope = (item: GapItem) => {
    patchItem(item.id, { outOfScope: !item.outOfScope });
  };

  // 解決 / 再オープン（status: OPEN ⇄ RESOLVED）
  const setStatus = async (item: GapItem, action: 'resolve' | 'reopen') => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/gap-items/${item.id}/${action}`, {
        method: 'POST',
        headers,
      });
      if (res.ok) {
        const updated: GapItem = await res.json();
        setItems((prev) => prev.map((it) => (it.id === item.id ? updated : it)));
        if (statusFilter !== ALL) await fetchItems();
      }
    } catch (err) {
      console.error(`Failed to ${action} gap item:`, err);
    }
  };
  const handleResolve = (item: GapItem) => setStatus(item, 'resolve');
  const handleReopen = (item: GapItem) => setStatus(item, 'reopen');

  const handleDelete = async (id: string) => {
    if (!confirm('このGAP（課題）を削除してもよろしいですか？')) return;
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/gap-items/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok || res.status === 204) {
        setItems((prev) => prev.filter((it) => it.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete gap item:', err);
    }
  };

  // GAPを起点に課題ツリー（SOLUTION）を作成して開く
  const handleCreateIssueTree = async (item: GapItem) => {
    setCreatingTreeId(item.id);
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/issue-trees`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'SOLUTION',
          name: `${item.businessArea} 課題ツリー`,
          rootQuestion: item.gapDescription || undefined,
          gapItemId: item.id,
        }),
      });
      if (res.ok) {
        const tree: { id: string } = await res.json();
        router.push(`/dashboard/projects/${projectId}/issue-trees/${tree.id}`);
      } else {
        alert('課題ツリーの作成に失敗しました');
        setCreatingTreeId(null);
      }
    } catch (err) {
      console.error('Failed to create issue tree:', err);
      alert('エラーが発生しました');
      setCreatingTreeId(null);
    }
  };

  const openCount = items.filter((it) => it.status === 'OPEN').length;
  const resolvedCount = items.filter((it) => it.status === 'RESOLVED').length;
  const outOfScopeCount = items.filter((it) => it.outOfScope).length;

  // スコープフィルタ適用後の表示行（GAP一覧タブのみ。分析・台帳タブは全件のまま）
  const visibleItems = useMemo(
    () =>
      scopeFilter === 'ALL'
        ? items
        : items.filter((it) => (scopeFilter === 'OUT' ? it.outOfScope : !it.outOfScope)),
    [items, scopeFilter],
  );

  // ヘッダークリックソート（表示用の派生値で比較。解除時は手動順＝order 昇順に戻る）。
  // ASIS / TOBE セルはフロー選択 Select のため、選択中のフロー名で比較する。
  const sortAccessors = useMemo(() => {
    const flowNameById = new Map(flows.map((f) => [f.id, f.name]));
    return {
      businessArea: (it: GapItem) => it.businessArea,
      asis: (it: GapItem) => (it.asisFlowId ? (flowNameById.get(it.asisFlowId) ?? '') : ''),
      tobe: (it: GapItem) => (it.tobeFlowId ? (flowNameById.get(it.tobeFlowId) ?? '') : ''),
      gap: (it: GapItem) => it.gapDescription,
      priority: (it: GapItem) => priorityRank[it.priority] ?? priorityRank.MEDIUM,
      owner: (it: GapItem) => it.ownerName,
      status: (it: GapItem) => statusMeta[it.status]?.label ?? it.status,
    };
  }, [flows]);
  const { sorted: sortedItems, sortKey, sortDir, toggleSort } = useTableSort(
    visibleItems,
    sortAccessors,
  );

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
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <GitCompareArrows className="w-7 h-7 text-blue-600" />
              GAP（課題一覧）
              <HelpTooltip text="GAP = TOBE（あるべき姿）− ASIS（現状）。理想と現実の差分こそが「本当に解くべき課題」です。" />
            </h1>
            <p className="text-gray-500 mt-1">
              GAP = TOBE（あるべき姿）− ASIS（現状）。この差分こそが「本当の課題」です。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HowToPanel
            open={howToOpen}
            onOpenChange={setHowToOpen}
            steps={[
              '「GAP追加」で業務領域ごとに ASIS（現状・数値込み）と TOBE（あるべき姿）を入力します。',
              'その差分＝本当の課題を「GAP」欄に書きます（例: 14分/件のロス）。',
              '表の各セルはその場で編集でき、欄外をクリック（blur）すると自動保存されます。',
              '優先度（HIGH/MEDIUM/LOW）と担当を設定し、上部のフィルタで絞り込めます。',
              '解決したらチェックで RESOLVED に。「課題ツリーを作成」でこのGAPを起点にした打ち手の検討（なぜ型/どうやって型）へ展開できます。',
              '今回の取り組み範囲から外すGAPは、状態列の「対象/スコープ外」バッジをクリックしてスコープ外にします（行がグレーになり、ロードマップのGAP表示から除外されます）。',
            ]}
            shortcuts={[
              { keys: '⌘/Ctrl+Enter', desc: 'GAP追加を開く' },
              { keys: 'n', desc: 'GAP追加を開く' },
              { keys: '⌘/Ctrl+S', desc: '保存（セルは blur で自動保存）' },
              { keys: '?', desc: 'この操作方法を開く' },
            ]}
          />
          <ManualButton feature="gap-items" />
          <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" />
            GAP追加
          </Button>
        </div>
      </div>

      {/* タブ: GAP一覧（既定） / 分析 / 課題一覧・対応表 */}
      <Tabs defaultValue="list" className="space-y-4">
        <TabsList className="bg-gray-100 border border-gray-200">
          <TabsTrigger
            value="list"
            className="data-[state=active]:bg-white data-[state=active]:text-gray-900"
          >
            <GitCompareArrows className="h-4 w-4 mr-1.5" />
            GAP一覧
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className="data-[state=active]:bg-white data-[state=active]:text-gray-900"
          >
            <BarChart3 className="h-4 w-4 mr-1.5" />
            分析
          </TabsTrigger>
          <TabsTrigger
            value="ledger"
            className="data-[state=active]:bg-white data-[state=active]:text-gray-900"
          >
            <ClipboardList className="h-4 w-4 mr-1.5" />
            課題一覧 / 対応表
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-6">
      {/* フィルタ + 集計 */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Filter className="h-4 w-4" />
              フィルタ
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Label className="text-gray-700 text-sm">優先度</Label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger className="w-full sm:w-[140px] bg-white border-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value={ALL}>すべて</SelectItem>
                  <SelectItem value="HIGH">HIGH</SelectItem>
                  <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                  <SelectItem value="LOW">LOW</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Label className="text-gray-700 text-sm">状態</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[140px] bg-white border-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value={ALL}>すべて</SelectItem>
                  <SelectItem value="OPEN">OPEN</SelectItem>
                  <SelectItem value="RESOLVED">RESOLVED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* スコープフィルタ（チップ。既定「すべて」） */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Label className="text-gray-700 text-sm">スコープ</Label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                {SCOPE_FILTERS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setScopeFilter(opt.value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      scopeFilter === opt.value
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ml-auto flex items-center gap-3 text-sm">
              <span className="text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                OPEN {openCount}
              </span>
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                RESOLVED {resolvedCount}
              </span>
              <span className="text-gray-600 bg-gray-100 border border-gray-300 px-2 py-0.5 rounded">
                スコープ外 {outOfScopeCount}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 本体 */}
      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <Button variant="outline" onClick={fetchItems}>
              再読み込み
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <GitCompareArrows className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-700 font-medium mb-2">GAP（課題）がありません</p>
            <p className="text-sm text-gray-500 mb-1">
              GAP は <span className="font-semibold">TOBE（あるべき姿）</span> から{' '}
              <span className="font-semibold">ASIS（現状）</span> を引いた差分です。
            </p>
            <p className="text-sm text-gray-500 mb-4">
              この差分＝本当の課題を1行ずつ洗い出していきましょう。
            </p>
            <Button onClick={() => setIsCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              最初のGAPを追加
            </Button>
          </CardContent>
        </Card>
      ) : visibleItems.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="py-10 text-center text-sm text-gray-500">
            スコープフィルタ（
            {SCOPE_FILTERS.find((f) => f.value === scopeFilter)?.label}
            ）に一致するGAPがありません。
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white border-gray-200 overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              {/* GAPセルのコンボボックス候補（既存 gapDescription の重複なし） */}
              <datalist id="gap-description-options">
                {gapDescriptionOptions.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <SortableTh
                      label="業務領域"
                      sortKey="businessArea"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium w-[140px] border-b border-gray-200"
                    />
                    <SortableTh
                      label="ASIS（現状・数値込み）"
                      sortKey="asis"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium border-b border-gray-200"
                    >
                      <HelpTooltip text="ASIS＝現状。今どうなっているかを、できるだけ数値（件数・時間・コスト等）込みで事実ベースに記述します。" />
                    </SortableTh>
                    <SortableTh
                      label="TOBE（あるべき姿）"
                      sortKey="tobe"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium border-b border-gray-200"
                    >
                      <HelpTooltip text="TOBE＝あるべき姿。施策後に実現したい理想の状態を、これも数値目標込みで記述します。" />
                    </SortableTh>
                    <SortableTh
                      label="GAP（差分＝本当の課題）"
                      sortKey="gap"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium border-b border-gray-200 bg-amber-50/50"
                    >
                      <HelpTooltip text="GAP＝TOBE − ASIS。理想と現状の差分が、実際に解決すべき本当の課題です。この行を起点に打ち手を検討します。" />
                    </SortableTh>
                    <SortableTh
                      label="優先度"
                      sortKey="priority"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium w-[120px] border-b border-gray-200"
                    />
                    <SortableTh
                      label="担当"
                      sortKey="owner"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium w-[120px] border-b border-gray-200"
                    />
                    <SortableTh
                      label="状態"
                      sortKey="status"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="font-medium w-[110px] border-b border-gray-200"
                    />
                    <th className="px-3 py-2 font-medium w-[160px] border-b border-gray-200">
                      <span className="inline-flex items-center gap-1">
                        課題ツリー
                        <HelpTooltip text="このGAPを起点に、「なぜ起きるのか（なぜ型）」と「どう解決するか（打ち手/どうやって型）」をツリー状に分解して検討する画面へ展開できます。" />
                      </span>
                    </th>
                    <th className="px-3 py-2 font-medium w-[90px] border-b border-gray-200 text-center">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedItems.map((item) => {
                    const pm = priorityMeta[item.priority] ?? priorityMeta.MEDIUM;
                    const sm = statusMeta[item.status] ?? statusMeta.OPEN;
                    const resolved = item.status === 'RESOLVED';
                    const outOfScope = item.outOfScope;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-gray-100 border-l-4 ${
                          outOfScope ? 'border-l-gray-300' : pm.row
                        } align-top ${
                          outOfScope
                            ? 'bg-gray-50/80 opacity-60 hover:opacity-90'
                            : resolved
                              ? 'bg-emerald-50/30'
                              : 'hover:bg-gray-50/60'
                        }`}
                      >
                        {/* 業務領域 */}
                        <td className="px-3 py-2 align-top">
                          <textarea
                            defaultValue={item.businessArea}
                            onBlur={(e) =>
                              handleCellBlur(item, 'businessArea', e.target.value)
                            }
                            rows={2}
                            className="w-full resize-none bg-transparent text-gray-900 font-medium outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 py-0.5"
                          />
                          {/* ASIS / TOBE フロー名チップ（クリックでフロー編集へ） */}
                          {(item.asisFlowId || item.tobeFlowId) && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.asisFlowId && (
                                <Link
                                  href={`/dashboard/projects/${projectId}/flows/${item.asisFlowId}`}
                                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
                                  title="ASISフローを開く"
                                >
                                  ASIS:{' '}
                                  {flowById.get(item.asisFlowId)?.name ?? 'フロー'}
                                </Link>
                              )}
                              {item.tobeFlowId && (
                                <Link
                                  href={`/dashboard/projects/${projectId}/flows/${item.tobeFlowId}`}
                                  className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                                  title="TOBEフローを開く"
                                >
                                  TOBE:{' '}
                                  {flowById.get(item.tobeFlowId)?.name ?? 'フロー'}
                                </Link>
                              )}
                            </div>
                          )}
                        </td>
                        {/* ASIS: 既存ASISフローから選択 */}
                        <td className="px-3 py-2 align-top">
                          <Select
                            value={item.asisFlowId ?? NONE}
                            onValueChange={(v) => handleAsisFlowSelect(item, v)}
                          >
                            <SelectTrigger className="h-8 bg-white border-gray-300 text-xs text-gray-700">
                              <SelectValue placeholder="ASISフローを選択" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value={NONE}>（未設定）</SelectItem>
                              {asisFlowOptions.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        {/* TOBE: 既存TOBEフローから選択 */}
                        <td className="px-3 py-2 align-top">
                          <Select
                            value={item.tobeFlowId ?? NONE}
                            onValueChange={(v) => handleTobeFlowSelect(item, v)}
                          >
                            <SelectTrigger className="h-8 bg-white border-gray-300 text-xs text-gray-700">
                              <SelectValue placeholder="TOBEフローを選択" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value={NONE}>（未設定）</SelectItem>
                              {tobeFlowOptions.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        {/* GAP: 既存の値から選択 or 自由入力できるコンボボックス */}
                        <td className="px-3 py-2 align-top bg-amber-50/40">
                          <input
                            defaultValue={item.gapDescription ?? ''}
                            placeholder="差分＝本当の課題（TOBE − ASIS）"
                            list="gap-description-options"
                            onBlur={(e) =>
                              handleCellBlur(item, 'gapDescription', e.target.value)
                            }
                            className="w-full bg-transparent text-gray-900 outline-none focus:bg-white focus:ring-1 focus:ring-amber-400 rounded px-1 py-1 placeholder:text-gray-400"
                          />
                        </td>
                        {/* 優先度 */}
                        <td className="px-3 py-2 align-top">
                          <Select
                            value={item.priority}
                            onValueChange={(v) =>
                              handlePriorityChange(item, v as Priority)
                            }
                          >
                            <SelectTrigger
                              className={`h-8 border ${pm.badge} font-semibold text-xs`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value="HIGH">HIGH</SelectItem>
                              <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                              <SelectItem value="LOW">LOW</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        {/* 担当 */}
                        <td className="px-3 py-2 align-top">
                          <input
                            defaultValue={item.ownerName ?? ''}
                            placeholder="担当者"
                            onBlur={(e) => handleCellBlur(item, 'ownerName', e.target.value)}
                            className="w-full bg-transparent text-gray-700 outline-none focus:bg-white focus:ring-1 focus:ring-blue-300 rounded px-1 py-1 placeholder:text-gray-300"
                          />
                        </td>
                        {/* 状態 + スコープ外トグルバッジ */}
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`inline-block text-xs px-2 py-0.5 rounded border ${sm.badge}`}
                            >
                              {sm.label}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleToggleOutOfScope(item)}
                              title={
                                outOfScope
                                  ? 'スコープ外（クリックで対応対象に戻す）'
                                  : '対応対象（クリックでスコープ外にする）'
                              }
                              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs transition-colors ${
                                outOfScope
                                  ? 'border-gray-400 bg-gray-200 text-gray-700 hover:bg-gray-300'
                                  : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600'
                              }`}
                            >
                              <Ban className="h-3 w-3" />
                              {outOfScope ? 'スコープ外' : '対象'}
                            </button>
                          </div>
                        </td>
                        {/* 課題ツリー */}
                        <td className="px-3 py-2 align-top">
                          {item.issueTreeId ? (
                            <Link
                              href={`/dashboard/projects/${projectId}/issue-trees/${item.issueTreeId}`}
                              className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              ツリーを開く
                            </Link>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                              onClick={() => handleCreateIssueTree(item)}
                              disabled={creatingTreeId === item.id}
                            >
                              {creatingTreeId === item.id ? (
                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <GitBranch className="h-3.5 w-3.5 mr-1.5" />
                              )}
                              課題ツリーを作成
                            </Button>
                          )}
                        </td>
                        {/* 操作 */}
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center justify-center gap-1">
                            {resolved ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                                onClick={() => handleReopen(item)}
                                title="再オープン（OPENに戻す）"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => handleResolve(item)}
                                title="解決済みにする"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => handleDelete(item.id)}
                              title="削除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
        </TabsContent>

        {/* 分析タブ: bunseki 公式を実装したミニツール群 */}
        <TabsContent value="analysis">
          <AnalysisTab projectId={projectId} />
        </TabsContent>

        {/* 課題一覧 / 対応表タブ: 既存GAP itemsの台帳＋完備チェック＋優先度スコア＋TOBE3段階 */}
        <TabsContent value="ledger">
          <LedgerTab projectId={projectId} items={items} loading={loading} />
        </TabsContent>
      </Tabs>

      {/* 作成ダイアログ */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="bg-white border-gray-200 max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-gray-900 flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-blue-600" />
              GAPを追加
            </DialogTitle>
            <DialogDescription className="text-gray-500">
              業務領域ごとに ASIS（現状）と TOBE（あるべき姿）を書き、その差分＝本当の課題を整理します。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-gray-700">対象業務（業務フローから選択）</Label>
              <Select
                value={newItem.targetFlowId || NONE}
                onValueChange={handleTargetFlowChange}
              >
                <SelectTrigger className="bg-white border-gray-300">
                  <SelectValue placeholder="業務フローを選択（任意）" />
                </SelectTrigger>
                <SelectContent className="bg-white">
                  <SelectItem value={NONE}>選択しない（自由入力）</SelectItem>
                  {flows.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      [{f.kind}] {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">
                フローを選ぶと業務領域にフロー名が入ります。未選択でも下の欄に自由入力できます。
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-700">
                業務領域 <span className="text-red-500">*</span>
              </Label>
              <Input
                placeholder="例: 受発注業務"
                value={newItem.businessArea}
                onChange={(e) =>
                  setNewItem({ ...newItem, businessArea: e.target.value })
                }
                className="bg-white border-gray-300"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-700">ASISフロー（任意）</Label>
                <Select
                  value={newItem.asisFlowId || NONE}
                  onValueChange={handleAsisFlowChange}
                >
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue placeholder="ASISフローを選択" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value={NONE}>指定なし</SelectItem>
                    {asisFlowOptions.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newItem.asisFlowId && (
                  <Select
                    value={newItem.asisNodeId || NONE}
                    onValueChange={(v) =>
                      setNewItem((prev) => ({
                        ...prev,
                        asisNodeId: v === NONE ? '' : v,
                      }))
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-300">
                      <SelectValue placeholder="ノードを選択（任意）" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value={NONE}>指定なし</SelectItem>
                      {asisNodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">TOBEフロー（任意）</Label>
                <Select
                  value={newItem.tobeFlowId || NONE}
                  onValueChange={handleTobeFlowChange}
                >
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue placeholder="TOBEフローを選択" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value={NONE}>指定なし</SelectItem>
                    {tobeFlowOptions.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {newItem.tobeFlowId && (
                  <Select
                    value={newItem.tobeNodeId || NONE}
                    onValueChange={(v) =>
                      setNewItem((prev) => ({
                        ...prev,
                        tobeNodeId: v === NONE ? '' : v,
                      }))
                    }
                  >
                    <SelectTrigger className="bg-white border-gray-300">
                      <SelectValue placeholder="ノードを選択（任意）" />
                    </SelectTrigger>
                    <SelectContent className="bg-white">
                      <SelectItem value={NONE}>指定なし</SelectItem>
                      {tobeNodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-700">ASIS（現状・数値込み）</Label>
                <Textarea
                  placeholder="例: 紙の注文書をFAX受信。1件あたり15分かかる。"
                  value={newItem.asisDescription}
                  onChange={(e) =>
                    setNewItem({ ...newItem, asisDescription: e.target.value })
                  }
                  className="bg-white border-gray-300 min-h-[90px]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">TOBE（あるべき姿）</Label>
                <Textarea
                  placeholder="例: Webフォームで自動受注。1件あたり1分。"
                  value={newItem.tobeDescription}
                  onChange={(e) =>
                    setNewItem({ ...newItem, tobeDescription: e.target.value })
                  }
                  className="bg-white border-gray-300 min-h-[90px]"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-700">GAP（差分＝本当の課題）</Label>
              <Textarea
                placeholder="例: 手入力による転記ミスと処理遅延（14分/件のロス）が発生している。"
                value={newItem.gapDescription}
                onChange={(e) =>
                  setNewItem({ ...newItem, gapDescription: e.target.value })
                }
                className="bg-white border-gray-300 min-h-[80px]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-700">優先度</Label>
                <Select
                  value={newItem.priority}
                  onValueChange={(v) =>
                    setNewItem({ ...newItem, priority: v as Priority })
                  }
                >
                  <SelectTrigger className="bg-white border-gray-300">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    <SelectItem value="HIGH">HIGH</SelectItem>
                    <SelectItem value="MEDIUM">MEDIUM</SelectItem>
                    <SelectItem value="LOW">LOW</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">担当</Label>
                <Input
                  placeholder="例: 山田太郎"
                  value={newItem.ownerName}
                  onChange={(e) =>
                    setNewItem({ ...newItem, ownerName: e.target.value })
                  }
                  className="bg-white border-gray-300"
                />
              </div>
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
              disabled={!newItem.businessArea.trim() || creating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  追加中...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  追加
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
