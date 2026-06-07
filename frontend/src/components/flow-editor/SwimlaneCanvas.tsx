'use client';

/**
 * SwimlaneCanvas — 構造ベース自動レイアウトのスイムレーン描画。
 *
 * 旧 BPMNFlowViewer の根本バグ（背景・ヘッダー・ノードが3つの別座標系で
 * 描かれズレる / 手動ピクセル配置で重なる）を構造的に解消する。
 *
 *   - 座標は全て computeFlowLayout（純粋・テスト済）から取得する単一座標源。
 *   - スイムレーン帯とラベルは React Flow の「背景ノード」として描くため、
 *     ノードと同じ変換空間に乗り、pan/zoom で必ず一致する。
 *   - 時間軸は各ノードの `order` 昇順で決まる（order ベースのタイムライン）。
 *     ノードを時間軸方向にドラッグすると order を再計算して onUpdateNode に返す。
 *   - 縦/横の向きはキャンバス内部状態でトグルし、flow ごとに localStorage に永続化。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  MarkerType,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  ConnectionMode,
  type Node,
  type Edge,
  type EdgeProps,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import {
  ChevronLeft,
  Layers,
  Plus,
  Trash2,
  GitBranch,
  Cpu,
  Users,
  X,
  Download,
  RotateCw,
  Link2,
  ArrowRight,
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { computeFlowLayout, type LayoutInputNode, type LayoutInputEdge } from './flow-layout';
import type {
  FlowData,
  FlowDataNode,
  FlowLinkDirection,
  FlowNodeLink,
  FlowSummary,
  Role,
} from './flow-types';

const LANE_LABEL_W = 132;

export type FlowOrientation = 'horizontal' | 'vertical';

/** ノード更新の差分パッチ。プロパティ保存・ドラッグ並べ替えの双方で使う。 */
export interface NodeUpdatePatch {
  label?: string;
  type?: string;
  roleId?: string;
  order?: number;
  metadata?: Record<string, unknown>;
}

/** ノードの入出力リンク取得結果（双方向）。 */
export interface NodeLinksResult {
  nodeId: string;
  outgoing: FlowNodeLink[];
  incoming: FlowNodeLink[];
}

export interface SwimlaneCanvasProps {
  flowData: FlowData;
  roles: Role[];
  /** 現在のプロジェクトID（連携先フロー絞り込み・子フロー遷移URL組み立てに使用）。 */
  projectId?: string;
  /** 連携先フロー選択用の、同プロジェクトの他フロー一覧。 */
  otherFlows?: FlowSummary[];
  onBack?: () => void;
  onUpdateFlow?: (id: string, name: string, description?: string) => void;
  onCreateNode?: (input: { type: string; roleId?: string; afterNodeId?: string }) => void;
  onConnectNodes?: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  onUpdateEdgeLabel?: (edgeId: string, label: string) => void;
  onChangeNodeRole?: (nodeId: string, roleId: string) => void;
  onCreateChildFlow?: (nodeId: string) => void;
  onOpenChildFlow?: (nodeId: string, childFlowId: string) => void;
  /**
   * ノードのダブルクリックで詳細（子）フローを開く。
   * 子フローが無ければ作成してから遷移する処理は、呼び出し側（ページ）に委譲する。
   */
  onNodeDoubleClick?: (nodeId: string) => void;
  onAddRole?: () => void;
  // --- クロスフロー入出力リンク（右サイドバー「他の業務フローと連携」） ---
  /** ノードの入出力リンク一覧（双方向）を取得。サイドバーを開いた時に呼ぶ。 */
  onFetchNodeLinks?: (nodeId: string) => Promise<NodeLinksResult>;
  /** ノードに入出力リンクを作成。 */
  onCreateNodeLink?: (
    nodeId: string,
    input: { direction: FlowLinkDirection; targetFlowId: string; targetNodeId?: string; label?: string },
  ) => Promise<void>;
  /** 入出力リンクを削除。 */
  onDeleteNodeLink?: (linkId: string) => Promise<void>;
  /** 連携先フローのノード一覧を取得（連携先ノード選択用、任意）。 */
  onFetchFlowNodes?: (flowId: string) => Promise<Array<{ id: string; label: string }>>;
  /**
   * ノードのプロパティ保存 / ドラッグでの並べ替え・レーン移動で呼ばれる。
   * - 右サイドバー保存: { label?, type?, roleId?, metadata? }
   * - ドラッグ停止: { order, roleId? }（別レーンに落ちた場合のみ roleId を含む）
   */
  onUpdateNode?: (nodeId: string, patch: NodeUpdatePatch) => void;
}

// ===========================================
// 契約（共有）に沿ったレイアウト戻り値の型ビュー
// flow-layout.ts は orientation / 縦横ジオメトリ / order echo を持つよう更新される。
// 本ファイル単体でも型検査が通るよう、契約形をローカルに表現して参照する。
// ===========================================

interface LaneGeom {
  roleId: string;
  name: string;
  color?: string;
  index: number;
  // horizontal 用
  top: number;
  height: number;
  centerY: number;
  // vertical 用
  left?: number;
  width?: number;
  centerX?: number;
}

interface PositionedNodeGeom {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  roleId: string;
  laneIndex: number;
  type: string;
  order?: number;
}

interface FlowLayoutView {
  nodes: PositionedNodeGeom[];
  lanes: LaneGeom[];
  width: number;
  height: number;
  orientation?: FlowOrientation;
}

// ===========================================
// ノードの見た目
// ===========================================

type ContentNodeData = {
  label: string;
  ntype: string;
  hasChildFlow?: boolean;
  hasLinks?: boolean;
  roleColor?: string;
  orientation: FlowOrientation;
};

const NODE_STYLE: Record<string, string> = {
  START: 'bg-emerald-50 border-emerald-400 text-emerald-700',
  END: 'bg-rose-50 border-rose-400 text-rose-700',
  DECISION: 'bg-amber-50 border-amber-400 text-amber-700',
  SYSTEM_INTEGRATION: 'bg-violet-50 border-violet-400 text-violet-700',
  DATA_STORE: 'bg-slate-50 border-slate-400 text-slate-700',
  MANUAL_OPERATION: 'bg-cyan-50 border-cyan-400 text-cyan-700',
  PROCESS: 'bg-sky-50 border-sky-400 text-sky-700',
};

function ContentNode({ data, selected }: { data: ContentNodeData; selected?: boolean }) {
  const cls = NODE_STYLE[data.ntype] ?? NODE_STYLE.PROCESS;
  // horizontal: 時間は左→右なので target=Left / source=Right
  // vertical:   時間は上→下なので target=Top  / source=Bottom
  const targetPos = data.orientation === 'vertical' ? Position.Top : Position.Left;
  const sourcePos = data.orientation === 'vertical' ? Position.Bottom : Position.Right;
  return (
    <div
      className={`px-3 py-2 rounded-lg border-2 shadow-sm w-full h-full flex flex-col items-center justify-center text-center transition-all ${cls} ${
        selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      }`}
    >
      <Handle type="target" position={targetPos} className="w-2 h-2 !bg-gray-400" />
      <div className="font-medium text-sm leading-tight line-clamp-2">{data.label}</div>
      {(data.hasChildFlow || data.hasLinks) && (
        <div className="mt-0.5 flex items-center justify-center gap-1.5">
          {data.hasChildFlow && (
            <span
              className="text-[10px] text-indigo-600 flex items-center gap-0.5"
              title="Wクリックで詳細フローを開く"
            >
              <Layers className="w-2.5 h-2.5" />
              詳細フロー
            </span>
          )}
          {data.hasLinks && (
            <span
              className="text-[10px] text-teal-600 flex items-center gap-0.5"
              title="他の業務フローと連携あり"
            >
              <GitBranch className="w-2.5 h-2.5" />
              連携
            </span>
          )}
        </div>
      )}
      <Handle type="source" position={sourcePos} className="w-2 h-2 !bg-gray-400" />
    </div>
  );
}

function LaneNode({
  data,
}: {
  data: { name: string; color?: string; orientation: FlowOrientation };
}) {
  const color = data.color ?? '#94a3b8';
  if (data.orientation === 'vertical') {
    // 縦列: ラベルは列の上端、帯は右境界に縦線
    return (
      <div
        className="w-full h-full pointer-events-none"
        style={{ backgroundColor: `${color}0d`, borderRight: `2px solid ${color}33` }}
      >
        <div
          className="absolute left-0 top-0 w-full flex items-center justify-center text-xs font-medium px-2 text-center border-b"
          style={{
            height: LANE_LABEL_W,
            backgroundColor: `${color}1f`,
            color,
            borderColor: `${color}33`,
          }}
        >
          <span className="line-clamp-3">{data.name}</span>
        </div>
      </div>
    );
  }
  // 横帯: ラベルは帯の左端、帯は下境界に横線
  return (
    <div
      className="w-full h-full pointer-events-none"
      style={{ backgroundColor: `${color}0d`, borderBottom: `2px solid ${color}33` }}
    >
      <div
        className="absolute left-0 top-0 h-full flex items-center justify-center text-xs font-medium px-2 text-center border-r"
        style={{ width: LANE_LABEL_W, backgroundColor: `${color}1f`, color, borderColor: `${color}33` }}
      >
        <span className="line-clamp-3">{data.name}</span>
      </div>
    </div>
  );
}

function EditableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, selected, data,
}: EdgeProps & { data?: { onLabelUpdate?: (id: string, label: string) => void } }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((label as string) || '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });
  const commit = () => {
    setEditing(false);
    if (data?.onLabelUpdate && value !== label) data.onLabelUpdate(id, value);
  };
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ strokeWidth: selected ? 3 : 2, stroke: selected ? '#3b82f6' : '#64748b' }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
          className="nodrag nopan"
        >
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { setValue((label as string) || ''); setEditing(false); }
              }}
              className="w-24 h-6 text-xs text-center border border-gray-300 rounded bg-white"
            />
          ) : label ? (
            <div
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className={`px-2 py-0.5 text-xs bg-white border rounded shadow-sm cursor-pointer hover:bg-blue-50 ${selected ? 'border-blue-500' : 'border-gray-300'}`}
              title="ダブルクリックで編集"
            >
              {label}
            </div>
          ) : (
            // ラベル無し: 選択中のみ、Wクリックでラベル追加できる薄いヒントを出す
            selected && (
              <div
                onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
                className="px-1.5 py-0.5 text-[10px] text-gray-400 bg-white/80 border border-dashed border-gray-300 rounded cursor-pointer hover:bg-blue-50"
                title="ダブルクリックでラベル編集"
              >
                Wクリックで編集
              </div>
            )
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { content: ContentNode, lane: LaneNode };
const edgeTypes = { editable: EditableEdge };

// ===========================================
// 種別の選択肢（右サイドバー）
// ===========================================

const NODE_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'PROCESS', label: '処理 (PROCESS)' },
  { value: 'DECISION', label: '分岐 (DECISION)' },
  { value: 'START', label: '開始 (START)' },
  { value: 'END', label: '終了 (END)' },
  { value: 'SYSTEM_INTEGRATION', label: 'システム連携 (SYSTEM_INTEGRATION)' },
  { value: 'MANUAL_OPERATION', label: '手作業 (MANUAL_OPERATION)' },
  { value: 'DATA_STORE', label: 'データ保管 (DATA_STORE)' },
];

// ===========================================
// メイン
// ===========================================

type ContextMenuState =
  | { kind: 'node'; x: number; y: number; nodeId: string; hasChildFlow: boolean }
  | { kind: 'edge'; x: number; y: number; edgeId: string }
  | { kind: 'pane'; x: number; y: number }
  | null;

const ORDER_STEP = 10;

function readStoredOrientation(flowId: string): FlowOrientation {
  if (typeof window === 'undefined') return 'horizontal';
  const v = window.localStorage.getItem('flow-orientation-' + flowId);
  return v === 'vertical' ? 'vertical' : 'horizontal';
}

function SwimlaneCanvasInner(props: SwimlaneCanvasProps) {
  const { flowData, roles } = props;
  const { fitView } = useReactFlow();
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // --- 向き（縦/横）: flow ごとに localStorage 永続化 ---
  const [orientation, setOrientation] = useState<FlowOrientation>('horizontal');
  useEffect(() => {
    setOrientation(readStoredOrientation(flowData.id));
  }, [flowData.id]);
  const toggleOrientation = useCallback(() => {
    setOrientation((prev) => {
      const next: FlowOrientation = prev === 'horizontal' ? 'vertical' : 'horizontal';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('flow-orientation-' + flowData.id, next);
      }
      return next;
    });
  }, [flowData.id]);

  // --- 構造から座標を算出（単一座標源） ---
  const layout = useMemo<FlowLayoutView>(() => {
    const inputNodes: LayoutInputNode[] = flowData.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      roleId: n.roleId ?? n.role?.id ?? null,
      order: n.order,
    }));
    const inputEdges: LayoutInputEdge[] = flowData.edges.map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
    }));
    const laneRoles = roles.map((r) => ({ id: r.id, name: r.name, color: r.color, laneHeight: r.laneHeight }));
    // 契約: computeFlowLayout(nodes, edges, roles, { orientation })
    return computeFlowLayout(inputNodes, inputEdges, laneRoles, {
      orientation,
    } as Parameters<typeof computeFlowLayout>[3]) as unknown as FlowLayoutView;
  }, [flowData.nodes, flowData.edges, roles, orientation]);

  const isVertical = orientation === 'vertical';

  // --- React Flow ノード（背景レーン + コンテンツ） ---
  const rfNodes: Node[] = useMemo(() => {
    const laneNodes: Node[] = layout.lanes.map((lane) => {
      if (isVertical) {
        const left = lane.left ?? 0;
        const width = lane.width ?? 0;
        // 縦列はラベル帯ぶん上に伸ばし、時間軸（縦）方向に全長
        return {
          id: `lane-${lane.roleId}`,
          type: 'lane',
          position: { x: left, y: -LANE_LABEL_W },
          data: { name: lane.name, color: lane.color, orientation },
          draggable: false,
          selectable: false,
          zIndex: 0,
          width,
          height: LANE_LABEL_W + layout.height + 80,
          style: { width, height: LANE_LABEL_W + layout.height + 80 },
        } as Node;
      }
      return {
        id: `lane-${lane.roleId}`,
        type: 'lane',
        position: { x: -LANE_LABEL_W, y: lane.top },
        data: { name: lane.name, color: lane.color, orientation },
        draggable: false,
        selectable: false,
        zIndex: 0,
        width: LANE_LABEL_W + layout.width + 80,
        height: lane.height,
        style: { width: LANE_LABEL_W + layout.width + 80, height: lane.height },
      } as Node;
    });

    const srcById = new Map(flowData.nodes.map((n) => [n.id, n] as const));
    const contentNodes: Node[] = layout.nodes.map((pn) => {
      const src = srcById.get(pn.id)!;
      return {
        id: pn.id,
        type: 'content',
        position: { x: pn.x - pn.width / 2, y: pn.y - pn.height / 2 },
        data: {
          label: src.label,
          ntype: pn.type,
          hasChildFlow: src.hasChildFlow || !!src.childFlowId,
          hasLinks: (src.links?.length ?? 0) > 0,
          roleColor: src.role?.color,
          orientation,
        } as ContentNodeData,
        width: pn.width,
        height: pn.height,
        style: { width: pn.width, height: pn.height },
        draggable: true,
        zIndex: 1,
      } as Node;
    });

    return [...laneNodes, ...contentNodes];
  }, [layout, flowData.nodes, orientation, isVertical]);

  const rfEdges: Edge[] = useMemo(
    () =>
      flowData.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        label: e.label || e.condition || undefined,
        type: 'editable',
        selected: e.id === selectedEdgeId,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 18, height: 18 },
        data: { onLabelUpdate: props.onUpdateEdgeLabel },
      })),
    [flowData.edges, selectedEdgeId, props.onUpdateEdgeLabel],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitView, flowData.id, layout.width, layout.height, orientation]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) props.onConnectNodes?.(c.source, c.target);
    },
    [props],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  // --- PNG出力（react-flow viewport を画像化） ---
  const handleExportPng = useCallback(() => {
    setMenu(null);
    const root = wrapperRef.current;
    if (!root) return;
    const target =
      (root.querySelector('.react-flow__viewport') as HTMLElement | null) ?? root;
    toPng(target, {
      backgroundColor: '#ffffff',
      cacheBust: true,
      pixelRatio: 2,
      filter: (el) => {
        // ミニマップ / コントロール / パネル / ヒントは画像から除外
        if (!(el instanceof HTMLElement)) return true;
        return !(
          el.classList?.contains('react-flow__minimap') ||
          el.classList?.contains('react-flow__controls') ||
          el.classList?.contains('react-flow__panel')
        );
      },
    })
      .then((dataUrl) => {
        const a = document.createElement('a');
        a.download = (flowData.name || 'flow') + '.png';
        a.href = dataUrl;
        a.click();
      })
      .catch(() => {
        /* 画像化に失敗しても致命ではないため無視 */
      });
  }, [flowData.name]);

  // --- ドラッグ停止: ドロップ位置から order（と必要なら roleId）を再計算 ---
  const handleNodeDragStop = useCallback(
    (_evt: unknown, node: Node) => {
      if (node.type !== 'content') return;
      const dragged = layout.nodes.find((n) => n.id === node.id);
      if (!dragged) return;
      const w = node.width ?? dragged.width;
      const h = node.height ?? dragged.height;
      // React Flow の position は左上。中心へ補正。
      const centerX = node.position.x + w / 2;
      const centerY = node.position.y + h / 2;
      const timeCoord = isVertical ? centerY : centerX;

      const patch: NodeUpdatePatch = {};

      // クロス軸（レーン）判定 — 別レーンに落ちたら roleId を含める。
      // horizontal はレーン中心Yで、vertical はレーン中心Xで最近傍レーンを選ぶ。
      if (layout.lanes.length > 0) {
        let best = layout.lanes[0];
        let bestDist = Infinity;
        for (const lane of layout.lanes) {
          const laneCenter = isVertical
            ? lane.centerX ?? (lane.left ?? 0) + (lane.width ?? 0) / 2
            : lane.centerY;
          const cross = isVertical ? centerX : centerY;
          const d = Math.abs(cross - laneCenter);
          if (d < bestDist) { bestDist = d; best = lane; }
        }
        if (best.roleId !== dragged.roleId) patch.roleId = best.roleId;
      }

      // 時間軸（order）再計算: 他のコンテンツノードの時間軸中心と比較し
      // 落ちた位置の前後ノードの order の中点を割り当てる。
      const others = layout.nodes
        .filter((n) => n.id !== node.id)
        .map((n) => ({
          id: n.id,
          time: isVertical ? n.y : n.x,
          order: typeof n.order === 'number' ? n.order : 0,
        }))
        .sort((a, b) => a.time - b.time);

      let newOrder: number;
      if (others.length === 0) {
        newOrder = 0;
      } else {
        // 落下位置の直前 / 直後を探す
        let prev: { order: number } | null = null;
        let next: { order: number } | null = null;
        for (const o of others) {
          if (o.time <= timeCoord) prev = o;
          else { next = o; break; }
        }
        if (prev && next) {
          newOrder = (prev.order + next.order) / 2;
        } else if (prev && !next) {
          newOrder = prev.order + ORDER_STEP;
        } else if (!prev && next) {
          newOrder = next.order - ORDER_STEP;
        } else {
          newOrder = 0;
        }
      }
      patch.order = newOrder;

      props.onUpdateNode?.(node.id, patch);
      // 次レンダリングでエンジンが再レイアウトするため、ローカル位置は触らない。
    },
    [layout, isVertical, props],
  );

  return (
    <div ref={wrapperRef} className="relative w-full h-full bg-white">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        nodesDraggable
        nodesConnectable
        elementsSelectable
        connectionMode={ConnectionMode.Loose}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeDragStop={handleNodeDragStop}
        onPaneClick={() => { setSelectedEdgeId(null); closeMenu(); }}
        onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
        onNodeClick={(_, node) => {
          if (node.type === 'content') setEditingNodeId(node.id);
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type !== 'content') return;
          // ドリルダウン: 子フローがあれば開き、無ければ作成してから遷移（呼び出し側に委譲）
          if (props.onNodeDoubleClick) {
            props.onNodeDoubleClick(node.id);
            return;
          }
          // 後方互換: onNodeDoubleClick 未指定なら従来どおり既存子フローのみ開く
          const src = flowData.nodes.find((n) => n.id === node.id);
          if (src?.childFlowId) props.onOpenChildFlow?.(node.id, src.childFlowId);
        }}
        onNodeContextMenu={(e, node) => {
          if (node.type === 'lane') return;
          e.preventDefault();
          const src = flowData.nodes.find((n) => n.id === node.id);
          setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id, hasChildFlow: !!src?.hasChildFlow });
        }}
        onEdgeContextMenu={(e, edge) => {
          e.preventDefault();
          setMenu({ kind: 'edge', x: e.clientX, y: e.clientY, edgeId: edge.id });
        }}
        onPaneContextMenu={(e) => {
          e.preventDefault();
          setMenu({ kind: 'pane', x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY });
        }}
        className="bg-gray-50"
      >
        <Background color="#e2e8f0" gap={22} />
        <Controls className="bg-white border border-gray-200 rounded-lg shadow-sm" />
        <MiniMap
          className="bg-white border border-gray-200 rounded-lg shadow-sm"
          nodeColor={(n) => (n.type === 'lane' ? 'transparent' : '#93c5fd')}
          maskColor="rgba(0,0,0,0.04)"
        />

        <Panel position="top-left" className="bg-white border border-gray-200 rounded-lg shadow-sm p-2">
          <div className="flex items-center gap-2">
            {flowData.breadcrumbs.length > 1 && props.onBack && (
              <Button variant="ghost" size="sm" onClick={props.onBack} className="text-gray-600">
                <ChevronLeft className="w-4 h-4 mr-1" />戻る
              </Button>
            )}
            <div className="flex items-center gap-1 text-sm">
              {flowData.kind && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[11px] font-bold mr-1 ${
                    flowData.kind === 'TOBE' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {flowData.kind}
                </span>
              )}
              {flowData.confidence === 'HYPOTHESIS' && (
                <span className="px-1.5 py-0.5 rounded text-[11px] bg-amber-100 text-amber-700 mr-1">仮説</span>
              )}
              {flowData.breadcrumbs.map((c, i) => (
                <span key={c.id} className="flex items-center">
                  {i > 0 && <span className="text-gray-400 mx-1">/</span>}
                  <span className={i === flowData.breadcrumbs.length - 1 ? 'font-medium text-gray-900' : 'text-gray-500'}>
                    {c.name}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </Panel>

        {/* ツールバー（右上）: 縦横トグル + PNG出力 */}
        <Panel position="top-right" className="bg-white border border-gray-200 rounded-lg shadow-sm p-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleOrientation}
              className="text-gray-700"
              title="スイムレーンの向きを切り替え"
            >
              <RotateCw className="w-4 h-4 mr-1" />
              {isVertical ? '縦' : '横'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPng}
              className="text-gray-700"
              title="現在の図をPNG画像で保存"
            >
              <Download className="w-4 h-4 mr-1" />
              画像出力(PNG)
            </Button>
          </div>
        </Panel>
      </ReactFlow>

      {/* コンテキストメニュー */}
      {menu && (
        <div
          className="fixed bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 min-w-[180px]"
          style={{ left: menu.x, top: menu.y }}
          onMouseLeave={closeMenu}
        >
          {menu.kind === 'node' && (
            <>
              <div className="px-3 py-1 text-[11px] text-gray-400">ロール変更</div>
              <div className="max-h-40 overflow-auto">
                {roles.map((r) => (
                  <button
                    key={r.id}
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                    onClick={() => { props.onChangeNodeRole?.(menu.nodeId, r.id); closeMenu(); }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: r.color }} />
                    {r.name}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-200 my-1" />
              <button
                className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                onClick={() => { setEditingNodeId(menu.nodeId); closeMenu(); }}
              >
                <Layers className="h-4 w-4 text-gray-500" />プロパティを編集
              </button>
              {!menu.hasChildFlow && (
                <button
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                  onClick={() => { props.onCreateChildFlow?.(menu.nodeId); closeMenu(); }}
                >
                  <Layers className="h-4 w-4 text-gray-500" />詳細フロー作成
                </button>
              )}
              <button
                className="w-full px-3 py-2 text-sm text-left hover:bg-red-50 flex items-center gap-2 text-red-600"
                onClick={() => { props.onDeleteNode?.(menu.nodeId); closeMenu(); }}
              >
                <Trash2 className="h-4 w-4" />ノードを削除
              </button>
            </>
          )}
          {menu.kind === 'edge' && (
            <button
              className="w-full px-3 py-2 text-sm text-left hover:bg-red-50 flex items-center gap-2 text-red-600"
              onClick={() => { props.onDeleteEdge?.(menu.edgeId); closeMenu(); }}
            >
              <Trash2 className="h-4 w-4" />矢印を削除
            </button>
          )}
          {menu.kind === 'pane' && (
            <>
              <button className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                onClick={() => { props.onCreateNode?.({ type: 'PROCESS' }); closeMenu(); }}>
                <Plus className="h-4 w-4 text-sky-500" />処理ノード追加
              </button>
              <button className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                onClick={() => { props.onCreateNode?.({ type: 'DECISION' }); closeMenu(); }}>
                <GitBranch className="h-4 w-4 text-amber-500" />分岐ノード追加
              </button>
              <button className="w-full px-3 py-2 text-sm text-left hover:bg-gray-100 flex items-center gap-2"
                onClick={() => { props.onCreateNode?.({ type: 'SYSTEM_INTEGRATION' }); closeMenu(); }}>
                <Cpu className="h-4 w-4 text-violet-500" />システム連携追加
              </button>
            </>
          )}
        </div>
      )}

      {/* ノードプロパティ右サイドバー */}
      {editingNodeId && (
        <NodePropertyPanel
          key={editingNodeId}
          node={flowData.nodes.find((n) => n.id === editingNodeId) ?? null}
          roles={roles}
          currentFlowId={flowData.id}
          otherFlows={props.otherFlows ?? []}
          onClose={() => setEditingNodeId(null)}
          onUpdateNode={props.onUpdateNode}
          onFetchNodeLinks={props.onFetchNodeLinks}
          onCreateNodeLink={props.onCreateNodeLink}
          onDeleteNodeLink={props.onDeleteNodeLink}
          onFetchFlowNodes={props.onFetchFlowNodes}
        />
      )}

      {roles.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            onClick={() => props.onAddRole?.()}
            className="bg-white border border-gray-200 rounded-lg px-5 py-4 shadow-sm hover:border-blue-400 hover:shadow-md transition-all flex flex-col items-center gap-2 text-gray-600"
          >
            <Users className="w-6 h-6 text-blue-600" />
            <span className="text-sm font-medium">まずロール（スイムレーン）を追加してください</span>
            <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
              <Plus className="w-3.5 h-3.5" />ロールを追加
            </span>
          </button>
        </div>
      )}

      <div className="absolute bottom-4 right-4 bg-white/90 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-500 z-10">
        💡 ノードをドラッグで並べ替え/レーン移動 ｜ クリックで編集 ｜ ハンドルで接続 ｜ 右クリックで追加/削除 ｜ 矢印ラベルはWクリックで編集
      </div>
    </div>
  );
}

// ===========================================
// ノードプロパティ右サイドバー
// ===========================================

function readMeta(node: FlowDataNode | null): {
  duration: string;
  input: string;
  output: string;
  notes: string;
} {
  const meta = (node?.metadata ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    duration: s(meta.duration),
    input: s(meta.input),
    output: s(meta.output),
    notes: s(meta.notes),
  };
}

// ===========================================
// クロスフロー入出力リンク（右サイドバー内セクション）
// ===========================================

type AddLinkDraft = {
  direction: FlowLinkDirection;
  targetFlowId: string;
  targetNodeId: string;
  label: string;
} | null;

function NodeLinksSection({
  node,
  currentFlowId,
  otherFlows,
  onFetchNodeLinks,
  onCreateNodeLink,
  onDeleteNodeLink,
  onFetchFlowNodes,
}: {
  node: FlowDataNode | null;
  currentFlowId: string;
  otherFlows: FlowSummary[];
  onFetchNodeLinks?: (nodeId: string) => Promise<NodeLinksResult>;
  onCreateNodeLink?: (
    nodeId: string,
    input: { direction: FlowLinkDirection; targetFlowId: string; targetNodeId?: string; label?: string },
  ) => Promise<void>;
  onDeleteNodeLink?: (linkId: string) => Promise<void>;
  onFetchFlowNodes?: (flowId: string) => Promise<Array<{ id: string; label: string }>>;
}) {
  const [links, setLinks] = useState<NodeLinksResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<AddLinkDraft>(null);
  const [draftNodes, setDraftNodes] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);

  // 連携可能な他フロー（自分自身を除外）
  const selectableFlows = useMemo(
    () => otherFlows.filter((f) => f.id !== currentFlowId),
    [otherFlows, currentFlowId],
  );

  const reload = useCallback(async () => {
    if (!node || !onFetchNodeLinks) return;
    setLoading(true);
    try {
      const result = await onFetchNodeLinks(node.id);
      setLinks(result);
    } catch {
      // 取得失敗時はフロー詳細に含まれる links を OUTPUT 起点としてフォールバック表示
      setLinks({
        nodeId: node.id,
        outgoing: node.links ?? [],
        incoming: [],
      });
    } finally {
      setLoading(false);
    }
  }, [node, onFetchNodeLinks]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ドラフトの連携先フローが変わったら、その連携先ノード候補を取得
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!draft || !draft.targetFlowId || !onFetchFlowNodes) {
        setDraftNodes([]);
        return;
      }
      try {
        const ns = await onFetchFlowNodes(draft.targetFlowId);
        if (!cancelled) setDraftNodes(ns);
      } catch {
        if (!cancelled) setDraftNodes([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [draft, onFetchFlowNodes]);

  const startAdd = (direction: FlowLinkDirection) => {
    setDraft({
      direction,
      targetFlowId: selectableFlows[0]?.id ?? '',
      targetNodeId: '',
      label: '',
    });
  };

  const commitAdd = async () => {
    if (!node || !draft || !draft.targetFlowId || !onCreateNodeLink) return;
    setBusy(true);
    try {
      await onCreateNodeLink(node.id, {
        direction: draft.direction,
        targetFlowId: draft.targetFlowId,
        targetNodeId: draft.targetNodeId || undefined,
        label: draft.label.trim() || undefined,
      });
      setDraft(null);
      await reload();
    } catch {
      /* 失敗時はドラフトを残す */
    } finally {
      setBusy(false);
    }
  };

  const removeLink = async (linkId: string) => {
    if (!onDeleteNodeLink) return;
    setBusy(true);
    try {
      await onDeleteNodeLink(linkId);
      await reload();
    } catch {
      /* noop */
    } finally {
      setBusy(false);
    }
  };

  if (!node) return null;

  const outgoing = links?.outgoing ?? node.links ?? [];
  const incoming = links?.incoming ?? [];
  const inputLinks = outgoing.filter((l) => l.direction === 'INPUT');
  const outputLinks = outgoing.filter((l) => l.direction === 'OUTPUT');

  const linkSupported = !!onCreateNodeLink && !!onFetchNodeLinks;

  return (
    <div className="pt-2 border-t border-gray-200">
      <div className="flex items-center gap-1.5 mb-2">
        <Link2 className="w-3.5 h-3.5 text-teal-600" />
        <span className="text-[11px] font-semibold text-gray-700">他の業務フローと連携</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
      </div>

      {!linkSupported ? (
        <p className="text-[11px] text-gray-400">連携機能は利用できません。</p>
      ) : (
        <div className="space-y-3">
          {/* INPUT 元フロー */}
          <LinkGroup
            title="INPUT元フロー"
            icon={<ArrowDownLeft className="w-3 h-3 text-blue-500" />}
            emptyText="INPUT元フローはありません"
            links={inputLinks}
            onDelete={removeLink}
            disabled={busy}
          />
          {draft?.direction === 'INPUT' ? (
            <AddLinkForm
              draft={draft}
              setDraft={setDraft}
              flows={selectableFlows}
              targetNodes={draftNodes}
              onCancel={() => setDraft(null)}
              onCommit={commitAdd}
              busy={busy}
            />
          ) : (
            <button
              type="button"
              onClick={() => startAdd('INPUT')}
              disabled={selectableFlows.length === 0 || !!draft}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-blue-600 border border-dashed border-blue-300 rounded hover:bg-blue-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              INPUT元フローを追加
            </button>
          )}

          {/* OUTPUT 先フロー */}
          <LinkGroup
            title="OUTPUT先フロー"
            icon={<ArrowUpRight className="w-3 h-3 text-emerald-500" />}
            emptyText="OUTPUT先フローはありません"
            links={outputLinks}
            onDelete={removeLink}
            disabled={busy}
          />
          {draft?.direction === 'OUTPUT' ? (
            <AddLinkForm
              draft={draft}
              setDraft={setDraft}
              flows={selectableFlows}
              targetNodes={draftNodes}
              onCancel={() => setDraft(null)}
              onCommit={commitAdd}
              busy={busy}
            />
          ) : (
            <button
              type="button"
              onClick={() => startAdd('OUTPUT')}
              disabled={selectableFlows.length === 0 || !!draft}
              className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] text-emerald-600 border border-dashed border-emerald-300 rounded hover:bg-emerald-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" />
              OUTPUT先フローを追加
            </button>
          )}

          {/* このノードを参照している他フロー（被参照） */}
          {incoming.length > 0 && (
            <div>
              <div className="text-[10px] text-gray-400 mb-1">他フローから参照されています</div>
              <div className="flex flex-wrap gap-1">
                {incoming.map((l) => (
                  <span
                    key={l.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-gray-100 text-gray-600 rounded-full"
                    title={`${l.targetFlowName ?? '不明なフロー'}${l.targetNodeLabel ? ' / ' + l.targetNodeLabel : ''}（${l.direction}）`}
                  >
                    <GitBranch className="w-2.5 h-2.5" />
                    {l.targetFlowName ?? '不明なフロー'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {selectableFlows.length === 0 && (
            <p className="text-[11px] text-gray-400">連携先にできる他のフローがありません。</p>
          )}
        </div>
      )}
    </div>
  );
}

function LinkGroup({
  title,
  icon,
  emptyText,
  links,
  onDelete,
  disabled,
}: {
  title: string;
  icon: ReactNode;
  emptyText: string;
  links: FlowNodeLink[];
  onDelete: (linkId: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] font-medium text-gray-500 mb-1">
        {icon}
        {title}
      </div>
      {links.length === 0 ? (
        <p className="text-[10px] text-gray-400">{emptyText}</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {links.map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-[10px] bg-teal-50 text-teal-700 border border-teal-200 rounded-full"
              title={`${l.targetFlowName ?? '不明なフロー'}${l.targetNodeLabel ? ' / ' + l.targetNodeLabel : ''}${l.label ? '（' + l.label + '）' : ''}`}
            >
              <span className="max-w-[120px] truncate">
                {l.targetFlowName ?? '不明なフロー'}
                {l.targetNodeLabel ? ` / ${l.targetNodeLabel}` : ''}
              </span>
              {l.label ? <span className="text-teal-500">［{l.label}］</span> : null}
              <button
                type="button"
                onClick={() => onDelete(l.id)}
                disabled={disabled}
                className="p-0.5 rounded-full hover:bg-teal-200 disabled:opacity-40"
                title="連携を削除"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function AddLinkForm({
  draft,
  setDraft,
  flows,
  targetNodes,
  onCancel,
  onCommit,
  busy,
}: {
  draft: NonNullable<AddLinkDraft>;
  setDraft: (d: AddLinkDraft) => void;
  flows: FlowSummary[];
  targetNodes: Array<{ id: string; label: string }>;
  onCancel: () => void;
  onCommit: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-2 space-y-2">
      <div className="text-[10px] font-medium text-gray-600 flex items-center gap-1">
        {draft.direction === 'INPUT' ? (
          <>
            <ArrowDownLeft className="w-3 h-3 text-blue-500" />
            INPUT元フローを追加
          </>
        ) : (
          <>
            <ArrowUpRight className="w-3 h-3 text-emerald-500" />
            OUTPUT先フローを追加
          </>
        )}
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-0.5">連携先フロー</label>
        <select
          value={draft.targetFlowId}
          onChange={(e) => setDraft({ ...draft, targetFlowId: e.target.value, targetNodeId: '' })}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white"
        >
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.parentId ? '（詳細）' : ''}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-0.5">連携先ノード（任意）</label>
        <select
          value={draft.targetNodeId}
          onChange={(e) => setDraft({ ...draft, targetNodeId: e.target.value })}
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white"
        >
          <option value="">（フロー全体）</option>
          {targetNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[10px] text-gray-500 mb-0.5">ラベル（任意）</label>
        <input
          value={draft.label}
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="例: 受注データ"
          className="w-full px-2 py-1 text-xs border border-gray-300 rounded"
        />
      </div>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-200 rounded disabled:opacity-40"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={busy || !draft.targetFlowId}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] text-white bg-teal-600 hover:bg-teal-700 rounded disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
          追加
        </button>
      </div>
    </div>
  );
}

function NodePropertyPanel({
  node,
  roles,
  currentFlowId,
  otherFlows,
  onClose,
  onUpdateNode,
  onFetchNodeLinks,
  onCreateNodeLink,
  onDeleteNodeLink,
  onFetchFlowNodes,
}: {
  node: FlowDataNode | null;
  roles: Role[];
  currentFlowId: string;
  otherFlows: FlowSummary[];
  onClose: () => void;
  onUpdateNode?: (nodeId: string, patch: NodeUpdatePatch) => void;
  onFetchNodeLinks?: (nodeId: string) => Promise<NodeLinksResult>;
  onCreateNodeLink?: (
    nodeId: string,
    input: { direction: FlowLinkDirection; targetFlowId: string; targetNodeId?: string; label?: string },
  ) => Promise<void>;
  onDeleteNodeLink?: (linkId: string) => Promise<void>;
  onFetchFlowNodes?: (flowId: string) => Promise<Array<{ id: string; label: string }>>;
}) {
  const [label, setLabel] = useState(node?.label ?? '');
  const [type, setType] = useState(node?.type ?? 'PROCESS');
  const [roleId, setRoleId] = useState(node?.roleId ?? node?.role?.id ?? '');
  const initMeta = readMeta(node);
  const [duration, setDuration] = useState(initMeta.duration);
  const [input, setInput] = useState(initMeta.input);
  const [output, setOutput] = useState(initMeta.output);
  const [notes, setNotes] = useState(initMeta.notes);

  const save = useCallback(() => {
    if (!node) return;
    const patch: NodeUpdatePatch = {
      metadata: { duration, input, output, notes },
    };
    if (label !== node.label) patch.label = label;
    if (type !== node.type) patch.type = type;
    const currentRole = node.roleId ?? node.role?.id ?? '';
    if (roleId && roleId !== currentRole) patch.roleId = roleId;
    onUpdateNode?.(node.id, patch);
  }, [node, label, type, roleId, duration, input, output, notes, onUpdateNode]);

  if (!node) return null;

  return (
    <div className="absolute top-0 right-0 h-full w-full sm:w-80 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col animate-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">ノードのプロパティ</h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-500"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ラベル</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={save}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">種別</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            onBlur={save}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            {NODE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ロール</label>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            onBlur={save}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">（未割当）</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">処理時間</label>
          <input
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            onBlur={save}
            placeholder="例: 約10分"
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">INPUT</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onBlur={save}
            rows={2}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">OUTPUT</label>
          <textarea
            value={output}
            onChange={(e) => setOutput(e.target.value)}
            onBlur={save}
            rows={2}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">補足</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={save}
            rows={3}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded resize-y focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <NodeLinksSection
          node={node}
          currentFlowId={currentFlowId}
          otherFlows={otherFlows}
          onFetchNodeLinks={onFetchNodeLinks}
          onCreateNodeLink={onCreateNodeLink}
          onDeleteNodeLink={onDeleteNodeLink}
          onFetchFlowNodes={onFetchFlowNodes}
        />
      </div>

      <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-600">
          閉じる
        </Button>
        <Button size="sm" onClick={() => { save(); onClose(); }} className="bg-blue-600 hover:bg-blue-700 text-white">
          保存
        </Button>
      </div>
    </div>
  );
}

export function SwimlaneCanvas(props: SwimlaneCanvasProps) {
  return (
    <ReactFlowProvider>
      <SwimlaneCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
