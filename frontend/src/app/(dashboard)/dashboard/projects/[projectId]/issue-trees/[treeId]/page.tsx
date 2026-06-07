'use client';

import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ChevronLeft,
  Loader2,
  Pencil,
  AlertCircle,
  Plus,
  Trash2,
  X,
  FileText,
  HelpCircle,
  Lightbulb,
  Target,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import {
  parseIssueMarkdown,
  flattenIssueTree,
  type Verification,
  type Recommendation,
} from '@/lib/issue-markdown';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { IdeationAssistDialog } from '@/components/issue-trees/ideation-assist-dialog';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ===========================================
// 型
// ===========================================

type IssueNodeKind = 'ISSUE' | 'CAUSE' | 'COUNTERMEASURE';

type BackendNode = {
  id: string;
  treeId: string;
  parentId: string | null;
  depth: number;
  order: number;
  label: string;
  kind: IssueNodeKind;
  verification: Verification;
  recommendation: Recommendation;
  evidence: string | null;
  rootCauseNodeId: string | null;
  metadata: Record<string, unknown> | null;
};

type IssueTree = {
  id: string;
  projectId: string;
  type: 'WHY' | 'SOLUTION';
  name: string;
  rootQuestion: string | null;
  nodes: BackendNode[];
};

// React Flow ノードに載せるデータ
type MindNodeData = {
  node: BackendNode | null; // null = ルートの問い（仮想ノード）
  isRoot: boolean;
  rootQuestion: string;
  treeType: 'WHY' | 'SOLUTION';
  selected: boolean;
  onSelect: (id: string | null) => void;
  onAddCause: (parentId: string | null) => void;
  onAddCountermeasure: (parentId: string | null) => void;
  onIdeate: (id: string | null) => void;
  onDelete: (id: string) => void;
};

const ROOT_ID = '__root__';

// ===========================================
// kind / verification / recommendation の表示メタ
// ===========================================

const KIND_LABEL: Record<IssueNodeKind, string> = {
  ISSUE: '問い',
  CAUSE: '原因',
  COUNTERMEASURE: '打ち手',
};

// 種別ごとのカード配色（白基調 iplot テーマ）
const KIND_STYLE: Record<IssueNodeKind, { border: string; bar: string; chip: string }> = {
  ISSUE: { border: 'border-slate-300', bar: 'bg-slate-700', chip: 'bg-slate-100 text-slate-700' },
  CAUSE: { border: 'border-blue-300', bar: 'bg-blue-600', chip: 'bg-blue-50 text-blue-700' },
  COUNTERMEASURE: {
    border: 'border-emerald-300',
    bar: 'bg-emerald-600',
    chip: 'bg-emerald-50 text-emerald-700',
  },
};

const VERIFY_META: Record<Verification, { label: string; cls: string }> = {
  CONFIRMED: { label: '○ 確定', cls: 'border-green-300 bg-green-50 text-green-700' },
  REJECTED: { label: '× 否定', cls: 'border-red-300 bg-red-50 text-red-700' },
  UNKNOWN: { label: '△ 未確認', cls: 'border-gray-300 bg-gray-100 text-gray-600' },
  NEEDS_HEARING: { label: '? 要ヒアリング', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  NA: { label: '—', cls: 'border-gray-200 bg-gray-50 text-gray-400' },
};

const RECO_META: Record<Recommendation, { label: string; cls: string }> = {
  ADOPT: { label: '採用', cls: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  HOLD: { label: '保留', cls: 'border-amber-300 bg-amber-50 text-amber-700' },
  REJECT: { label: '不採用', cls: 'border-red-300 bg-red-50 text-red-700' },
  NA: { label: '—', cls: 'border-gray-200 bg-gray-50 text-gray-400' },
};

const VERIFY_OPTIONS: Verification[] = [
  'CONFIRMED',
  'REJECTED',
  'UNKNOWN',
  'NEEDS_HEARING',
  'NA',
];
const RECO_OPTIONS: Recommendation[] = ['ADOPT', 'HOLD', 'REJECT', 'NA'];
const KIND_OPTIONS: IssueNodeKind[] = ['ISSUE', 'CAUSE', 'COUNTERMEASURE'];

const KIND_ICON: Record<IssueNodeKind, typeof HelpCircle> = {
  ISSUE: HelpCircle,
  CAUSE: Lightbulb,
  COUNTERMEASURE: Target,
};

// ===========================================
// レイアウト計算（外部依存なし・決定的 左→右 ツリー）
// ===========================================

const NODE_W = 220;
const NODE_H = 84;
const X_GAP = 260; // depth ごとの水平間隔
const Y_GAP = 24; // 兄弟ノードの最小垂直間隔

type LayoutNode = {
  id: string;
  parentId: string | null;
  children: string[];
};

/**
 * 親→子の隣接から再帰的に座標を求める。
 * x = depth * X_GAP、y は部分木の高さに応じて子を縦に広げ、親はその中央に置く。
 */
function computeLayout(
  rootId: string,
  childrenMap: Map<string, string[]>,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  let cursorY = 0;

  const place = (id: string, depth: number): number => {
    const children = childrenMap.get(id) ?? [];
    const x = depth * X_GAP;

    if (children.length === 0) {
      const y = cursorY;
      cursorY += NODE_H + Y_GAP;
      pos.set(id, { x, y });
      return y;
    }

    const childYs = children.map((cid) => place(cid, depth + 1));
    const y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    pos.set(id, { x, y });
    return y;
  };

  place(rootId, 0);
  return pos;
}

// ===========================================
// カスタムノード
// ===========================================

const MindNode = memo(function MindNode({ data }: NodeProps) {
  const d = data as unknown as MindNodeData;
  const { node, isRoot, treeType, selected } = d;

  if (isRoot) {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          d.onSelect(null);
        }}
        className={`relative w-[220px] cursor-pointer rounded-lg border-2 bg-white px-3 py-2.5 shadow-sm transition ${
          selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-indigo-300'
        }`}
      >
        <Handle type="source" position={Position.Right} className="!bg-indigo-400" />
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-indigo-600">
          <HelpCircle className="h-3 w-3" />
          ルートの問い
        </div>
        <div className="text-sm font-bold leading-snug text-gray-900 break-words">
          {d.rootQuestion || '（問い未設定）'}
        </div>
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (treeType === 'WHY') d.onAddCause(null);
              else d.onAddCountermeasure(null);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-100"
          >
            <Plus className="h-3 w-3" />
            {treeType === 'WHY' ? '原因(なぜ)' : '打ち手'}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onIdeate(null);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100"
            title="発想法で子ノードに分解"
          >
            <Sparkles className="h-3 w-3" />
            発想法で分解
          </button>
        </div>
      </div>
    );
  }

  if (!node) return null;

  const kind = node.kind ?? 'ISSUE';
  const style = KIND_STYLE[kind];
  const Icon = KIND_ICON[kind];
  const showVerify = kind === 'CAUSE';
  const showReco = kind === 'COUNTERMEASURE';

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        d.onSelect(node.id);
      }}
      className={`relative w-[220px] cursor-pointer rounded-lg border-2 bg-white shadow-sm transition ${
        selected ? 'border-indigo-500 ring-2 ring-indigo-200' : style.border
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-300" />
      <Handle type="source" position={Position.Right} className="!bg-gray-300" />
      <div className={`h-1.5 w-full rounded-t-md ${style.bar}`} />
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}
          >
            <Icon className="h-3 w-3" />
            {KIND_LABEL[kind]}
          </span>
          {showVerify && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${VERIFY_META[node.verification ?? 'NA'].cls}`}
            >
              {VERIFY_META[node.verification ?? 'NA'].label}
            </span>
          )}
          {showReco && (
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${RECO_META[node.recommendation ?? 'NA'].cls}`}
            >
              {RECO_META[node.recommendation ?? 'NA'].label}
            </span>
          )}
        </div>
        <div className="text-sm font-medium leading-snug text-gray-900 break-words">
          {node.label || <span className="text-gray-300">（空）</span>}
        </div>
        {node.evidence && (
          <p className="mt-1 line-clamp-2 text-[11px] text-gray-400">根拠: {node.evidence}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onAddCause(node.id);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100"
          >
            <Plus className="h-3 w-3" />
            原因
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onAddCountermeasure(node.id);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 hover:bg-emerald-100"
          >
            <Plus className="h-3 w-3" />
            打ち手
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onIdeate(node.id);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 hover:bg-blue-100"
            title="発想法で子ノードに分解"
          >
            <Sparkles className="h-3 w-3" />
            発想法
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              d.onDelete(node.id);
            }}
            className="inline-flex items-center gap-0.5 rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
});

const nodeTypes = { mind: MindNode };

// ===========================================
// ページ
// ===========================================

function IssueTreeMindMap() {
  const params = useParams();
  const projectId = params.projectId as string;
  const treeId = params.treeId as string;

  const [tree, setTree] = useState<IssueTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [editingName, setEditingName] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 取り込みダイアログ
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // 発想法アシスト（分解）ダイアログ
  const [ideateOpen, setIdeateOpen] = useState(false);
  const [ideateParentId, setIdeateParentId] = useState<string | null>(null);

  const howToRef = useRef<HTMLDivElement>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchTree = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/issue-trees/${treeId}`, { headers: getHeaders() });
      if (!res.ok) throw new Error('イシューツリーの取得に失敗しました');
      const data: IssueTree = await res.json();
      setTree(data);
      setName(data.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [treeId, getHeaders]);

  useEffect(() => {
    if (treeId) fetchTree();
  }, [treeId, fetchTree]);

  // ===========================================
  // ミューテーション（安定ID・ノード単位 API）
  // ===========================================

  const addNode = useCallback(
    async (parentId: string | null, kind: IssueNodeKind, label: string) => {
      if (!tree) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ parentId, label, kind }),
        });
        if (!res.ok) throw new Error('ノードの作成に失敗しました');
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの作成に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [tree, treeId, getHeaders, fetchTree],
  );

  const addCause = useCallback(
    (parentId: string | null) => addNode(parentId, 'CAUSE', '新しい原因'),
    [addNode],
  );
  const addCountermeasure = useCallback(
    (parentId: string | null) => addNode(parentId, 'COUNTERMEASURE', '新しい打ち手'),
    [addNode],
  );
  const addIssue = useCallback(
    (parentId: string | null) => addNode(parentId, 'ISSUE', '新しい論点'),
    [addNode],
  );

  // 発想法アシスト: チェック済み候補を子ノードとして一括追加（既存の add-node API を再利用）
  const addNodesBulk = useCallback(
    async (
      parentId: string | null,
      kind: IssueNodeKind,
      labels: string[],
    ): Promise<boolean> => {
      if (!tree || labels.length === 0) return false;
      setBusy(true);
      setActionError(null);
      try {
        const headers = getHeaders();
        for (const label of labels) {
          const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ parentId, label, kind }),
          });
          if (!res.ok) throw new Error('ノードの作成に失敗しました');
        }
        await fetchTree();
        return true;
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの作成に失敗しました');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [tree, treeId, getHeaders, fetchTree],
  );

  const openIdeate = useCallback((parentId: string | null) => {
    setIdeateParentId(parentId);
    setIdeateOpen(true);
  }, []);

  const patchNode = useCallback(
    async (nodeId: string, body: Record<string, unknown>) => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('ノードの更新に失敗しました');
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの更新に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree],
  );

  const setVerification = useCallback(
    async (nodeId: string, verification: Verification) => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(
          `${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}/verification`,
          {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({ verification }),
          },
        );
        if (!res.ok) throw new Error('検証状態の更新に失敗しました');
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '検証状態の更新に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree],
  );

  const deleteNode = useCallback(
    async (nodeId: string) => {
      if (!window.confirm('このノードと配下の子ノードを削除します。よろしいですか？')) return;
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes/${nodeId}`, {
          method: 'DELETE',
          headers: getHeaders(),
        });
        if (!res.ok && res.status !== 404) throw new Error('ノードの削除に失敗しました');
        setSelectedId((cur) => (cur === nodeId ? null : cur));
        await fetchTree();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'ノードの削除に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [treeId, getHeaders, fetchTree],
  );

  const saveName = useCallback(async () => {
    if (!tree) return;
    setEditingName(false);
    const next = name.trim();
    if (!next || next === tree.name) {
      setName(tree.name);
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/api/issue-trees/${treeId}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) throw new Error('ツリー名の更新に失敗しました');
      await fetchTree();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ツリー名の更新に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [tree, name, treeId, getHeaders, fetchTree]);

  // ===========================================
  // markdown 取り込み（作成時のみ・親→子順に POST）
  // ===========================================

  const verifyToKind = (v: Verification, r: Recommendation): IssueNodeKind => {
    if (r !== 'NA') return 'COUNTERMEASURE';
    return 'CAUSE';
  };

  const handleImport = useCallback(async () => {
    if (!tree) return;
    setImporting(true);
    setImportError(null);
    try {
      const headers = getHeaders();
      const parsed = parseIssueMarkdown(importText);
      const flat = flattenIssueTree(parsed.nodes);
      const createdIds: string[] = [];

      for (let i = 0; i < flat.length; i++) {
        const { node, order, parentIndex } = flat[i];
        const parentId = parentIndex !== null ? createdIds[parentIndex] : null;
        const kind =
          tree.type === 'SOLUTION'
            ? verifyToKind(node.verification, node.recommendation)
            : node.recommendation !== 'NA'
              ? 'COUNTERMEASURE'
              : parentId === null
                ? 'ISSUE'
                : 'CAUSE';

        const body = {
          label: node.label || '（無題）',
          parentId,
          order,
          kind,
          verification: node.verification,
          recommendation: node.recommendation,
          evidence: node.evidence ?? null,
          metadata: { links: node.links },
        };

        const res = await fetch(`${API_URL}/api/issue-trees/${treeId}/nodes`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error('ノードの作成に失敗しました');
        const created: BackendNode = await res.json();
        createdIds[i] = created.id;
      }

      // ルートの問いも反映（あれば）
      if (parsed.title && parsed.title !== (tree.rootQuestion ?? '')) {
        await fetch(`${API_URL}/api/issue-trees/${treeId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ rootQuestion: parsed.title }),
        });
      }

      setImportOpen(false);
      setImportText('');
      await fetchTree();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  }, [tree, treeId, importText, getHeaders, fetchTree]);

  // ===========================================
  // React Flow ノード / エッジ生成
  // ===========================================

  const { rfNodes, rfEdges } = useMemo<{ rfNodes: Node[]; rfEdges: Edge[] }>(() => {
    if (!tree) return { rfNodes: [], rfEdges: [] };

    const backendNodes = tree.nodes ?? [];
    const rootQuestion = tree.rootQuestion ?? '';

    // 親→子の隣接マップ（order でソート）。ルート直下のノードは仮想ルートにぶら下げる。
    const childrenMap = new Map<string, string[]>();
    childrenMap.set(ROOT_ID, []);
    const sorted = [...backendNodes].sort((a, b) =>
      a.depth !== b.depth ? a.depth - b.depth : a.order - b.order,
    );
    for (const n of sorted) {
      const parentKey = n.parentId ?? ROOT_ID;
      if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
      childrenMap.get(parentKey)!.push(n.id);
      if (!childrenMap.has(n.id)) childrenMap.set(n.id, []);
    }

    const layout = computeLayout(ROOT_ID, childrenMap);

    const baseData = {
      treeType: tree.type,
      rootQuestion,
      onSelect: setSelectedId,
      onAddCause: addCause,
      onAddCountermeasure: addCountermeasure,
      onIdeate: openIdeate,
      onDelete: deleteNode,
    };

    const nodes: Node[] = [];
    nodes.push({
      id: ROOT_ID,
      type: 'mind',
      position: layout.get(ROOT_ID) ?? { x: 0, y: 0 },
      data: {
        ...baseData,
        node: null,
        isRoot: true,
        selected: selectedId === null && false, // ルートは明示選択しないと反転させない
      } as unknown as Record<string, unknown>,
      draggable: false,
    });

    for (const n of backendNodes) {
      nodes.push({
        id: n.id,
        type: 'mind',
        position: layout.get(n.id) ?? { x: n.depth * X_GAP, y: 0 },
        data: {
          ...baseData,
          node: n,
          isRoot: false,
          selected: selectedId === n.id,
        } as unknown as Record<string, unknown>,
        draggable: false,
      });
    }

    const edges: Edge[] = backendNodes.map((n) => ({
      id: `e-${n.parentId ?? ROOT_ID}-${n.id}`,
      source: n.parentId ?? ROOT_ID,
      target: n.id,
      type: 'smoothstep',
      style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
    }));

    return { rfNodes: nodes, rfEdges: edges };
  }, [tree, selectedId, addCause, addCountermeasure, openIdeate, deleteNode]);

  const selectedNode = useMemo(
    () => (selectedId ? (tree?.nodes ?? []).find((n) => n.id === selectedId) ?? null : null),
    [selectedId, tree],
  );

  // キーボードショートカット
  // Shift+/（?） … 操作方法 / N … 論点を追加 / Delete・Backspace … 選択ノードを削除 /
  // ⌘/Ctrl+S … ブラウザ保存を抑止（編集は自動保存される）
  useKeyboardShortcuts([
    {
      combo: 'shift+/',
      handler: () => howToRef.current?.querySelector('button')?.click(),
    },
    {
      combo: 'n',
      handler: () => {
        if (!busy) addIssue(null);
      },
    },
    {
      combo: 'delete',
      handler: () => {
        if (selectedId && !busy) deleteNode(selectedId);
      },
    },
    {
      combo: 'backspace',
      handler: () => {
        if (selectedId && !busy) deleteNode(selectedId);
      },
    },
    {
      combo: 'mod+s',
      whenTyping: true,
      handler: () => {
        /* 自動保存のため何もしない（ブラウザ保存ダイアログのみ抑止） */
      },
    },
  ]);

  // ===========================================
  // 描画
  // ===========================================

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !tree) {
    return (
      <div className="space-y-4">
        <Link href={`/dashboard/projects/${projectId}/issue-trees`}>
          <Button variant="ghost" className="text-gray-600">
            <ChevronLeft className="mr-1 h-4 w-4" />
            イシューツリー一覧に戻る
          </Button>
        </Link>
        <Card className="border-red-200 bg-white">
          <CardContent className="py-8 text-center">
            <p className="text-red-600">{error || 'イシューツリーが見つかりません'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const typeBadge =
    tree.type === 'WHY'
      ? { label: 'WHY（なぜ型）', color: 'text-blue-700 bg-blue-50 border-blue-200' }
      : { label: 'SOLUTION（打ち手型）', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[520px] flex-col gap-3">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/dashboard/projects/${projectId}/issue-trees`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="mr-1 h-4 w-4" />
              一覧
            </Button>
          </Link>
          <div className="min-w-0">
            {editingName ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                }}
                autoFocus
                className="h-9 w-72 border-gray-300 bg-white text-lg font-bold"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group flex items-center gap-2 text-left"
                title="クリックして編集"
              >
                <h1 className="truncate text-2xl font-bold text-gray-900">{name || '（無題）'}</h1>
                <Pencil className="h-4 w-4 text-gray-300 group-hover:text-gray-500" />
              </button>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-xs font-medium ${typeBadge.color}`}>
                {typeBadge.label}
              </span>
              <span className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-500">
                GAP起点: なぜ → 打ち手
              </span>
              <HelpTooltip text="WHY（なぜ型）は原因を深掘りするツリー、SOLUTION（打ち手型）は対策をMECEに洗い出すツリーです。GAP（課題）を起点に、なぜ→打ち手の順で検討します。" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <div ref={howToRef}>
            <HowToPanel
              title="課題ツリー（マインドマップ）の使い方"
              steps={[
                'ノード上の「＋原因」でその下に原因を、「＋打ち手」で打ち手を追加します。ルートの問いからも追加できます。',
                'ノードをクリックすると右パネルが開き、種別・ラベル・根拠を編集できます。',
                'ノードの「発想法で分解」から IPLoT 発想法（SDF/RTOCS/横展開ほか）のレンズを選び、子ノード候補を一括で生成できます。',
                '原因ノードは検証マーク（○確定／×否定／△未確認／?要ヒアリング）で確からしさを記録します。',
                '打ち手ノードは推奨（採用／保留／不採用）を設定して取捨選択します。',
                '「テキストから取り込み」でインデント箇条書きを一括投入できます（作成時向け）。',
              ]}
              shortcuts={[
                { keys: 'N', desc: 'ルート直下に論点を追加' },
                { keys: 'Delete / Backspace', desc: '選択中のノードを削除' },
                { keys: '⌘/Ctrl+S', desc: '保存は自動（ブラウザ保存を抑止）' },
                { keys: 'Shift+/（?）', desc: 'この操作方法を開く' },
              ]}
            />
          </div>
          <Button variant="outline" size="sm" onClick={fetchTree} className="text-gray-600">
            <RefreshCw className="mr-1 h-4 w-4" />
            再読込
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setImportError(null);
              setImportOpen(true);
            }}
            className="text-gray-600"
          >
            <FileText className="mr-1 h-4 w-4" />
            テキストから取り込み
          </Button>
          <Button size="sm" onClick={() => addIssue(null)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="mr-1 h-4 w-4" />
            論点
          </Button>
        </div>
      </div>

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* キャンバス + サイドパネル */}
      <div className="relative flex flex-1 gap-3 overflow-hidden">
        <Card className="flex-1 overflow-hidden border-gray-200 bg-white">
          <CardContent className="h-full p-0">
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onPaneClick={() => setSelectedId(null)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
            >
              <Background color="#e2e8f0" gap={20} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </CardContent>
        </Card>

        {/* 右: 選択ノードの編集パネル */}
        {selectedNode && (
          <NodeEditPanel
            key={selectedNode.id}
            node={selectedNode}
            treeType={tree.type}
            busy={busy}
            onClose={() => setSelectedId(null)}
            onPatch={patchNode}
            onSetVerification={setVerification}
            onIdeate={openIdeate}
            onDelete={deleteNode}
          />
        )}
      </div>

      {/* 取り込みダイアログ */}
      <Dialog open={importOpen} onOpenChange={(o) => !importing && setImportOpen(o)}>
        <DialogContent className="bg-white sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>テキストから取り込み</DialogTitle>
            <DialogDescription>
              インデント箇条書き（2スペース＝1階層 / 行頭マーク ○×△? / [採用]等）をノードとして作成します。
              これは作成時の一括投入用です。以降の編集は GUI で行ってください。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            spellCheck={false}
            placeholder={`# なぜ解約率が高いのか？\n- [△] オンボーディングが分かりにくい\n  - [○] 初回設定が複雑\n  - [?] サポート導線が不明\n- [採用] チュートリアル改善`}
            className="h-64 resize-none font-mono text-sm"
          />
          {importError && (
            <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {importError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              キャンセル
            </Button>
            <Button
              onClick={handleImport}
              disabled={importing || !importText.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  取り込み中...
                </>
              ) : (
                '取り込む'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 発想法アシスト（分解）ダイアログ */}
      <IdeationAssistDialog
        open={ideateOpen}
        onOpenChange={setIdeateOpen}
        parentId={ideateParentId}
        parentLabel={
          ideateParentId === null
            ? tree.rootQuestion ?? ''
            : (tree.nodes ?? []).find((n) => n.id === ideateParentId)?.label ?? ''
        }
        treeType={tree.type}
        onAdd={addNodesBulk}
      />
    </div>
  );
}

// ===========================================
// 編集パネル（選択ノード）
// ===========================================

function NodeEditPanel({
  node,
  treeType,
  busy,
  onClose,
  onPatch,
  onSetVerification,
  onIdeate,
  onDelete,
}: {
  node: BackendNode;
  treeType: 'WHY' | 'SOLUTION';
  busy: boolean;
  onClose: () => void;
  onPatch: (nodeId: string, body: Record<string, unknown>) => void;
  onSetVerification: (nodeId: string, verification: Verification) => void;
  onIdeate: (nodeId: string | null) => void;
  onDelete: (nodeId: string) => void;
}) {
  const [label, setLabel] = useState(node.label);
  const [evidence, setEvidence] = useState(node.evidence ?? '');
  const kind = node.kind ?? 'ISSUE';

  return (
    <Card className="absolute inset-y-0 right-0 z-30 w-full overflow-y-auto border-gray-200 bg-white shadow-xl sm:static sm:z-auto sm:w-80 sm:shrink-0 sm:shadow-none">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900">ノードを編集</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 種別 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">種別</label>
          <div className="flex gap-1">
            {KIND_OPTIONS.map((k) => {
              const active = k === kind;
              const Icon = KIND_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (k !== kind) onPatch(node.id, { kind: k });
                  }}
                  className={`flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-medium transition ${
                    active
                      ? `${KIND_STYLE[k].chip} border-transparent ring-1 ring-inset ring-gray-300`
                      : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {KIND_LABEL[k]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ラベル */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">ラベル</label>
          <Textarea
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              const v = label.trim();
              if (v && v !== node.label) onPatch(node.id, { label: v });
              else setLabel(node.label);
            }}
            rows={2}
            className="resize-none text-sm"
          />
        </div>

        {/* 検証状態（CAUSE） */}
        {kind === 'CAUSE' && (
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label className="block text-xs font-medium text-gray-500">検証状態</label>
              <HelpTooltip text="その原因がどれだけ確からしいかの記録です。○確定＝裏付けあり／×否定＝原因でない／△未確認／?要ヒアリング。確定した原因を打ち手につなげます。" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              {VERIFY_OPTIONS.map((v) => {
                const active = v === (node.verification ?? 'NA');
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (v !== node.verification) onSetVerification(node.id, v);
                    }}
                    className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
                      active ? VERIFY_META[v].cls : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {VERIFY_META[v].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 推奨（COUNTERMEASURE） */}
        {kind === 'COUNTERMEASURE' && (
          <div>
            <div className="mb-1 flex items-center gap-1.5">
              <label className="block text-xs font-medium text-gray-500">推奨</label>
              <HelpTooltip text="打ち手を採用するかの判断です。採用＝実行する／保留＝判断待ち／不採用＝見送り。効果とコストを踏まえて取捨選択します。" />
            </div>
            <div className="grid grid-cols-2 gap-1">
              {RECO_OPTIONS.map((r) => {
                const active = r === (node.recommendation ?? 'NA');
                return (
                  <button
                    key={r}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (r !== node.recommendation) onPatch(node.id, { recommendation: r });
                    }}
                    className={`rounded border px-2 py-1 text-[11px] font-medium transition ${
                      active ? RECO_META[r].cls : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {RECO_META[r].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 根拠 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-500">根拠 / メモ</label>
          <Textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            onBlur={() => {
              const v = evidence.trim();
              if (v !== (node.evidence ?? '')) onPatch(node.id, { evidence: v || null });
            }}
            rows={3}
            placeholder="検証根拠・出典など"
            className="resize-none text-sm"
          />
        </div>

        <Button
          size="sm"
          disabled={busy}
          onClick={() => onIdeate(node.id)}
          className="w-full bg-blue-600 text-white hover:bg-blue-700"
        >
          <Sparkles className="mr-1 h-4 w-4" />
          発想法で分解
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onDelete(node.id)}
          className="w-full border-red-200 text-red-600 hover:bg-red-50"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          このノードを削除
        </Button>
      </CardContent>
    </Card>
  );
}

export default function IssueTreeDetailPage() {
  return (
    <ReactFlowProvider>
      <IssueTreeMindMap />
    </ReactFlowProvider>
  );
}
