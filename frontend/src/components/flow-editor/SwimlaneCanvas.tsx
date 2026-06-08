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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from 'react';
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
  useNodesState,
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
  LayoutGrid,
  Database,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  computeFlowLayout,
  computeLaneBands,
  type LayoutInputNode,
  type LayoutInputEdge,
  type BandInputNode,
  type LayoutRole,
} from './flow-layout';
import type {
  FlowData,
  FlowDataEdge,
  FlowDataNode,
  FlowLinkDirection,
  FlowNodeLink,
  FlowSummary,
  Role,
} from './flow-types';
import {
  INFORMATION_CATEGORY_LABELS,
  type InformationCategory,
  type InformationType,
} from '@/lib/dfd';

const LANE_LABEL_W = 132;

export type FlowOrientation = 'horizontal' | 'vertical';

/** ノード更新の差分パッチ。プロパティ保存・ドラッグでの自由配置保存の双方で使う。 */
export interface NodeUpdatePatch {
  label?: string;
  type?: string;
  roleId?: string;
  order?: number;
  /** 自由配置の保存座標（ノード左上ではなく中心ではなく、サーバ保存値=左上基準）。 */
  positionX?: number;
  positionY?: number;
  /** 処理時間（実カラム。旧 metadata.duration）。 */
  processingTime?: string | null;
  /** 今回の対応数（実カラム。旧 metadata.handledCount）。 */
  handledCount?: string | null;
  /** 補足（実カラム。旧 metadata.notes）。 */
  supplement?: string | null;
  metadata?: Record<string, unknown>;
}

/** 整形（一括位置保存）の 1 ノード分。`PUT /:flowId/nodes/positions` の positions[] に対応。 */
export interface NodePositionPatch {
  id: string;
  positionX: number;
  positionY: number;
  roleId?: string | null;
  order?: number;
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
  /**
   * 2ノードを接続する。ドラッグで使ったハンドル側（'top'|'right'|'bottom'|'left'）を
   * sourceHandle/targetHandle として渡す。呼び出し側は POST /edges の body に含める。
   */
  onConnectNodes?: (
    sourceNodeId: string,
    targetNodeId: string,
    handles?: { sourceHandle?: string | null; targetHandle?: string | null },
  ) => void;
  onDeleteNode?: (nodeId: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
  /**
   * 既存エッジの端点をドラッグで付け替える（再ルーティング）。
   * React Flow v12 の onReconnect から呼ばれ、新しい source/target ノードとハンドル側を渡す。
   * 呼び出し側は PATCH /:flowId/edges/:edgeId で永続化する。
   */
  onReconnectEdge?: (
    edgeId: string,
    next: {
      sourceNodeId: string;
      targetNodeId: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => void;
  onUpdateEdgeLabel?: (edgeId: string, label: string) => void;
  /**
   * エッジの編集パネルからの保存。運ぶ情報種別（informationTypeId）/ラベルを
   * PUT /:flowId/edges/:edgeId で永続化する処理は呼び出し側（ページ）に委譲する。
   * informationTypeId は null で「未設定」を表す。undefined のキーは送らない。
   */
  onUpdateEdge?: (
    edgeId: string,
    patch: { informationTypeId?: string | null; label?: string },
  ) => Promise<void> | void;
  /**
   * 接続線（エッジ）の途中にノードを挿入する。
   * エッジ上の「＋」アフォーダンスをクリックすると呼ばれる。
   * source→新ノード→target に繋ぎ替える処理は呼び出し側（ページ）に委譲する。
   */
  onInsertNodeOnEdge?: (edgeId: string) => void;
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
  // --- ノードINPUT/OUTPUT（情報種別マスタからの多選択） ---
  /** プロジェクトの情報種別マスタ（INPUT/OUTPUT 多選択の選択肢）。 */
  informationTypes?: InformationType[];
  /**
   * ノードのINPUT/OUTPUT（情報種別リンク）を replace-all 保存する。
   * PUT business-flows/:flowId/nodes/:nodeId/information-links に { links } を送る処理は
   * 呼び出し側（ページ）に委譲する。
   */
  onSaveNodeInformationLinks?: (
    nodeId: string,
    links: Array<{ informationTypeId: string; direction: FlowLinkDirection; order?: number }>,
  ) => Promise<void> | void;
  /**
   * ノードのプロパティ保存 / ドラッグでの自由配置保存・レーン移動で呼ばれる。
   * - 右サイドバー保存: { label?, type?, roleId?, metadata? }
   * - ドラッグ停止: { positionX, positionY, roleId? }（別レーンに落ちた場合のみ roleId を含む）
   */
  onUpdateNode?: (nodeId: string, patch: NodeUpdatePatch) => void;
  /**
   * 「整形」: 全ノードの位置/ロール/順序を一括保存する（`PUT /:flowId/nodes/positions`）。
   * computeFlowLayout で算出した綺麗な座標を渡し、呼び出し側が永続化→再取得する。
   */
  onTidyNodes?: (positions: NodePositionPatch[]) => Promise<void> | void;
  /**
   * スイムレーン（ロール）の手動リサイズ後の高さを永続化する。
   * レーン背景の下端ハンドルをドラッグすると呼ばれる（roleId, 新しい厚み）。
   * ページ側は PUT /api/business-flows/:flowId { laneHeights } で保存する。
   */
  onUpdateLaneHeight?: (roleId: string, height: number) => void;
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

// 4辺の接続ハンドル定義。ConnectionMode.Loose 下では各ハンドルが source/target 両用。
// id は安定値（'top'|'right'|'bottom'|'left'）で、保存された接続側の復元に使う。
const HANDLE_SIDES: Array<{ id: string; position: Position }> = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

function ContentNode({ data, selected }: { data: ContentNodeData; selected?: boolean }) {
  const cls = NODE_STYLE[data.ntype] ?? NODE_STYLE.PROCESS;
  return (
    <div
      className={`group/node px-3 py-2 rounded-lg border-2 shadow-sm w-full h-full flex flex-col items-center justify-center text-center transition-all ${cls} ${
        selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      }`}
    >
      {/* 4辺のハンドル: それぞれ source/target 兼用（ConnectionMode.Loose）。
          矢印を任意の辺へ付け替えられるようにする。小さなドットで、
          ノード本体のドラッグを邪魔しないよう nodrag を付与。
          source/target を同位置に重ね、見た目は source 側のドットのみ表示する。 */}
      {HANDLE_SIDES.map((h) => (
        <Handle
          key={`s-${h.id}`}
          type="source"
          id={h.id}
          position={h.position}
          className="nodrag !w-2 !h-2 !min-w-0 !min-h-0 !bg-gray-400 !border !border-white opacity-50 transition-opacity group-hover/node:opacity-100"
        />
      ))}
      {HANDLE_SIDES.map((h) => (
        <Handle
          key={`t-${h.id}`}
          type="target"
          id={h.id}
          position={h.position}
          className="nodrag !w-2 !h-2 !min-w-0 !min-h-0 !bg-transparent !border-0"
        />
      ))}
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
    </div>
  );
}

type LaneNodeData = {
  name: string;
  color?: string;
  orientation: FlowOrientation;
  roleId: string;
  /** リサイズ可能か（実ロールのみ。未割当レーンは不可）。 */
  resizable?: boolean;
  /** リサイズハンドルの pointerDown。canvas 側がドラッグを引き受ける。 */
  onResizeStart?: (roleId: string, e: ReactPointerEvent) => void;
};

function LaneNode({ data }: { data: LaneNodeData }) {
  const color = data.color ?? '#94a3b8';
  const isVertical = data.orientation === 'vertical';

  // レーン境界のリサイズハンドル。横帯=下端、縦列=右端。
  // 親（lane 背景）は pointer-events-none なので、ハンドルだけ pointer-events-auto。
  const handle = data.resizable && data.onResizeStart && (
    <div
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      title="ドラッグでレーンの幅を調整"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        data.onResizeStart?.(data.roleId, e);
      }}
      className={`nodrag nopan pointer-events-auto absolute z-10 group ${
        isVertical
          ? 'top-0 right-0 h-full w-2 cursor-col-resize'
          : 'left-0 bottom-0 w-full h-2 cursor-row-resize'
      }`}
    >
      <div
        className={`opacity-0 group-hover:opacity-100 transition-opacity ${
          isVertical ? 'absolute right-0 top-0 h-full w-1' : 'absolute bottom-0 left-0 w-full h-1'
        }`}
        style={{ backgroundColor: color }}
      />
    </div>
  );

  if (isVertical) {
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
        {handle}
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
      {handle}
    </div>
  );
}

function EditableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, selected, data,
}: EdgeProps & {
  data?: {
    onLabelUpdate?: (id: string, label: string) => void;
    onInsertNode?: (id: string) => void;
    /** この矢印が運ぶ情報種別名（チップ表示用）。未設定なら表示しない。 */
    informationTypeName?: string | null;
  };
}) {
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
  // 「＋」挿入アフォーダンスはエッジの中点に置く。ラベルと重ならないよう少し下げる。
  const insertX = (sourceX + targetX) / 2;
  const insertY = (sourceY + targetY) / 2;
  const infoName = data?.informationTypeName;
  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{ strokeWidth: selected ? 3 : 2, stroke: selected ? '#3b82f6' : '#64748b' }}
      />
      <EdgeLabelRenderer>
        {/* 運ぶ情報種別のチップ: ラベルの少し上に置く（source の OUTPUT → target の INPUT） */}
        {infoName && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY - 16}px)`,
              pointerEvents: 'none',
            }}
            className="nodrag nopan"
          >
            <span
              className={`inline-flex items-center gap-0.5 rounded-full border bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 shadow-sm ${
                selected ? 'border-indigo-400' : 'border-indigo-200'
              }`}
              title={`運ぶ情報: ${infoName}`}
            >
              <Database className="h-2.5 w-2.5" />
              {infoName}
            </span>
          </div>
        )}
        {/* エッジ中点の「＋」: クリックでこの接続線の途中にノードを挿入 */}
        {data?.onInsertNode && (
          <button
            type="button"
            title="この接続線の途中にノードを挿入"
            onClick={(e) => {
              e.stopPropagation();
              data.onInsertNode?.(id);
            }}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${insertX}px,${insertY}px)`,
              pointerEvents: 'all',
            }}
            className={`nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border bg-white text-sky-600 shadow-sm transition-all hover:bg-sky-50 hover:scale-110 hover:opacity-100 ${
              selected ? 'border-sky-500 opacity-100' : 'border-gray-300 opacity-40'
            }`}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
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

// コンテンツノードの描画サイズ（自由配置のシード/整形と一致させる。
// flow-layout の DEFAULT_LAYOUT_OPTIONS.nodeWidth/nodeHeight と揃える）。
const NODE_W = 156;
const NODE_H = 52;

/** ノードが「未配置（座標が保存されていない）」か判定。 */
function isUnpositioned(n: FlowDataNode): boolean {
  return (n.positionX ?? 0) === 0 && (n.positionY ?? 0) === 0;
}

function readStoredOrientation(flowId: string): FlowOrientation {
  if (typeof window === 'undefined') return 'horizontal';
  const v = window.localStorage.getItem('flow-orientation-' + flowId);
  return v === 'vertical' ? 'vertical' : 'horizontal';
}

function SwimlaneCanvasInner(props: SwimlaneCanvasProps) {
  const { flowData, roles } = props;
  const { fitView, getViewport } = useReactFlow();
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

  const isVertical = orientation === 'vertical';

  // ロール → computeFlowLayout / computeLaneBands 共通のロール入力。
  const laneRoles = useMemo<LayoutRole[]>(
    () =>
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        laneHeight: r.laneHeight,
      })),
    [roles],
  );

  // --- レーン高さの手動オーバーライド（サーバ永続化 + ドラッグ中のローカル先取り） ---
  // サーバから来た flowData.laneHeights を基底に、ドラッグ中はローカル state を重ねて
  // 即時にプレビューする。ドラッグ完了時に onUpdateLaneHeight で永続化する。
  // 整形エンジン（computeFlowLayout）と背景レーン帯（computeLaneBands）の両方が
  // この同一値を使うため、tidyLayout より前に宣言する。
  const [localLaneHeights, setLocalLaneHeights] = useState<Record<string, number>>({});
  useEffect(() => {
    // フロー切替時はローカルのドラッグ先取りを破棄してサーバ値に従う
    setLocalLaneHeights({});
  }, [flowData.id]);
  const laneHeightOverrides = useMemo(
    () => ({ ...(flowData.laneHeights ?? {}), ...localLaneHeights }),
    [flowData.laneHeights, localLaneHeights],
  );

  // --- 整形エンジン（computeFlowLayout）: 綺麗な決定的座標 ---
  // 用途は 2 つ:
  //  1) 未配置ノード（positionX/Y が 0,0）のシード位置（原点スタックを防ぐ）
  //  2) 「整形」ボタンが永続化する綺麗なレイアウト
  // ノードの roleId が変わったり向きが変わると再計算される。
  const tidyLayout = useMemo<FlowLayoutView>(() => {
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
    // 整形が算出するレーン厚を背景レーン帯（computeLaneBands）と完全一致させるため、
    // 同一の laneHeightOverrides を渡す。これにより整形後にノード中心が必ず
    // 自レーン帯内に収まり、帯の外へはみ出さない。
    return computeFlowLayout(inputNodes, inputEdges, laneRoles, {
      orientation,
      laneHeightOverrides,
    } as Parameters<typeof computeFlowLayout>[3]) as unknown as FlowLayoutView;
  }, [flowData.nodes, flowData.edges, laneRoles, orientation, laneHeightOverrides]);

  // --- 各ノードの実効位置（左上座標） ---
  // 保存済み positionX/Y があればそれを使い、未配置なら tidyLayout のシード座標を使う。
  // 「実位置を持つノードは決して上書きしない」のがルール（自由配置の尊重）。
  const effectivePositions = useMemo(() => {
    const seedById = new Map(tidyLayout.nodes.map((n) => [n.id, n] as const));
    const map = new Map<string, { x: number; y: number }>();
    for (const n of flowData.nodes) {
      if (isUnpositioned(n)) {
        const seed = seedById.get(n.id);
        if (seed) {
          // computeFlowLayout は中心座標 → 左上に補正
          map.set(n.id, {
            x: seed.x - seed.width / 2,
            y: seed.y - seed.height / 2,
          });
        } else {
          map.set(n.id, { x: 0, y: 0 });
        }
      } else {
        map.set(n.id, { x: n.positionX, y: n.positionY });
      }
    }
    return map;
  }, [flowData.nodes, tidyLayout]);

  // --- 背景レーン帯（ノードに追従して自動サイズ + 手動オーバーライド） ---
  const bands = useMemo(() => {
    const bandNodes: BandInputNode[] = flowData.nodes.map((n) => {
      const pos = effectivePositions.get(n.id) ?? { x: 0, y: 0 };
      return {
        id: n.id,
        roleId: n.roleId ?? n.role?.id ?? null,
        // computeLaneBands は中心座標を取る → 左上 + 半サイズ
        x: pos.x + NODE_W / 2,
        y: pos.y + NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
      };
    });
    return computeLaneBands(bandNodes, laneRoles, orientation, {
      laneHeightOverrides,
    });
  }, [flowData.nodes, effectivePositions, laneRoles, orientation, laneHeightOverrides]);

  // --- レーン境界ハンドルのドラッグ: レーン厚を手動リサイズ ---
  // 横帯=下端を下げると高さ↑ / 縦列=右端を右へ動かすと幅↑。
  // 画面ピクセル差をズームで割って flow 座標の差に変換し、ローカル先取り表示。
  // pointerup でサーバ永続化（onUpdateLaneHeight）。
  const handleLaneResizeStart = useCallback(
    (roleId: string, e: ReactPointerEvent) => {
      const lane = bands.lanes.find((l) => l.roleId === roleId);
      if (!lane) return;
      const MIN_LANE_THICKNESS = 60;
      const startThickness = isVertical ? lane.width ?? 0 : lane.height;
      const startClient = isVertical ? e.clientX : e.clientY;
      const zoom = getViewport().zoom || 1;

      const computeNext = (client: number) =>
        Math.max(
          MIN_LANE_THICKNESS,
          Math.round(startThickness + (client - startClient) / zoom),
        );

      const onMove = (ev: PointerEvent) => {
        const next = computeNext(isVertical ? ev.clientX : ev.clientY);
        setLocalLaneHeights((prev) => ({ ...prev, [roleId]: next }));
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const next = computeNext(isVertical ? ev.clientX : ev.clientY);
        // ローカル先取りはサーバ再取得（flowData.laneHeights）が反映されるまで残す。
        setLocalLaneHeights((prev) => ({ ...prev, [roleId]: next }));
        props.onUpdateLaneHeight?.(roleId, next);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [bands, isVertical, getViewport, props],
  );

  // --- React Flow ノード（背景レーン + コンテンツ） ---
  const rfNodes: Node[] = useMemo(() => {
    const laneNodes: Node[] = bands.lanes.map((lane) => {
      // 実ロールのみリサイズ可（未割当レーンは不可）。永続化ハンドラが無ければ無効。
      const resizable =
        !!props.onUpdateLaneHeight && roles.some((r) => r.id === lane.roleId);
      const laneData: LaneNodeData = {
        name: lane.name,
        color: lane.color,
        orientation,
        roleId: lane.roleId,
        resizable,
        onResizeStart: handleLaneResizeStart,
      };
      if (isVertical) {
        const left = lane.left ?? 0;
        const width = lane.width ?? 0;
        // 縦列はラベル帯ぶん上に伸ばし、時間軸（縦）方向に全長
        return {
          id: `lane-${lane.roleId}`,
          type: 'lane',
          position: { x: left, y: -LANE_LABEL_W },
          data: laneData,
          draggable: false,
          selectable: false,
          zIndex: 0,
          width,
          height: LANE_LABEL_W + bands.height + 80,
          style: { width, height: LANE_LABEL_W + bands.height + 80 },
        } as Node;
      }
      return {
        id: `lane-${lane.roleId}`,
        type: 'lane',
        position: { x: -LANE_LABEL_W, y: lane.top },
        data: laneData,
        draggable: false,
        selectable: false,
        zIndex: 0,
        width: LANE_LABEL_W + bands.width + 80,
        height: lane.height,
        style: { width: LANE_LABEL_W + bands.width + 80, height: lane.height },
      } as Node;
    });

    const contentNodes: Node[] = flowData.nodes.map((src) => {
      const pos = effectivePositions.get(src.id) ?? { x: 0, y: 0 };
      return {
        id: src.id,
        type: 'content',
        // 自由配置: 保存済み（またはシード）左上座標にそのまま置く
        position: { x: pos.x, y: pos.y },
        data: {
          label: src.label,
          ntype: src.type,
          hasChildFlow: src.hasChildFlow || !!src.childFlowId,
          hasLinks: (src.links?.length ?? 0) > 0,
          roleColor: src.role?.color,
          orientation,
        } as ContentNodeData,
        width: NODE_W,
        height: NODE_H,
        style: { width: NODE_W, height: NODE_H },
        draggable: true,
        zIndex: 1,
      } as Node;
    });

    return [...laneNodes, ...contentNodes];
  }, [
    bands,
    flowData.nodes,
    effectivePositions,
    orientation,
    isVertical,
    roles,
    handleLaneResizeStart,
    props.onUpdateLaneHeight,
  ]);

  // React Flow は制御モードでは onNodesChange が無いとドラッグで位置が動かない。
  // 決定的レイアウト(rfNodes)を初期値にした内部 state を持ち、ドラッグ中の位置変更を
  // 反映させる。レイアウトが再計算されたら(rfNodes が変わったら)正規位置へ同期し直す。
  const [dragNodes, setDragNodes, onNodesChange] = useNodesState(rfNodes);
  useEffect(() => {
    setDragNodes(rfNodes);
  }, [rfNodes, setDragNodes]);

  const rfEdges: Edge[] = useMemo(
    () =>
      flowData.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
        // 保存された接続側（辺）を描画に反映する。未保存(null/undefined)なら
        // React Flow が向き既定（Loose）でハンドルを自動選択する。
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        label: e.label || e.condition || undefined,
        type: 'editable',
        selected: e.id === selectedEdgeId,
        // 端点ドラッグで付け替え可能にする（onReconnect が発火する）。
        reconnectable: !!props.onReconnectEdge,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 18, height: 18 },
        data: {
          onLabelUpdate: props.onUpdateEdgeLabel,
          onInsertNode: props.onInsertNodeOnEdge,
          informationTypeName: e.informationType?.name ?? null,
        },
      })),
    [
      flowData.edges,
      selectedEdgeId,
      props.onUpdateEdgeLabel,
      props.onInsertNodeOnEdge,
      props.onReconnectEdge,
    ],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitView, flowData.id, orientation]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) {
        // ドラッグで使った辺（ハンドル）を保存する。
        props.onConnectNodes?.(c.source, c.target, {
          sourceHandle: c.sourceHandle ?? null,
          targetHandle: c.targetHandle ?? null,
        });
      }
    },
    [props],
  );

  // --- エッジ端点ドラッグで付け替え（再ルーティング） ---
  // React Flow v12 の onReconnect(oldEdge, newConnection)。
  // 新しい source/target ノードとハンドル側を PATCH で永続化する（呼び出し側に委譲）。
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!newConnection.source || !newConnection.target) return;
      if (newConnection.source === newConnection.target) return;
      props.onReconnectEdge?.(oldEdge.id, {
        sourceNodeId: newConnection.source,
        targetNodeId: newConnection.target,
        sourceHandle: newConnection.sourceHandle ?? null,
        targetHandle: newConnection.targetHandle ?? null,
      });
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

  // --- ドラッグ停止: 自由配置座標を保存 + ドロップ先レーンへロール再割当 ---
  // 旧実装は order/roleId だけ保存していたため位置がスナップバックしていた。
  // 新実装はドロップした左上座標を positionX/positionY としてそのまま保存する。
  const handleNodeDragStop = useCallback(
    (_evt: unknown, node: Node) => {
      if (node.type !== 'content') return;

      const w = node.width ?? NODE_W;
      const h = node.height ?? NODE_H;
      // ドロップした左上座標（= サーバ保存値）と中心座標
      const left = node.position.x;
      const top = node.position.y;
      const centerX = left + w / 2;
      const centerY = top + h / 2;

      const patch: NodeUpdatePatch = {
        positionX: left,
        positionY: top,
      };

      // レーン（ロール）判定 — ドロップ位置が含まれる帯を探す。
      // horizontal は Y で帯[top, top+height]、vertical は X で列[left, left+width]。
      // 帯の外（上端より上 / 下端より下）に落ちた場合は最近傍の帯にスナップする。
      const src = flowData.nodes.find((n) => n.id === node.id);
      const currentRoleId = src?.roleId ?? src?.role?.id ?? null;

      if (bands.lanes.length > 0) {
        const cross = isVertical ? centerX : centerY;
        let hit = bands.lanes.find((lane) => {
          const start = isVertical ? lane.left ?? 0 : lane.top;
          const size = isVertical ? lane.width ?? 0 : lane.height;
          return cross >= start && cross <= start + size;
        });
        if (!hit) {
          // どの帯にも入っていなければ最近傍の帯中心へ
          let best = bands.lanes[0];
          let bestDist = Infinity;
          for (const lane of bands.lanes) {
            const center = isVertical
              ? lane.centerX ?? (lane.left ?? 0) + (lane.width ?? 0) / 2
              : lane.centerY;
            const d = Math.abs(cross - center);
            if (d < bestDist) {
              bestDist = d;
              best = lane;
            }
          }
          hit = best;
        }
        // 未割当レーンは roleId を持たない（割当解除はここではしない）ので、
        // 実ロールの帯に落ちた場合のみロール変更を保存する。
        const isRealRole = roles.some((r) => r.id === hit!.roleId);
        if (isRealRole && hit!.roleId !== currentRoleId) {
          patch.roleId = hit!.roleId;
        }
      }

      props.onUpdateNode?.(node.id, patch);
      // ローカル位置はドラッグ済みの座標のまま。保存後の再取得で同座標に戻るため
      // スナップバックは起きない。
    },
    [bands, isVertical, roles, flowData.nodes, props],
  );

  // --- 「整形」: computeFlowLayout で綺麗な座標を作り、一括保存して再取得 ---
  // ぐちゃぐちゃになった自由配置を、ロール×order の決定的レイアウトへ戻す安全網。
  const handleTidy = useCallback(() => {
    setMenu(null);
    const positions: NodePositionPatch[] = tidyLayout.nodes.map((pn) => ({
      id: pn.id,
      // computeFlowLayout は中心座標 → サーバ保存は左上基準
      positionX: pn.x - pn.width / 2,
      positionY: pn.y - pn.height / 2,
      // 未割当レーンの roleId はノードへ書き戻さない（null のまま）
      roleId: roles.some((r) => r.id === pn.roleId) ? pn.roleId : null,
      order: typeof pn.order === 'number' ? pn.order : undefined,
    }));
    void props.onTidyNodes?.(positions);
  }, [tidyLayout, roles, props]);

  return (
    <div ref={wrapperRef} className="relative w-full h-full bg-white">
      <ReactFlow
        nodes={dragNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onNodesChange={onNodesChange}
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

        {/* ツールバー（右上）: 整形 + 縦横トグル + PNG出力 */}
        <Panel position="top-right" className="bg-white border border-gray-200 rounded-lg shadow-sm p-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTidy}
              disabled={!props.onTidyNodes || flowData.nodes.length === 0}
              className="text-gray-700"
              title="ぐちゃぐちゃな配置を、ロール×順序の綺麗なレイアウトに自動整列して保存します"
            >
              <LayoutGrid className="w-4 h-4 mr-1" />
              整形
            </Button>
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
          informationTypes={props.informationTypes ?? []}
          onSaveNodeInformationLinks={props.onSaveNodeInformationLinks}
        />
      )}

      {/* エッジ編集パネル（矢印が選択されている間） */}
      {selectedEdgeId && (() => {
        const edge = flowData.edges.find((e) => e.id === selectedEdgeId);
        if (!edge) return null;
        return (
          <EdgePropertyPanel
            key={selectedEdgeId}
            edge={edge}
            informationTypes={props.informationTypes ?? []}
            sourceLabel={flowData.nodes.find((n) => n.id === edge.sourceNodeId)?.label}
            targetLabel={flowData.nodes.find((n) => n.id === edge.targetNodeId)?.label}
            onClose={() => setSelectedEdgeId(null)}
            onUpdateEdge={props.onUpdateEdge}
            onReverse={
              props.onReconnectEdge
                ? () =>
                    props.onReconnectEdge?.(edge.id, {
                      // source/target を入れ替え。接続側ハンドルも入れ替えて見た目を維持する。
                      sourceNodeId: edge.targetNodeId,
                      targetNodeId: edge.sourceNodeId,
                      sourceHandle: edge.targetHandle ?? null,
                      targetHandle: edge.sourceHandle ?? null,
                    })
                : undefined
            }
          />
        );
      })()}

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
        💡 ノードは自由にドラッグして配置（位置は保存されます）｜ 別レーンへ落とすとロール変更 ｜ 乱れたら「整形」で自動整列 ｜ クリックで編集 ｜ ハンドルで接続 ｜ 接続線の「＋」で途中にノード挿入 ｜ レーン境界をドラッグで高さ調整 ｜ 右クリックで追加/削除
      </div>
    </div>
  );
}

// ===========================================
// ノードプロパティ右サイドバー
// ===========================================

function readNodeFields(node: FlowDataNode | null): {
  processingTime: string;
  handledCount: string;
  supplement: string;
} {
  const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    processingTime: s(node?.processingTime),
    handledCount: s(node?.handledCount),
    supplement: s(node?.supplement),
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

// ===========================================
// 情報種別マスタからの INPUT/OUTPUT 多選択（チェックボックスリスト）
// 選択した順に order を割り当てる（選択 = 末尾追加、解除 = 取り除き）。
// ===========================================

const CATEGORY_BADGE_STYLE: Record<InformationCategory, string> = {
  INFORMATION: 'bg-sky-50 text-sky-700 border-sky-200',
  OBJECT: 'bg-amber-50 text-amber-700 border-amber-200',
  DOCUMENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function InformationTypeMultiSelect({
  title,
  informationTypes,
  selectedIds,
  onChange,
}: {
  title: string;
  informationTypes: InformationType[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (selected.has(id)) return;
      onChange([...selectedIds, id]);
    } else {
      onChange(selectedIds.filter((x) => x !== id));
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-[11px] font-medium text-gray-500">{title}</label>
        <span className="text-[11px] text-gray-400">{selectedIds.length} 種類</span>
      </div>
      {informationTypes.length === 0 ? (
        <p className="text-[11px] text-gray-400 px-1 py-1.5">
          情報種別マスタが空です。参考マスタで情報種別を登録してください。
        </p>
      ) : (
        <div className="max-h-44 overflow-auto rounded border border-gray-300 divide-y divide-gray-100">
          {informationTypes.map((it) => {
            const checked = selected.has(it.id);
            const badgeCls =
              CATEGORY_BADGE_STYLE[it.category] ?? CATEGORY_BADGE_STYLE.INFORMATION;
            return (
              <label
                key={it.id}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(it.id, e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="flex-1 truncate text-sm text-gray-800">{it.name}</span>
                <span
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${badgeCls}`}
                >
                  {INFORMATION_CATEGORY_LABELS[it.category]}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===========================================
// エッジ（矢印）の編集パネル（右サイドバー）
// 矢印が運ぶ情報種別（source の OUTPUT → target の INPUT）とラベルを編集し、
// 向きの反転（source/target スワップ）を行う。
// ===========================================

function EdgePropertyPanel({
  edge,
  informationTypes,
  sourceLabel,
  targetLabel,
  onClose,
  onUpdateEdge,
  onReverse,
}: {
  edge: FlowDataEdge;
  informationTypes: InformationType[];
  sourceLabel?: string;
  targetLabel?: string;
  onClose: () => void;
  onUpdateEdge?: (
    edgeId: string,
    patch: { informationTypeId?: string | null; label?: string },
  ) => Promise<void> | void;
  onReverse?: () => void;
}) {
  const [informationTypeId, setInformationTypeId] = useState<string>(
    edge.informationTypeId ?? '',
  );
  const [label, setLabel] = useState<string>(edge.label ?? '');

  const initialInfoId = edge.informationTypeId ?? '';
  const initialLabel = edge.label ?? '';

  // 情報種別 / ラベルが初期値から変わったぶんだけ送る（informationTypeId は '' → null）。
  const save = useCallback(() => {
    if (!onUpdateEdge) return;
    const patch: { informationTypeId?: string | null; label?: string } = {};
    if (informationTypeId !== initialInfoId) {
      patch.informationTypeId = informationTypeId === '' ? null : informationTypeId;
    }
    if (label !== initialLabel) patch.label = label;
    if (patch.informationTypeId === undefined && patch.label === undefined) return;
    void onUpdateEdge(edge.id, patch);
  }, [onUpdateEdge, edge.id, informationTypeId, label, initialInfoId, initialLabel]);

  return (
    <div className="absolute top-0 right-0 h-full w-full sm:w-80 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col animate-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">矢印のプロパティ</h3>
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
        {/* 向き（source → target）の表示 */}
        <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <div className="flex items-center gap-1.5">
            <span className="max-w-[100px] truncate font-medium text-gray-800" title={sourceLabel}>
              {sourceLabel ?? '?'}
            </span>
            <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" />
            <span className="max-w-[100px] truncate font-medium text-gray-800" title={targetLabel}>
              {targetLabel ?? '?'}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-gray-400">
            運ぶ情報は、起点ノードの OUTPUT・終点ノードの INPUT になります。
          </p>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">
            運ぶ情報（情報種別）
          </label>
          <select
            value={informationTypeId}
            onChange={(e) => setInformationTypeId(e.target.value)}
            onBlur={save}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">（未設定）</option>
            {informationTypes.map((it) => (
              <option key={it.id} value={it.id}>
                {it.name}（{INFORMATION_CATEGORY_LABELS[it.category]}）
              </option>
            ))}
          </select>
          {informationTypes.length === 0 && (
            <p className="mt-1 text-[11px] text-gray-400">
              情報種別マスタが空です。参考マスタで情報種別を登録してください。
            </p>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ラベル</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={save}
            placeholder="例: 承認後"
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {onReverse && (
          <button
            type="button"
            onClick={() => {
              onReverse();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            title="矢印の向き（起点と終点）を入れ替えます"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            向きを反転
          </button>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-600">
          閉じる
        </Button>
        <Button
          size="sm"
          onClick={() => {
            save();
            onClose();
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          保存
        </Button>
      </div>
    </div>
  );
}

function NodePropertyPanel({
  node,
  roles,
  currentFlowId,
  otherFlows,
  informationTypes,
  onClose,
  onUpdateNode,
  onSaveNodeInformationLinks,
  onFetchNodeLinks,
  onCreateNodeLink,
  onDeleteNodeLink,
  onFetchFlowNodes,
}: {
  node: FlowDataNode | null;
  roles: Role[];
  currentFlowId: string;
  otherFlows: FlowSummary[];
  informationTypes: InformationType[];
  onClose: () => void;
  onUpdateNode?: (nodeId: string, patch: NodeUpdatePatch) => void;
  onSaveNodeInformationLinks?: (
    nodeId: string,
    links: Array<{ informationTypeId: string; direction: FlowLinkDirection; order?: number }>,
  ) => Promise<void> | void;
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
  const initFields = readNodeFields(node);
  const [processingTime, setProcessingTime] = useState(initFields.processingTime);
  const [handledCount, setHandledCount] = useState(initFields.handledCount);
  const [supplement, setSupplement] = useState(initFields.supplement);

  // INPUT/OUTPUT は情報種別マスタからの多選択。node.informationLinks から初期化し、
  // 選択中の informationTypeId 集合を direction ごとに保持する（order は配列順）。
  const initialInputIds = useMemo(
    () =>
      (node?.informationLinks ?? [])
        .filter((l) => l.direction === 'INPUT')
        .sort((a, b) => a.order - b.order)
        .map((l) => l.informationTypeId),
    [node],
  );
  const initialOutputIds = useMemo(
    () =>
      (node?.informationLinks ?? [])
        .filter((l) => l.direction === 'OUTPUT')
        .sort((a, b) => a.order - b.order)
        .map((l) => l.informationTypeId),
    [node],
  );
  const [inputIds, setInputIds] = useState<string[]>(initialInputIds);
  const [outputIds, setOutputIds] = useState<string[]>(initialOutputIds);

  // 情報種別リンクが初期値から変化したか（変化時のみ保存して再取得を抑える）
  const sameIds = (a: string[], b: string[]) =>
    a.length === b.length && a.every((id, i) => id === b[i]);

  const save = useCallback(() => {
    if (!node) return;
    const patch: NodeUpdatePatch = {
      processingTime,
      handledCount,
      supplement,
    };
    if (label !== node.label) patch.label = label;
    if (type !== node.type) patch.type = type;
    const currentRole = node.roleId ?? node.role?.id ?? '';
    if (roleId && roleId !== currentRole) patch.roleId = roleId;
    onUpdateNode?.(node.id, patch);

    // INPUT/OUTPUT（情報種別リンク）は専用エンドポイントで replace-all 保存
    if (
      onSaveNodeInformationLinks &&
      (!sameIds(inputIds, initialInputIds) || !sameIds(outputIds, initialOutputIds))
    ) {
      const links = [
        ...inputIds.map((informationTypeId, i) => ({
          informationTypeId,
          direction: 'INPUT' as FlowLinkDirection,
          order: i,
        })),
        ...outputIds.map((informationTypeId, i) => ({
          informationTypeId,
          direction: 'OUTPUT' as FlowLinkDirection,
          order: i,
        })),
      ];
      void onSaveNodeInformationLinks(node.id, links);
    }
  }, [
    node,
    label,
    type,
    roleId,
    processingTime,
    handledCount,
    supplement,
    inputIds,
    outputIds,
    initialInputIds,
    initialOutputIds,
    onUpdateNode,
    onSaveNodeInformationLinks,
  ]);

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
            value={processingTime}
            onChange={(e) => setProcessingTime(e.target.value)}
            onBlur={save}
            placeholder="例: 約10分"
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        <InformationTypeMultiSelect
          title="INPUT（受け取る情報）"
          informationTypes={informationTypes}
          selectedIds={inputIds}
          onChange={setInputIds}
        />

        <InformationTypeMultiSelect
          title="OUTPUT（渡す情報）"
          informationTypes={informationTypes}
          selectedIds={outputIds}
          onChange={setOutputIds}
        />

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">今回の対応数</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={handledCount}
              onChange={(e) => setHandledCount(e.target.value)}
              onBlur={save}
              placeholder="例: 120"
              className="w-28 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="text-[11px] text-gray-400">件（今回処理した件数）</span>
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">補足</label>
          <textarea
            value={supplement}
            onChange={(e) => setSupplement(e.target.value)}
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
