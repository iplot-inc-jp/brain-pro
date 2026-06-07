'use client';

/**
 * フロー階層マップ — 業務フローの親子（ドリルダウン）関係を一望できるマップ。
 *
 * 各フローを1枚のカード（カスタムノード）として描き、親フロー → 子フローを
 * 曲線エッジで結ぶ。エッジには「どのノードから派生したか（originNodeLabel）」を
 * ラベル表示する。レイアウトは dagre 等の外部依存に頼らず、純粋な再帰ツリー
 * レイアウト関数で決定的に算出する（x = depth 列、y = 兄弟を縦に詰める）。
 */

import { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, GitFork, Layers, CornerDownRight, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ===========================================
// 型（バックエンド GET /tree のフラット配列）
// ===========================================

type FlowKind = 'ASIS' | 'TOBE';
type FlowConfidence = 'HYPOTHESIS' | 'CONFIRMED';

type FlowTreeItem = {
  id: string;
  name: string;
  kind: FlowKind;
  confidence: FlowConfidence;
  depth: number;
  parentId: string | null;
  folderId: string | null;
  subProjectId: string | null;
  nodeCount: number;
  originNodeId: string | null;
  originNodeLabel: string | null;
};

// React Flow ノードに載せるデータ
type FlowCardData = {
  item: FlowTreeItem;
  hovered: boolean;
  dimmed: boolean;
  onOpen: (id: string) => void;
  onHover: (id: string | null) => void;
};

// ===========================================
// レイアウト（外部依存なし・決定的な再帰ツリーレイアウト）
//
// x = depth * COL_GAP（深さで列を決める）。
// y = 各部分木に縦の帯（band）を割り当て、兄弟が重ならないよう上から詰める。
//     親は自分の子の中央に配置する（葉は順に縦に積む）。
// 複数ルートにも対応（ルートを縦に連結して配置）。
// ===========================================

const CARD_W = 230;
const CARD_H = 96;
const COL_GAP = 290; // depth ごとの水平間隔（カード幅 + 余白）
const ROW_GAP = 28; // 葉ノード間の最小垂直間隔

type LayoutResult = Map<string, { x: number; y: number }>;

/**
 * 親→子の隣接マップから座標を求める純粋関数。
 * @param rootIds   parentId が null（または親不在）のフロー ID 群
 * @param childrenOf  flowId → 子フロー ID[] の隣接マップ（描画順にソート済み想定）
 */
export function computeHierarchyLayout(
  rootIds: string[],
  childrenOf: Map<string, string[]>,
): LayoutResult {
  const pos: LayoutResult = new Map();
  // 葉を縦に積むためのカーソル（割り当て済み下端の次の位置）
  let cursorY = 0;

  const place = (id: string, depth: number): number => {
    const x = depth * COL_GAP;
    const children = childrenOf.get(id) ?? [];

    if (children.length === 0) {
      const y = cursorY;
      cursorY += CARD_H + ROW_GAP;
      pos.set(id, { x, y });
      return y;
    }

    // 子を先に配置し、その中央に親を置く（部分木を縦の帯として確保）。
    const childYs = children.map((cid) => place(cid, depth + 1));
    const y = (childYs[0] + childYs[childYs.length - 1]) / 2;
    pos.set(id, { x, y });
    return y;
  };

  for (const rootId of rootIds) {
    place(rootId, 0);
    // ルート間に1行ぶんの余白を空けて視覚的に分離
    cursorY += ROW_GAP;
  }

  return pos;
}

// ===========================================
// カスタムノード（フローカード）
// ===========================================

const KIND_STYLE: Record<
  FlowKind,
  { ring: string; chip: string; bar: string; icon: string }
> = {
  ASIS: {
    ring: 'border-amber-300',
    chip: 'bg-amber-100 text-amber-700',
    bar: 'bg-amber-400',
    icon: 'text-amber-500',
  },
  TOBE: {
    ring: 'border-emerald-300',
    chip: 'bg-emerald-100 text-emerald-700',
    bar: 'bg-emerald-500',
    icon: 'text-emerald-500',
  },
};

const FlowCard = memo(function FlowCard({ data }: NodeProps) {
  const d = data as unknown as FlowCardData;
  const { item, hovered, dimmed } = d;
  const kind = item.kind ?? 'ASIS';
  const style = KIND_STYLE[kind];

  return (
    <div
      onMouseEnter={() => d.onHover(item.id)}
      onMouseLeave={() => d.onHover(null)}
      onClick={() => d.onOpen(item.id)}
      style={{ width: CARD_W, minHeight: CARD_H }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border-2 bg-white text-left shadow-sm transition-all ${
        hovered
          ? 'border-blue-500 shadow-lg ring-2 ring-blue-200'
          : `${style.ring} hover:shadow-md`
      } ${dimmed ? 'opacity-40' : 'opacity-100'}`}
      title="クリックでこのフローを開く"
    >
      <Handle type="target" position={Position.Left} className="!bg-gray-300" />
      <Handle type="source" position={Position.Right} className="!bg-gray-300" />

      {/* 種別カラーバー */}
      <div className={`h-1.5 w-full ${style.bar}`} />

      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <GitFork className={`h-3.5 w-3.5 shrink-0 ${style.icon}`} />
            <span className="truncate text-sm font-bold leading-snug text-gray-900">
              {item.name || '（無題のフロー）'}
            </span>
          </div>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${style.chip}`}
          >
            {kind}
          </span>
        </div>

        {/* 派生元ノードのキャプション（◯◯ から） */}
        {item.originNodeLabel && (
          <div className="flex items-center gap-1 text-[11px] text-indigo-500">
            <CornerDownRight className="h-3 w-3 shrink-0" />
            <span className="truncate" title={`「${item.originNodeLabel}」から派生`}>
              {item.originNodeLabel} から
            </span>
          </div>
        )}

        <div className="mt-auto flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {item.nodeCount} ノード
          </span>
          {item.confidence === 'HYPOTHESIS' && (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
              仮説
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

const nodeTypes = { flowCard: FlowCard };

// ===========================================
// ページ本体
// ===========================================

function FlowHierarchyMap() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [items, setItems] = useState<FlowTreeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchTree = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/business-flows/project/${projectId}/tree`,
        { headers: getHeaders() },
      );
      if (!res.ok) throw new Error('フロー階層の取得に失敗しました');
      const data: FlowTreeItem[] = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '不明なエラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    if (projectId) fetchTree();
  }, [projectId, fetchTree]);

  const openFlow = useCallback(
    (id: string) => {
      router.push(`/dashboard/projects/${projectId}/flows/${id}`);
    },
    [router, projectId],
  );

  // ハイライト対象: ホバー中のカード + その親 + 直接の子（関係する系統を強調）
  const relatedIds = useMemo(() => {
    if (!hoveredId) return null;
    const byId = new Map(items.map((it) => [it.id, it]));
    const set = new Set<string>([hoveredId]);
    const cur = byId.get(hoveredId);
    if (cur?.parentId && byId.has(cur.parentId)) set.add(cur.parentId);
    for (const it of items) if (it.parentId === hoveredId) set.add(it.id);
    return set;
  }, [hoveredId, items]);

  // React Flow ノード / エッジ生成
  const { rfNodes, rfEdges } = useMemo<{ rfNodes: Node[]; rfEdges: Edge[] }>(() => {
    if (items.length === 0) return { rfNodes: [], rfEdges: [] };

    const validIds = new Set(items.map((it) => it.id));

    // 親→子の隣接マップ（depth → name で安定ソート）。
    // parentId が不在/無効なフローはルートとして扱う。
    const childrenOf = new Map<string, string[]>();
    const rootIds: string[] = [];
    const sorted = [...items].sort((a, b) =>
      a.depth !== b.depth ? a.depth - b.depth : a.name.localeCompare(b.name, 'ja'),
    );
    for (const it of sorted) {
      const parent = it.parentId && validIds.has(it.parentId) ? it.parentId : null;
      if (parent === null) {
        rootIds.push(it.id);
      } else {
        const list = childrenOf.get(parent) ?? [];
        list.push(it.id);
        childrenOf.set(parent, list);
      }
    }

    const layout = computeHierarchyLayout(rootIds, childrenOf);

    const nodes: Node[] = items.map((it) => {
      const hovered = hoveredId === it.id;
      const dimmed = relatedIds !== null && !relatedIds.has(it.id);
      return {
        id: it.id,
        type: 'flowCard',
        position: layout.get(it.id) ?? { x: it.depth * COL_GAP, y: 0 },
        data: {
          item: it,
          hovered,
          dimmed,
          onOpen: openFlow,
          onHover: setHoveredId,
        } as unknown as Record<string, unknown>,
        draggable: false,
        width: CARD_W,
        height: CARD_H,
      };
    });

    const edges: Edge[] = items
      .filter((it) => it.parentId && validIds.has(it.parentId))
      .map((it) => {
        const active =
          relatedIds === null ||
          (relatedIds.has(it.id) && relatedIds.has(it.parentId as string));
        return {
          id: `e-${it.parentId}-${it.id}`,
          source: it.parentId as string,
          target: it.id,
          type: 'default', // ベジェ曲線
          animated: active,
          label: it.originNodeLabel ? `${it.originNodeLabel} から派生` : 'このノードから派生',
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9, stroke: '#e2e8f0' },
          labelStyle: { fill: '#6366f1', fontSize: 10, fontWeight: 600 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: active ? '#2563eb' : '#cbd5e1',
            width: 16,
            height: 16,
          },
          style: {
            stroke: active ? '#2563eb' : '#cbd5e1',
            strokeWidth: active ? 2 : 1.5,
            opacity: active ? 1 : 0.5,
          },
        } as Edge;
      });

    return { rfNodes: nodes, rfEdges: edges };
  }, [items, hoveredId, relatedIds, openFlow]);

  // 「マップらしい中身」がない（フローが無い or ルートのみで親子なし）かの判定
  const hasHierarchy = useMemo(
    () => items.some((it) => it.parentId && items.some((p) => p.id === it.parentId)),
    [items],
  );

  const howTo = (
    <HowToPanel
      title="フロー階層マップの使い方"
      steps={[
        'カードはひとつの業務フローです。左から右へ depth（階層）が深くなり、親フロー → 子（詳細）フローを矢印で結びます。',
        'フローのスイムレーン図でノードをダブルクリックすると、そのノードの詳細フロー（子）が作られ、ここに親子としてぶら下がります。',
        'カードにマウスを乗せると、その親子系統がハイライトされます。矢印ラベルは「どのノードから派生したか」を表します。',
        'カードをクリックすると、そのフローのスイムレーン図（編集画面）を開きます。',
        '右下のミニマップ・左下のコントロールで全体把握・ズーム・フィットができます。',
      ]}
      shortcuts={[{ keys: 'Shift+/（?）', desc: 'この操作方法を開く' }]}
    />
  );

  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-120px)] min-h-[520px] flex-col gap-3">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <GitFork className="h-5 w-5 text-blue-600" />
            フロー階層マップ
          </span>
        }
        description="業務フローの親子（ドリルダウン）関係を一望できます"
        help="フローのノードをダブルクリックして作る「詳細フロー（子フロー）」が、親フローからぶら下がる親子ツリーとして可視化されます。ASIS（現状）／TOBE（あるべき姿）の系統を俯瞰し、目的のフローへすぐ移動できます。"
        backHref={`/dashboard/projects/${projectId}/flows`}
        backLabel="業務フロー一覧に戻る"
        actions={howTo}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <Card className="flex-1 overflow-hidden border-gray-200 bg-white">
        <CardContent className="h-full p-0">
          {items.length > 0 ? (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              onPaneClick={() => setHoveredId(null)}
              className="bg-gray-50"
            >
              <Background color="#e2e8f0" gap={22} />
              <Controls
                showInteractive={false}
                className="rounded-lg border border-gray-200 bg-white shadow-sm"
              />
              <MiniMap
                className="rounded-lg border border-gray-200 bg-white shadow-sm"
                nodeColor={(n) => {
                  const d = n.data as unknown as FlowCardData | undefined;
                  return (d?.item?.kind ?? 'ASIS') === 'TOBE' ? '#34d399' : '#fbbf24';
                }}
                maskColor="rgba(0,0,0,0.04)"
              />
            </ReactFlow>
          ) : (
            // フローが1つも無い場合の空状態
            <EmptyState projectId={projectId} router={router} />
          )}
        </CardContent>
      </Card>

      {/* フローはあるが親子（ドリルダウン）関係がまだ無い場合の説明バナー */}
      {items.length > 0 && !hasHierarchy && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-sm text-gray-600">
          <Layers className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <p className="leading-relaxed">
            まだ親子（ドリルダウン）関係がありません。フローのスイムレーン図で
            <span className="font-medium text-gray-800">
              ノードをダブルクリック
            </span>
            すると、そのノードの<span className="font-medium text-gray-800">詳細フロー（子フロー）</span>
            が作成され、ここに親子としてつながって表示されます。
          </p>
        </div>
      )}
    </div>
  );
}

// ===========================================
// 空状態（フローが1つも無い）
// ===========================================

function EmptyState({
  projectId,
  router,
}: {
  projectId: string;
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
        <GitFork className="h-8 w-8 text-blue-400" />
      </div>
      <p className="text-base font-semibold text-gray-700">まだフローがありません</p>
      <p className="max-w-md text-sm leading-relaxed text-gray-500">
        まずは業務フローを作成しましょう。フローのスイムレーン図で
        <span className="font-medium text-gray-700">ノードをダブルクリック</span>
        すると、そのノードを掘り下げる<span className="font-medium text-gray-700">詳細フロー（子フロー）</span>
        が作られ、ここに親子のドリルダウン関係として表示されます。
      </p>
      <Button
        className="mt-1 bg-blue-600 hover:bg-blue-700"
        onClick={() => router.push(`/dashboard/projects/${projectId}/flows`)}
      >
        業務フロー一覧へ
      </Button>
    </div>
  );
}

export default function FlowHierarchyPage() {
  return (
    <ReactFlowProvider>
      <FlowHierarchyMap />
    </ReactFlowProvider>
  );
}
