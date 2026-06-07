'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
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
  FolderPlus,
  Folder,
  FolderTree,
  Layers,
  Pencil,
  Check,
  X,
  Trash2,
  GitFork,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

const UNASSIGNED = '__unassigned__';
const ALL_FOLDERS = '__all__';

type FlowKind = 'ASIS' | 'TOBE';

type FlowFolder = {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
};

type FlowData = {
  id: string;
  name: string;
  description?: string;
  version: number;
  kind?: FlowKind;
  confidence?: 'HYPOTHESIS' | 'CONFIRMED';
  nodesCount?: number;
  subProjectId?: string | null;
  folderId?: string | null;
  updatedAt: string;
};

type SubProject = {
  id: string;
  projectId: string;
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

// フォルダの自己参照ツリーノード（描画用）
type FolderNode = {
  folder: FlowFolder;
  depth: number;
  children: FolderNode[];
};

export default function ProjectFlowsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;

  // サイドバーの「業務フロー(ASIS)/(TOBE)」リンクは ?kind=asis|tobe を付ける。
  // それを ASIS/TOBE フィルタの初期値に反映する。
  const kindParam = searchParams.get('kind')?.toLowerCase();
  const initialKindFilter: 'ALL' | FlowKind =
    kindParam === 'asis' ? 'ASIS' : kindParam === 'tobe' ? 'TOBE' : 'ALL';

  const [flows, setFlows] = useState<FlowData[]>([]);
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [folders, setFolders] = useState<FlowFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isSubProjectDialogOpen, setIsSubProjectDialogOpen] = useState(false);
  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<'ALL' | FlowKind>(initialKindFilter);
  // サイドバーで選択中のフォルダ（ALL_FOLDERS=すべて / UNASSIGNED=未分類 / フォルダID）
  const [selectedFolderId, setSelectedFolderId] = useState<string>(ALL_FOLDERS);
  const [newFlow, setNewFlow] = useState<{
    name: string;
    description: string;
    kind: FlowKind;
    subProjectId: string;
    folderId: string;
  }>({ name: '', description: '', kind: 'ASIS', subProjectId: UNASSIGNED, folderId: UNASSIGNED });
  const [newSubProject, setNewSubProject] = useState<{ name: string; description: string }>({
    name: '',
    description: '',
  });
  // フォルダ作成ダイアログ（親フォルダを選んで作る）
  const [newFolder, setNewFolder] = useState<{ name: string; parentId: string }>({
    name: '',
    parentId: UNASSIGNED,
  });
  const [editingSubProjectId, setEditingSubProjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  // フォルダのインライン編集
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  // 折りたたみ状態（フォルダID -> 折りたたみ中か）
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});

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
        setSubProjects(data);
      }
    } catch (err) {
      console.error('Failed to fetch sub-projects:', err);
    }
  }, [projectId, getHeaders]);

  const fetchFolders = useCallback(async () => {
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/flow-folders`, { headers });
      if (res.ok) {
        const data = await res.json();
        setFolders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch flow folders:', err);
    }
  }, [projectId, getHeaders]);

  const refetchAll = useCallback(async () => {
    await Promise.all([fetchFlows(), fetchSubProjects(), fetchFolders()]);
  }, [fetchFlows, fetchSubProjects, fetchFolders]);

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
          folderId: newFlow.folderId === UNASSIGNED ? null : newFlow.folderId,
        }),
      });
      if (res.ok) {
        await fetchFlows();
        setIsCreateDialogOpen(false);
        setNewFlow({
          name: '',
          description: '',
          kind: 'ASIS',
          subProjectId: UNASSIGNED,
          folderId: selectedFolderId === ALL_FOLDERS || selectedFolderId === UNASSIGNED ? UNASSIGNED : selectedFolderId,
        });
      }
    } catch (err) {
      console.error('Failed to create flow:', err);
    }
  };

  const handleCreateSubProject = async () => {
    if (!newSubProject.name) return;

    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/sub-projects`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: newSubProject.name,
          description: newSubProject.description || null,
        }),
      });
      if (res.ok) {
        await fetchSubProjects();
        setIsSubProjectDialogOpen(false);
        setNewSubProject({ name: '', description: '' });
      }
    } catch (err) {
      console.error('Failed to create sub-project:', err);
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

  // ===== フォルダ操作 =====

  const handleCreateFolder = async () => {
    const name = newFolder.name.trim();
    if (!name) return;
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/projects/${projectId}/flow-folders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name,
          parentId: newFolder.parentId === UNASSIGNED ? null : newFolder.parentId,
        }),
      });
      if (res.ok) {
        await fetchFolders();
        setIsFolderDialogOpen(false);
        setNewFolder({ name: '', parentId: UNASSIGNED });
      }
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = editingFolderName.trim();
    if (!name) {
      setEditingFolderId(null);
      setEditingFolderName('');
      return;
    }
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/flow-folders/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        await fetchFolders();
      }
    } catch (err) {
      console.error('Failed to rename folder:', err);
    } finally {
      setEditingFolderId(null);
      setEditingFolderName('');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('このフォルダを削除しますか？子フォルダもまとめて削除され、中のフローは未分類になります。')) {
      return;
    }
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/flow-folders/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        if (selectedFolderId === id) setSelectedFolderId(ALL_FOLDERS);
        await Promise.all([fetchFolders(), fetchFlows()]);
      }
    } catch (err) {
      console.error('Failed to delete folder:', err);
    }
  };

  // フォルダの入れ子（親）を変更
  const handleMoveFolder = async (id: string, value: string) => {
    const parentId = value === UNASSIGNED ? null : value;
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/flow-folders/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ parentId }),
      });
      if (res.ok) {
        await fetchFolders();
      }
    } catch (err) {
      console.error('Failed to move folder:', err);
    }
  };

  // フローをフォルダに振り分け
  const handleAssignFolder = async (flowId: string, value: string) => {
    const folderId = value === UNASSIGNED ? null : value;
    try {
      const headers = getHeaders();
      const res = await fetch(`${API_URL}/api/business-flows/${flowId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ folderId }),
      });
      if (res.ok) {
        await fetchFlows();
      }
    } catch (err) {
      console.error('Failed to assign folder:', err);
    }
  };

  // フォルダの自己参照ツリーを構築（order → 名前 でソート、孤児はルート扱い）
  const folderTree = useMemo<FolderNode[]>(() => {
    const childrenOf = new Map<string | null, FlowFolder[]>();
    const validIds = new Set(folders.map((f) => f.id));
    for (const f of folders) {
      const parent = f.parentId && validIds.has(f.parentId) ? f.parentId : null;
      const list = childrenOf.get(parent) ?? [];
      list.push(f);
      childrenOf.set(parent, list);
    }
    const sortFn = (a: FlowFolder, b: FlowFolder) =>
      a.order - b.order || a.name.localeCompare(b.name, 'ja');

    const build = (parentId: string | null, depth: number): FolderNode[] =>
      (childrenOf.get(parentId) ?? [])
        .slice()
        .sort(sortFn)
        .map((folder) => ({
          folder,
          depth,
          children: build(folder.id, depth + 1),
        }));

    return build(null, 0);
  }, [folders]);

  // ツリーを深さ優先でフラット化（描画順 = 親→子）
  const flatFolders = useMemo<FolderNode[]>(() => {
    const out: FolderNode[] = [];
    const walk = (nodes: FolderNode[]) => {
      for (const n of nodes) {
        out.push(n);
        walk(n.children);
      }
    };
    walk(folderTree);
    return out;
  }, [folderTree]);

  // 指定フォルダ + その子孫のID集合（フォルダ選択フィルタ用）
  const descendantIds = useCallback(
    (folderId: string): Set<string> => {
      const ids = new Set<string>();
      const childrenOf = new Map<string | null, FlowFolder[]>();
      for (const f of folders) {
        const list = childrenOf.get(f.parentId ?? null) ?? [];
        list.push(f);
        childrenOf.set(f.parentId ?? null, list);
      }
      const walk = (id: string) => {
        ids.add(id);
        for (const c of childrenOf.get(id) ?? []) walk(c.id);
      };
      walk(folderId);
      return ids;
    },
    [folders],
  );

  const filteredFlows = useMemo(() => {
    const validFolderIds = new Set(folders.map((f) => f.id));
    // フォルダ選択フィルタの対象ID集合
    let allowedFolderIds: Set<string> | null = null;
    if (selectedFolderId !== ALL_FOLDERS && selectedFolderId !== UNASSIGNED) {
      allowedFolderIds = descendantIds(selectedFolderId);
    }

    return flows.filter((flow) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        flow.name.toLowerCase().includes(q) ||
        (flow.description?.toLowerCase().includes(q) ?? false);
      const matchesKind = kindFilter === 'ALL' || (flow.kind ?? 'ASIS') === kindFilter;

      const fid = flow.folderId && validFolderIds.has(flow.folderId) ? flow.folderId : null;
      let matchesFolder = true;
      if (selectedFolderId === UNASSIGNED) matchesFolder = fid === null;
      else if (allowedFolderIds) matchesFolder = fid !== null && allowedFolderIds.has(fid);

      return matchesSearch && matchesKind && matchesFolder;
    });
  }, [flows, folders, searchQuery, kindFilter, selectedFolderId, descendantIds]);

  // フォルダごとに含まれるフロー数（自フォルダ直下のみ、サイドバーのバッジ用）
  const flowCountByFolder = useMemo(() => {
    const counts = new Map<string | null, number>();
    const validFolderIds = new Set(folders.map((f) => f.id));
    for (const flow of filteredFlows) {
      const fid = flow.folderId && validFolderIds.has(flow.folderId) ? flow.folderId : null;
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
    return counts;
  }, [filteredFlows, folders]);

  // 1フォルダ分のフローを sub-project ごとに小分けする（既存のサブプロジェクト構造を維持）
  const groupBySubProject = useCallback(
    (folderFlows: FlowData[]): FlowGroup[] => {
      const byId = new Map<string, FlowData[]>();
      const unassigned: FlowData[] = [];

      for (const flow of folderFlows) {
        const spId = flow.subProjectId ?? null;
        if (spId && subProjects.some((sp) => sp.id === spId)) {
          const list = byId.get(spId) ?? [];
          list.push(flow);
          byId.set(spId, list);
        } else {
          unassigned.push(flow);
        }
      }

      const result: FlowGroup[] = subProjects
        .map((sp) => ({ key: sp.id, subProject: sp, flows: byId.get(sp.id) ?? [] }))
        .filter((g) => g.flows.length > 0);

      if (unassigned.length > 0) {
        result.push({ key: UNASSIGNED, subProject: null, flows: unassigned });
      }
      return result;
    },
    [subProjects],
  );

  // 各フォルダ（フラット順）に属するフロー一覧 + 末尾に未分類フォルダ。
  type FolderSection = { node: FolderNode | null; flows: FlowData[] };
  const folderSections = useMemo<FolderSection[]>(() => {
    const validFolderIds = new Set(folders.map((f) => f.id));
    const byFolder = new Map<string | null, FlowData[]>();
    for (const flow of filteredFlows) {
      const fid = flow.folderId && validFolderIds.has(flow.folderId) ? flow.folderId : null;
      const list = byFolder.get(fid) ?? [];
      list.push(flow);
      byFolder.set(fid, list);
    }

    const sections: FolderSection[] = flatFolders.map((node) => ({
      node,
      flows: byFolder.get(node.folder.id) ?? [],
    }));

    // 未分類（フォルダ未割当）は最後。フォルダ選択フィルタ時は除外。
    if (selectedFolderId === ALL_FOLDERS || selectedFolderId === UNASSIGNED) {
      sections.push({ node: null, flows: byFolder.get(null) ?? [] });
    }

    return sections;
  }, [filteredFlows, folders, flatFolders, selectedFolderId]);

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

  const selectClass =
    'rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400';

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
                '「フォルダ追加」で業務分類のフォルダを作り（入れ子可）、左のツリーで選択して絞り込めます。各カード下のセレクトでフローをフォルダ／サブプロジェクトに振り分けます。',
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
          {/* Parent-child hierarchy map */}
          <Link href={`/dashboard/projects/${projectId}/flows/hierarchy`}>
            <Button variant="outline" className="border-gray-300 text-gray-700">
              <GitFork className="h-4 w-4 mr-2" />
              親子マップ
            </Button>
          </Link>
          {/* Add folder */}
          <Dialog open={isFolderDialogOpen} onOpenChange={setIsFolderDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-gray-300 text-gray-700">
                <FolderTree className="h-4 w-4 mr-2" />
                フォルダ追加
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-gray-200">
              <DialogHeader>
                <DialogTitle className="text-gray-900">フォルダ追加</DialogTitle>
                <DialogDescription className="text-gray-500">
                  フローを分類するフォルダを作成します（親フォルダを選んで入れ子にできます）
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="folder-name" className="text-gray-700">フォルダ名</Label>
                  <Input
                    id="folder-name"
                    placeholder="受発注業務"
                    value={newFolder.name}
                    onChange={(e) => setNewFolder({ ...newFolder, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateFolder();
                    }}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="folder-parent" className="text-gray-700">親フォルダ</Label>
                  <select
                    id="folder-parent"
                    value={newFolder.parentId}
                    onChange={(e) => setNewFolder({ ...newFolder, parentId: e.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value={UNASSIGNED}>（最上位）</option>
                    {flatFolders.map((node) => (
                      <option key={node.folder.id} value={node.folder.id}>
                        {`${'　'.repeat(node.depth)}${node.folder.name}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsFolderDialogOpen(false)}
                  className="border-gray-300 text-gray-700"
                >
                  キャンセル
                </Button>
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateFolder}>
                  作成
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Add sub-project */}
          <Dialog open={isSubProjectDialogOpen} onOpenChange={setIsSubProjectDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="border-gray-300 text-gray-700">
                <FolderPlus className="h-4 w-4 mr-2" />
                サブプロジェクト追加
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-white border-gray-200">
              <DialogHeader>
                <DialogTitle className="text-gray-900">サブプロジェクト追加</DialogTitle>
                <DialogDescription className="text-gray-500">
                  フローをまとめるサブプロジェクトを作成します
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="sp-name" className="text-gray-700">サブプロジェクト名</Label>
                  <Input
                    id="sp-name"
                    placeholder="受注管理"
                    value={newSubProject.name}
                    onChange={(e) => setNewSubProject({ ...newSubProject, name: e.target.value })}
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sp-description" className="text-gray-700">説明</Label>
                  <Input
                    id="sp-description"
                    placeholder="サブプロジェクトの説明を入力"
                    value={newSubProject.description}
                    onChange={(e) =>
                      setNewSubProject({ ...newSubProject, description: e.target.value })
                    }
                    className="bg-white border-gray-300 text-gray-900"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsSubProjectDialogOpen(false)}
                  className="border-gray-300 text-gray-700"
                >
                  キャンセル
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  onClick={handleCreateSubProject}
                >
                  作成
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Create flow */}
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
                    <Label htmlFor="flow-folder" className="text-gray-700">フォルダ</Label>
                    <HelpTooltip text="フローを分類するフォルダです。入れ子にして業務分類を整理できます（未分類のままでもOK）。" />
                  </div>
                  <select
                    id="flow-folder"
                    value={newFlow.folderId}
                    onChange={(e) => setNewFlow({ ...newFlow, folderId: e.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value={UNASSIGNED}>未分類</option>
                    {flatFolders.map((node) => (
                      <option key={node.folder.id} value={node.folder.id}>
                        {`${'　'.repeat(node.depth)}${node.folder.name}`}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="flow-sub-project" className="text-gray-700">サブプロジェクト</Label>
                    <HelpTooltip text="フローをまとめる業務単位のフォルダです。受注管理・出荷管理など、関連するフローを束ねて整理できます（未分類のままでもOK）。" />
                  </div>
                  <select
                    id="flow-sub-project"
                    value={newFlow.subProjectId}
                    onChange={(e) => setNewFlow({ ...newFlow, subProjectId: e.target.value })}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value={UNASSIGNED}>未分類</option>
                    {subProjects.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}
                      </option>
                    ))}
                  </select>
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

      {/* Two-column: folder tree sidebar + grouped flows */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Folder tree sidebar */}
        <aside className="lg:w-64 lg:flex-shrink-0">
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <FolderTree className="h-4 w-4 text-gray-400" />
                フォルダ
              </div>
              <button
                type="button"
                onClick={() => setIsFolderDialogOpen(true)}
                className="text-gray-400 hover:text-blue-600"
                aria-label="フォルダ追加"
                title="フォルダ追加"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <div className="p-2 space-y-0.5 max-h-[60vh] overflow-y-auto">
              {/* すべて */}
              <button
                type="button"
                onClick={() => setSelectedFolderId(ALL_FOLDERS)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  selectedFolderId === ALL_FOLDERS
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Layers className="h-4 w-4 flex-shrink-0 opacity-70" />
                <span className="truncate">すべてのフロー</span>
                <span className="ml-auto text-[10px] text-gray-400">{filteredFlows.length}</span>
              </button>

              {/* フォルダツリー */}
              {flatFolders.map((node) => {
                const isSelected = selectedFolderId === node.folder.id;
                const isEditingThis = editingFolderId === node.folder.id;
                const isCollapsed = !!collapsedFolders[node.folder.id];
                // 折りたたまれた祖先があれば非表示
                let hiddenByAncestor = false;
                let p = node.folder.parentId;
                const byId = new Map(folders.map((f) => [f.id, f] as const));
                while (p) {
                  if (collapsedFolders[p]) {
                    hiddenByAncestor = true;
                    break;
                  }
                  p = byId.get(p)?.parentId ?? null;
                }
                if (hiddenByAncestor) return null;

                return (
                  <div
                    key={node.folder.id}
                    className={`group flex items-center gap-1 rounded-md pr-1 ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                    style={{ paddingLeft: `${node.depth * 12}px` }}
                  >
                    {node.children.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setCollapsedFolders((prev) => ({
                            ...prev,
                            [node.folder.id]: !prev[node.folder.id],
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

                    {isEditingThis ? (
                      <div className="flex flex-1 items-center gap-1 py-1">
                        <Input
                          autoFocus
                          value={editingFolderName}
                          onChange={(e) => setEditingFolderName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenameFolder(node.folder.id);
                            if (e.key === 'Escape') {
                              setEditingFolderId(null);
                              setEditingFolderName('');
                            }
                          }}
                          className="h-7 flex-1 bg-white border-gray-300 text-gray-900 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => handleRenameFolder(node.folder.id)}
                          className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"
                          aria-label="保存"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFolderId(null);
                            setEditingFolderName('');
                          }}
                          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                          aria-label="キャンセル"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setSelectedFolderId(node.folder.id)}
                          title={node.folder.name}
                          className={`flex flex-1 items-center gap-1.5 py-1.5 text-left text-sm min-w-0 ${
                            isSelected ? 'text-blue-700 font-medium' : 'text-gray-600'
                          }`}
                        >
                          <Folder className="h-4 w-4 flex-shrink-0 opacity-70" />
                          <span className="truncate">{node.folder.name}</span>
                          <span className="ml-auto text-[10px] text-gray-400">
                            {flowCountByFolder.get(node.folder.id) ?? 0}
                          </span>
                        </button>
                        <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingFolderId(node.folder.id);
                              setEditingFolderName(node.folder.name);
                            }}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            aria-label="名前を変更"
                            title="名前を変更"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteFolder(node.folder.id)}
                            className="text-gray-400 hover:text-red-600 p-0.5"
                            aria-label="削除"
                            title="削除"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* 未分類 */}
              <button
                type="button"
                onClick={() => setSelectedFolderId(UNASSIGNED)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  selectedFolderId === UNASSIGNED
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Folder className="h-4 w-4 flex-shrink-0 opacity-40" />
                <span className="truncate">未分類</span>
                <span className="ml-auto text-[10px] text-gray-400">
                  {flowCountByFolder.get(null) ?? 0}
                </span>
              </button>

              {folders.length === 0 && (
                <p className="px-2 py-3 text-xs text-gray-400 leading-relaxed">
                  フォルダがありません。「+」でフォルダを作成して、フローを分類できます。
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* Main: grouped flows */}
        <div className="flex-1 min-w-0">
          {filteredFlows.length > 0 ? (
            <div className="space-y-8">
              {folderSections.map((section) => {
                // 中身が無いフォルダセクションは非表示（未分類含む）
                if (section.flows.length === 0) return null;

                const folderId = section.node?.folder.id ?? UNASSIGNED;
                const subGroups = groupBySubProject(section.flows);

                return (
                  <section key={folderId} className="space-y-3">
                    {/* Folder section header */}
                    <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
                      <Folder
                        className={`h-4 w-4 ${section.node ? 'text-blue-400' : 'text-gray-300'}`}
                      />
                      <h2 className="text-lg font-semibold text-gray-900">
                        {section.node ? section.node.folder.name : '未分類'}
                      </h2>
                      <span className="text-xs text-gray-400">{section.flows.length}</span>
                    </div>

                    {/* Sub-project sub-groups within this folder */}
                    {subGroups.map((group) => (
                      <div key={`${folderId}-${group.key}`} className="space-y-2">
                        {/* sub-project label (only show if there is a real sub-project, or multiple groups) */}
                        {(group.subProject || subGroups.length > 1) && (
                          <div className="flex items-center gap-2 pl-1">
                            <Layers className="h-3.5 w-3.5 text-gray-300" />
                            {group.subProject &&
                            editingSubProjectId === group.subProject.id ? (
                              <div className="flex items-center gap-2">
                                <Input
                                  autoFocus
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter')
                                      handleRenameSubProject(group.subProject!.id);
                                    if (e.key === 'Escape') {
                                      setEditingSubProjectId(null);
                                      setEditingName('');
                                    }
                                  }}
                                  className="h-7 w-full sm:w-56 bg-white border-gray-300 text-gray-900 text-sm"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleRenameSubProject(group.subProject!.id)}
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
                                <h3 className="text-sm font-medium text-gray-600">
                                  {group.subProject ? group.subProject.name : '（サブPJ未分類）'}
                                </h3>
                                <span className="text-[10px] text-gray-400">
                                  {group.flows.length}
                                </span>
                                {group.subProject && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingSubProjectId(group.subProject!.id);
                                      setEditingName(group.subProject!.name);
                                    }}
                                    className="text-gray-400 hover:text-gray-600"
                                    aria-label="名前を変更"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                )}
                              </>
                            )}
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
                              {/* Per-flow folder + sub-project assignment */}
                              <div className="space-y-1.5 border-t border-gray-100 px-6 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 whitespace-nowrap w-20">
                                    フォルダ
                                  </span>
                                  <select
                                    value={flow.folderId ?? UNASSIGNED}
                                    onChange={(e) => handleAssignFolder(flow.id, e.target.value)}
                                    className={`${selectClass} flex-1`}
                                  >
                                    <option value={UNASSIGNED}>未分類</option>
                                    {flatFolders.map((node) => (
                                      <option key={node.folder.id} value={node.folder.id}>
                                        {`${'　'.repeat(node.depth)}${node.folder.name}`}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 whitespace-nowrap w-20">
                                    サブPJ
                                  </span>
                                  <select
                                    value={flow.subProjectId ?? UNASSIGNED}
                                    onChange={(e) =>
                                      handleAssignSubProject(flow.id, e.target.value)
                                    }
                                    className={`${selectClass} flex-1`}
                                  >
                                    <option value={UNASSIGNED}>未分類</option>
                                    {subProjects.map((sp) => (
                                      <option key={sp.id} value={sp.id}>
                                        {sp.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
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
                  {searchQuery || selectedFolderId !== ALL_FOLDERS
                    ? '検索条件・フォルダを変更してください'
                    : '最初のフローを作成しましょう'}
                </p>
                {!searchQuery && selectedFolderId === ALL_FOLDERS && (
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
