'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { SubProjectPicker } from '@/components/ui/sub-project-picker';
import type { SubProjectMaster } from '@/lib/masters';
import { useReadOnly } from '@/components/read-only-context';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  GitBranch,
  Plus,
  Search,
  Clock,
  Play,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Layers,
  Pencil,
  Check,
  X,
  Trash2,
  GitFork,
  Settings2,
  FolderTree,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

const UNASSIGNED = '__unassigned__';
const ALL_DOMAINS = '__all__';

type FlowKind = 'ASIS' | 'TOBE';

type FlowData = {
  id: string;
  name: string;
  description?: string;
  version: number;
  kind?: FlowKind;
  confidence?: 'HYPOTHESIS' | 'CONFIRMED';
  nodesCount?: number;
  subProjectId?: string | null;
  updatedAt: string;
};

// 領域（SubProject）。parentId で 領域→サブ領域 の入れ子を持つ。
type SubProject = {
  id: string;
  projectId: string;
  parentId?: string | null;
  name: string;
  description?: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
};

type FlowGroup = {
  key: string;
  subProject: SubProject | null;
  flows: FlowData[];
};

// 領域の自己参照ツリーノード（描画用）
type SubProjectNode = {
  subProject: SubProject;
  depth: number;
  children: SubProjectNode[];
};

export default function ProjectFlowsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  // サイドバーの「業務フロー(ASIS)/(TOBE)」リンクは ?kind=asis|tobe を付ける。
  // それを ASIS/TOBE フィルタの初期値に反映する。
  const kindParam = searchParams.get('kind')?.toLowerCase();
  const initialKindFilter: 'ALL' | FlowKind =
    kindParam === 'asis' ? 'ASIS' : kindParam === 'tobe' ? 'TOBE' : 'ALL';

  const [flows, setFlows] = useState<FlowData[]>([]);
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<'ALL' | FlowKind>(initialKindFilter);
  // サイドバーで選択中の領域（ALL_DOMAINS=すべて / UNASSIGNED=領域なし / 領域ID）
  const [selectedDomainId, setSelectedDomainId] = useState<string>(ALL_DOMAINS);
  const [newFlow, setNewFlow] = useState<{
    name: string;
    description: string;
    kind: FlowKind;
    subProjectId: string;
  }>({ name: '', description: '', kind: 'ASIS', subProjectId: UNASSIGNED });
  const [editingSubProjectId, setEditingSubProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  // 業務フロー名のインライン編集（対象フローID＋編集中の名前）。
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);
  const [editingFlowName, setEditingFlowName] = useState('');
  // 折りたたみ状態（領域ID -> 折りたたみ中か）
  const [collapsedDomains, setCollapsedDomains] = useState<Record<string, boolean>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const howToRef = useRef<HTMLDivElement>(null);

  // ? でHowToPanelを開く / n・⌘Enterで作成 / / で検索フォーカス
  useKeyboardShortcuts([
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
    {
      combo: 'n',
      handler: () => setIsCreateDialogOpen(true),
    },
    {
      combo: 'mod+enter',
      whenTyping: true,
      handler: () => setIsCreateDialogOpen(true),
    },
    {
      combo: '/',
      handler: (e) => {
        e.preventDefault();
        searchInputRef.current?.focus();
      },
    },
  ]);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchFlows = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/project/${projectId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setFlows(data);
      }
    } catch (err) {
      console.error('Failed to fetch flows:', err);
    }
  }, [projectId, getHeaders]);

  const fetchSubProjects = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/sub-projects`, { headers });
      if (res.ok) {
        const data = await res.json();
        setSubProjects(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch sub-projects:', err);
    }
  }, [projectId, getHeaders]);

  const refetchAll = useCallback(async () => {
    await Promise.all([fetchFlows(), fetchSubProjects()]);
  }, [fetchFlows, fetchSubProjects]);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await refetchAll();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [refetchAll]);

  // ?kind= が変わったら ASIS/TOBE フィルタを追従させる
  // （サイドバーの ASIS/TOBE リンクをページ滞在中に踏み替えた場合に反映）
  useEffect(() => {
    setKindFilter(initialKindFilter);
  }, [initialKindFilter]);

  const handleCreateFlow = async () => {
    if (!newFlow.name) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          projectId,
          name: newFlow.name,
          description: newFlow.description || null,
          kind: newFlow.kind,
          subProjectId: newFlow.subProjectId === UNASSIGNED ? null : newFlow.subProjectId,
        }),
      });
      if (res.ok) {
        await fetchFlows();
        setIsCreateDialogOpen(false);
        setNewFlow({
          name: '',
          description: '',
          kind: 'ASIS',
          subProjectId:
            selectedDomainId === ALL_DOMAINS || selectedDomainId === UNASSIGNED
              ? UNASSIGNED
              : selectedDomainId,
        });
      }
    } catch (err) {
      console.error('Failed to create flow:', err);
    }
  };

  const handleRenameSubProject = async (id: string) => {
    const name = editingName.trim();
    if (!name) {
      setEditingSubProjectId(null);
      return;
    }

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/sub-projects/${id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await fetchSubProjects();
      }
    } catch (err) {
      console.error('Failed to rename sub-project:', err);
    } finally {
      setEditingSubProjectId(null);
      setEditingName('');
    }
  };

  // フローを領域へ割り当て
  const handleAssignSubProject = async (flowId: string, value: string) => {
    const subProjectId = value === UNASSIGNED ? null : value;
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${flowId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ subProjectId }),
      });
      if (res.ok) {
        await fetchFlows();
      }
    } catch (err) {
      console.error('Failed to assign sub-project:', err);
    }
  };

  // 業務フロー名のインライン編集を開始 / キャンセル。
  const startRenameFlow = (flow: FlowData) => {
    setEditingFlowId(flow.id);
    setEditingFlowName(flow.name);
  };
  const cancelRenameFlow = () => {
    setEditingFlowId(null);
    setEditingFlowName('');
  };

  // 業務フロー名を保存（PUT /business-flows/:id {name}）。
  const handleRenameFlow = async (flowId: string) => {
    const name = editingFlowName.trim();
    if (!name) {
      cancelRenameFlow();
      return;
    }
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${flowId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await fetchFlows();
      }
    } catch (err) {
      console.error('Failed to rename flow:', err);
    } finally {
      cancelRenameFlow();
    }
  };

  // 業務フローを削除（DELETE /business-flows/:id）。確認つき・元に戻せない。
  const handleDeleteFlow = async (flowId: string, name: string) => {
    if (
      !window.confirm(
        `業務フロー「${name}」を削除します。\nノード・矢印・図の内容もまとめて削除され、元に戻せません。よろしいですか？`,
      )
    ) {
      return;
    }
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${flowId}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        await fetchFlows();
      } else {
        window.alert('業務フローの削除に失敗しました');
      }
    } catch (err) {
      console.error('Failed to delete flow:', err);
      window.alert('業務フローの削除に失敗しました');
    }
  };

  // 領域の自己参照ツリーを構築（order → 名前 でソート、孤児はルート扱い）
  const subProjectTree = useMemo<SubProjectNode[]>(() => {
    const childrenOf = new Map<string | null, SubProject[]>();
    const validIds = new Set(subProjects.map((s) => s.id));
    for (const s of subProjects) {
      const parent = s.parentId && validIds.has(s.parentId) ? s.parentId : null;
      const list = childrenOf.get(parent) ?? [];
      list.push(s);
      childrenOf.set(parent, list);
    }
    const sortFn = (a: SubProject, b: SubProject) =>
      a.order - b.order || a.name.localeCompare(b.name, 'ja');

    const build = (parentId: string | null, depth: number): SubProjectNode[] =>
      (childrenOf.get(parentId) ?? [])
        .slice()
        .sort(sortFn)
        .map((subProject) => ({
          subProject,
          depth,
          children: build(subProject.id, depth + 1),
        }));

    return build(null, 0);
  }, [subProjects]);

  // ツリーを深さ優先でフラット化（描画順 = 親→子）
  const flatSubProjects = useMemo<SubProjectNode[]>(() => {
    const out: SubProjectNode[] = [];
    const walk = (nodes: SubProjectNode[]) => {
      for (const n of nodes) {
        out.push(n);
        walk(n.children);
      }
    };
    walk(subProjectTree);
    return out;
  }, [subProjectTree]);

  // SubProjectPicker（共通の領域ピッカー）用に SubProjectMaster 形へ正規化。
  const pickerSubProjects = useMemo<SubProjectMaster[]>(
    () =>
      subProjects.map((s) => ({
        id: s.id,
        projectId: s.projectId,
        parentId: s.parentId ?? null,
        name: s.name,
        description: s.description ?? null,
        order: s.order,
      })),
    [subProjects]
  );

  // 指定領域 + その子孫のID集合（領域選択フィルタ用）
  const descendantIds = useCallback(
    (subProjectId: string): Set<string> => {
      const ids = new Set<string>();
      const childrenOf = new Map<string | null, SubProject[]>();
      for (const s of subProjects) {
        const list = childrenOf.get(s.parentId ?? null) ?? [];
        list.push(s);
        childrenOf.set(s.parentId ?? null, list);
      }
      const walk = (id: string) => {
        if (ids.has(id)) return; // 循環(parentId ループ)で無限再帰しないよう防止
        ids.add(id);
        for (const c of childrenOf.get(id) ?? []) walk(c.id);
      };
      walk(subProjectId);
      return ids;
    },
    [subProjects],
  );

  const filteredFlows = useMemo(() => {
    const validSubProjectIds = new Set(subProjects.map((s) => s.id));
    // 領域選択フィルタの対象ID集合
    let allowedSubProjectIds: Set<string> | null = null;
    if (selectedDomainId !== ALL_DOMAINS && selectedDomainId !== UNASSIGNED) {
      allowedSubProjectIds = descendantIds(selectedDomainId);
    }

    return flows.filter((flow) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        flow.name.toLowerCase().includes(q) ||
        (flow.description?.toLowerCase().includes(q) ?? false);
      const matchesKind = kindFilter === 'ALL' || (flow.kind ?? 'ASIS') === kindFilter;

      const sid =
        flow.subProjectId && validSubProjectIds.has(flow.subProjectId) ? flow.subProjectId : null;
      let matchesDomain = true;
      if (selectedDomainId === UNASSIGNED) matchesDomain = sid === null;
      else if (allowedSubProjectIds)
        matchesDomain = sid !== null && allowedSubProjectIds.has(sid);

      return matchesSearch && matchesKind && matchesDomain;
    });
  }, [flows, subProjects, searchQuery, kindFilter, selectedDomainId, descendantIds]);

  // 領域ごとに含まれるフロー数（自領域直下のみ、サイドバーのバッジ用）
  const flowCountByDomain = useMemo(() => {
    const counts = new Map<string | null, number>();
    const validSubProjectIds = new Set(subProjects.map((s) => s.id));
    for (const flow of filteredFlows) {
      const sid =
        flow.subProjectId && validSubProjectIds.has(flow.subProjectId) ? flow.subProjectId : null;
      counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    return counts;
  }, [filteredFlows, subProjects]);

  // 各領域（フラット順）に属するフロー一覧 + 末尾に「領域なし」。
  type DomainSection = { node: SubProjectNode | null; flows: FlowData[] };
  const domainSections = useMemo<DomainSection[]>(() => {
    const validSubProjectIds = new Set(subProjects.map((s) => s.id));
    const bySubProject = new Map<string | null, FlowData[]>();
    for (const flow of filteredFlows) {
      const sid =
        flow.subProjectId && validSubProjectIds.has(flow.subProjectId) ? flow.subProjectId : null;
      const list = bySubProject.get(sid) ?? [];
      list.push(flow);
      bySubProject.set(sid, list);
    }

    const sections: DomainSection[] = flatSubProjects.map((node) => ({
      node,
      flows: bySubProject.get(node.subProject.id) ?? [],
    }));

    // 領域なし（領域未割当）は最後。領域選択フィルタ時は除外。
    if (selectedDomainId === ALL_DOMAINS || selectedDomainId === UNASSIGNED) {
      sections.push({ node: null, flows: bySubProject.get(null) ?? [] });
    }

    return sections;
  }, [filteredFlows, subProjects, flatSubProjects, selectedDomainId]);

  // 1領域分のフローを ASIS/TOBE で小分けする（既存の ASIS/TOBE 区別を維持）
  const groupByKind = useCallback((domainFlows: FlowData[]): FlowGroup[] => {
    const asis = domainFlows.filter((f) => (f.kind ?? 'ASIS') === 'ASIS');
    const tobe = domainFlows.filter((f) => (f.kind ?? 'ASIS') === 'TOBE');
    const result: FlowGroup[] = [];
    if (asis.length > 0) result.push({ key: 'ASIS', subProject: null, flows: asis });
    if (tobe.length > 0) result.push({ key: 'TOBE', subProject: null, flows: tobe });
    return result;
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
            <div className="flex items-center gap-2">
              <h1 className="text-3xl font-bold text-gray-900">業務フロー</h1>
              <HelpTooltip text="業務プロセスを誰が・何を・どの順で行うかをスイムレーン図で可視化します。現状（ASIS）とあるべき姿（TOBE）を作り分け、その差分が改善対象になります。" />
            </div>
            <p className="text-gray-500 mt-1">業務プロセスを可視化して管理</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 操作ガイド */}
          <div ref={howToRef}>
            <HowToPanel
              title="業務フロー一覧の使い方"
              steps={[
                'カードをクリックすると、そのフローのスイムレーン図を開けます。',
                '「フロー作成」で ASIS（現状）または TOBE（あるべき姿）のフローを新規作成します。',
                '左の領域ツリーで選択して絞り込めます。各カード下のセレクトでフローを領域へ振り分けます。',
                '領域（サブ領域含む）の追加・管理は「領域」メニューで行います。',
                '上部の検索・ASIS/TOBE フィルタで目的のフローに素早く絞り込めます。',
              ]}
              shortcuts={[
                { keys: 'N', desc: 'フロー作成ダイアログを開く' },
                { keys: '⌘/Ctrl+Enter', desc: 'フロー作成ダイアログを開く' },
                { keys: '/', desc: '検索ボックスにフォーカス' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </div>
          <ManualButton feature="flows" />
          {/* フォルダ階層で整理（クリックで潜れるフォルダ画面） */}
          <Link href={`/dashboard/projects/${projectId}/flows/folders`}>
            <Button variant="outline" className="border-gray-300 text-gray-700">
              <FolderTree className="h-4 w-4 mr-2" />
              フォルダ
            </Button>
          </Link>
          {/* Parent-child hierarchy map */}
          <Link href={`/dashboard/projects/${projectId}/flows/hierarchy`}>
            <Button variant="outline" className="border-gray-300 text-gray-700">
              <GitFork className="h-4 w-4 mr-2" />
              親子マップ
            </Button>
          </Link>
          {/* Manage domains (領域は「領域」メニューで管理) */}
          <Link href={`/dashboard/projects/${projectId}/domains`}>
            <Button variant="outline" className="border-gray-300 text-gray-700">
              <Settings2 className="h-4 w-4 mr-2" />
              領域を管理
            </Button>
          </Link>

          {/* Create flow（編集権限がある場合のみ） */}
          {canEdit && (
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                フロー作成
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-gray-200">
              <DialogHeader>
                <DialogTitle className="text-gray-900">新規フロー作成</DialogTitle>
                <DialogDescription className="text-gray-500">
                  新しい業務フローを作成します
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-gray-700">フロー名</Label>
                  <Input
                    id="name"
                    placeholder="注文処理フロー"
                    value={newFlow.name}
                    onChange={(e) => setNewFlow({ ...newFlow, name: e.target.value })}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-gray-700">説明</Label>
                  <Input
                    id="description"
                    placeholder="フローの説明を入力"
                    value={newFlow.description}
                    onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-gray-700">領域</Label>
                    <HelpTooltip text="フローをまとめる業務単位の領域です。受注管理・出荷管理など、関連するフローを束ねて整理できます。領域→サブ領域の入れ子も使えます（領域なしのままでもOK）。" />
                  </div>
                  {/* 共通の領域ピッカー（ツリー＋検索）。クリアで領域なし（UNASSIGNED）に戻す。 */}
                  <div>
                    <SubProjectPicker
                      subProjects={pickerSubProjects}
                      value={newFlow.subProjectId === UNASSIGNED ? '' : newFlow.subProjectId}
                      onChange={(v) =>
                        setNewFlow({ ...newFlow, subProjectId: v === '' ? UNASSIGNED : v })
                      }
                      placeholder="領域を選択"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label className="text-gray-700">種別</Label>
                    <HelpTooltip text="ASIS（現状）は今の業務の流れ、TOBE（あるべき姿）は改善後の理想の流れです。両者の差（GAP）が改善・システム化の対象になります。" />
                  </div>
                  <div className="flex gap-2">
                    {(['ASIS', 'TOBE'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setNewFlow({ ...newFlow, kind: k })}
                        className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          newFlow.kind === k
                            ? k === 'TOBE'
                              ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                              : 'border-blue-400 bg-blue-50 text-blue-700'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {k === 'ASIS' ? 'ASIS（現状）' : 'TOBE（あるべき姿）'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                  className="border-gray-300 text-gray-700"
                >
                  キャンセル
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateFlow}>
                  作成
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      {/* Search + Kind filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            ref={searchInputRef}
            placeholder="フローを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400"
          />
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm self-start">
          {(['ALL', 'ASIS', 'TOBE'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKindFilter(k)}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                kindFilter === k ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {k === 'ALL' ? 'すべて' : k}
            </button>
          ))}
        </div>
      </div>

      {/* Two-column: domain tree sidebar + grouped flows */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Domain tree sidebar */}
        <aside className="lg:w-64 lg:flex-shrink-0">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Layers className="h-4 w-4 text-gray-400" />
                領域
              </div>
              <Link
                href={`/dashboard/projects/${projectId}/domains`}
                className="text-gray-400 hover:text-blue-600"
                aria-label="領域を管理"
                title="領域を管理"
              >
                <Settings2 className="h-4 w-4" />
              </Link>
            </div>
            <div className="p-2 space-y-0.5 max-h-[60vh] overflow-y-auto">
              {/* すべて */}
              <button
                type="button"
                onClick={() => setSelectedDomainId(ALL_DOMAINS)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  selectedDomainId === ALL_DOMAINS
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Layers className="h-4 w-4 flex-shrink-0 opacity-70" />
                <span className="truncate">すべてのフロー</span>
                <span className="ml-auto text-[10px] text-gray-400">{filteredFlows.length}</span>
              </button>

              {/* 領域ツリー */}
              {flatSubProjects.map((node) => {
                const isSelected = selectedDomainId === node.subProject.id;
                const isCollapsed = !!collapsedDomains[node.subProject.id];
                // 折りたたまれた祖先があれば非表示
                let hiddenByAncestor = false;
                let p = node.subProject.parentId ?? null;
                const byId = new Map(subProjects.map((s) => [s.id, s] as const));
                while (p) {
                  if (collapsedDomains[p]) {
                    hiddenByAncestor = true;
                    break;
                  }
                  p = byId.get(p)?.parentId ?? null;
                }
                if (hiddenByAncestor) return null;

                return (
                  <div
                    key={node.subProject.id}
                    className={`group flex items-center gap-1 rounded-md pr-1 ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                    style={{ paddingLeft: `${node.depth * 12}px` }}
                  >
                    {node.children.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedDomains((prev) => ({
                            ...prev,
                            [node.subProject.id]: !prev[node.subProject.id],
                          }))
                        }
                        className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                        aria-label={isCollapsed ? '展開' : '折りたたみ'}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="w-3.5 flex-shrink-0" />
                    )}

                    <button
                      type="button"
                      onClick={() => setSelectedDomainId(node.subProject.id)}
                      title={node.subProject.name}
                      className={`flex flex-1 items-center gap-1.5 py-1.5 text-left text-sm min-w-0 ${
                        isSelected ? 'text-blue-700 font-medium' : 'text-gray-600'
                      }`}
                    >
                      <Layers className="h-4 w-4 flex-shrink-0 opacity-70" />
                      <span className="truncate">{node.subProject.name}</span>
                      <span className="ml-auto text-[10px] text-gray-400">
                        {flowCountByDomain.get(node.subProject.id) ?? 0}
                      </span>
                    </button>
                  </div>
                );
              })}

              {/* 領域なし */}
              <button
                type="button"
                onClick={() => setSelectedDomainId(UNASSIGNED)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  selectedDomainId === UNASSIGNED
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Layers className="h-4 w-4 flex-shrink-0 opacity-40" />
                <span className="truncate">領域なし</span>
                <span className="ml-auto text-[10px] text-gray-400">
                  {flowCountByDomain.get(null) ?? 0}
                </span>
              </button>

              {subProjects.length === 0 && (
                <p className="px-2 py-3 text-xs text-gray-400 leading-relaxed">
                  領域がありません。
                  <Link
                    href={`/dashboard/projects/${projectId}/domains`}
                    className="text-blue-600 hover:underline"
                  >
                    「領域」メニュー
                  </Link>
                  で領域・サブ領域を作成して、フローを分類できます。
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Main: grouped flows */}
        <div className="flex-1 min-w-0">
          {filteredFlows.length > 0 ? (
            <div className="space-y-8">
              {domainSections.map((section) => {
                // 中身が無い領域セクションは非表示（領域なし含む）
                if (section.flows.length === 0) return null;

                const domainId = section.node?.subProject.id ?? UNASSIGNED;
                const kindGroups = groupByKind(section.flows);

                return (
                  <section key={domainId} className="space-y-3">
                    {/* Domain section header */}
                    <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
                      <Layers
                        className={`h-4 w-4 ${section.node ? 'text-blue-400' : 'text-gray-300'}`}
                      />
                      {section.node && editingSubProjectId === section.node.subProject.id ? (
                        <div className="flex items-center gap-2">
                          <Input
                            autoFocus
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                handleRenameSubProject(section.node!.subProject.id);
                              if (e.key === 'Escape') {
                                setEditingSubProjectId(null);
                                setEditingName('');
                              }
                            }}
                            className="h-7 w-full sm:w-56 bg-white border-gray-300 text-gray-900 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => handleRenameSubProject(section.node!.subProject.id)}
                            className="text-emerald-600 hover:text-emerald-700"
                            aria-label="保存"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubProjectId(null);
                              setEditingName('');
                            }}
                            className="text-gray-400 hover:text-gray-600"
                            aria-label="キャンセル"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <h2 className="text-lg font-semibold text-gray-900">
                            {section.node ? section.node.subProject.name : '領域なし'}
                          </h2>
                          <span className="text-xs text-gray-400">{section.flows.length}</span>
                          {section.node && canEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSubProjectId(section.node!.subProject.id);
                                setEditingName(section.node!.subProject.name);
                              }}
                              className="text-gray-400 hover:text-gray-600"
                              aria-label="名前を変更"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* ASIS/TOBE sub-groups within this domain */}
                    {kindGroups.map((group) => (
                      <div key={`${domainId}-${group.key}`} className="space-y-2">
                        {/* kind label (only show if multiple kind groups) */}
                        {kindGroups.length > 1 && (
                          <div className="flex items-center gap-2 pl-1">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                group.key === 'TOBE'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-blue-100 text-blue-700'
                              }`}
                            >
                              {group.key}
                            </span>
                            <span className="text-[10px] text-gray-400">{group.flows.length}</span>
                          </div>
                        )}

                        {/* Flow cards */}
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                          {group.flows.map((flow) => (
                            <Card
                              key={flow.id}
                              className="bg-white border-gray-200 hover:border-gray-300 hover:shadow-md transition-all h-full flex flex-col"
                            >
                              <Link
                                href={`/dashboard/projects/${projectId}/flows/${flow.id}`}
                                className="block flex-1"
                              >
                                <CardHeader className="pb-3">
                                  <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-lg bg-cyan-100 flex items-center justify-center">
                                        <GitBranch className="h-5 w-5 text-cyan-600" />
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <CardTitle className="text-gray-900 text-lg">
                                            {flow.name}
                                          </CardTitle>
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                              (flow.kind ?? 'ASIS') === 'TOBE'
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-blue-100 text-blue-700'
                                            }`}
                                          >
                                            {flow.kind ?? 'ASIS'}
                                          </span>
                                          {flow.confidence === 'HYPOTHESIS' && (
                                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700">
                                              仮説
                                            </span>
                                          )}
                                        </div>
                                        <span className="text-xs text-gray-500">
                                          v{flow.version}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </CardHeader>
                                <CardContent>
                                  <p className="text-sm text-gray-500 line-clamp-2 mb-4">
                                    {flow.description || '説明なし'}
                                  </p>
                                  <div className="flex items-center justify-between text-xs text-gray-500">
                                    {flow.nodesCount !== undefined && (
                                      <div className="flex items-center gap-1">
                                        <Play className="h-3 w-3" />
                                        {flow.nodesCount} ノード
                                      </div>
                                    )}
                                    <div className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {formatDate(flow.updatedAt)}
                                    </div>
                                  </div>
                                </CardContent>
                              </Link>
                              {/* Per-flow domain assignment（編集権限がある場合のみ） */}
                              {canEdit && (
                              <div className="space-y-1.5 border-t border-gray-100 px-6 py-3">
                                {/* フロー名の変更 / 削除 */}
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 whitespace-nowrap w-20">
                                    フロー名
                                  </span>
                                  {editingFlowId === flow.id ? (
                                    <div className="flex flex-1 items-center gap-1">
                                      <Input
                                        value={editingFlowName}
                                        onChange={(e) =>
                                          setEditingFlowName(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter')
                                            handleRenameFlow(flow.id);
                                          if (e.key === 'Escape')
                                            cancelRenameFlow();
                                        }}
                                        autoFocus
                                        className="h-8 flex-1"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleRenameFlow(flow.id)}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-emerald-600 hover:bg-emerald-50"
                                        title="保存"
                                        aria-label="保存"
                                      >
                                        <Check className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={cancelRenameFlow}
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100"
                                        title="キャンセル"
                                        aria-label="キャンセル"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex flex-1 items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() => startRenameFlow(flow)}
                                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                                        title="フロー名を変更"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                        名前変更
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleDeleteFlow(flow.id, flow.name)
                                        }
                                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                                        title="この業務フローを削除"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        削除
                                      </button>
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 whitespace-nowrap w-20">
                                    領域
                                  </span>
                                  {/* 共通の領域ピッカー（ツリー＋検索）。クリアで領域なし（UNASSIGNED→null）に戻す。 */}
                                  <SubProjectPicker
                                    subProjects={pickerSubProjects}
                                    value={flow.subProjectId ?? ''}
                                    onChange={(v) =>
                                      handleAssignSubProject(
                                        flow.id,
                                        v === '' ? UNASSIGNED : v
                                      )
                                    }
                                    placeholder="領域を選択"
                                    className="flex-1"
                                  />
                                </div>
                              </div>
                              )}
                            </Card>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                );
              })}
            </div>
          ) : (
            <Card className="bg-white border-gray-200">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <GitBranch className="h-8 w-8 text-gray-400" />
                </div>
                <p className="text-gray-500 mb-2">フローが見つかりません</p>
                <p className="text-sm text-gray-400 mb-4">
                  {searchQuery || selectedDomainId !== ALL_DOMAINS
                    ? '検索条件・領域を変更してください'
                    : '最初のフローを作成しましょう'}
                </p>
                {!searchQuery && selectedDomainId === ALL_DOMAINS && canEdit && (
                  <Button
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={() => setIsCreateDialogOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    フロー作成
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
