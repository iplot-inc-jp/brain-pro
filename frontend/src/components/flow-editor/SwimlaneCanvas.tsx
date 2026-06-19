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
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type DragEvent as ReactDragEvent,
  type MutableRefObject,
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
  NodeResizer,
  NodeToolbar,
  getSmoothStepPath,
  getBezierPath,
  getStraightPath,
  useReactFlow,
  useNodesState,
  ConnectionMode,
  SelectionMode,
  type Node,
  type Edge,
  type EdgeProps,
  type Connection,
  type ConnectionLineComponentProps,
  type OnConnectStartParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import {
  ChevronLeft,
  Layers,
  Plus,
  Trash2,
  GitBranch,
  Cpu,
  Users,
  User,
  Server,
  Circle,
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
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
  StickyNote,
  MessageSquarePlus,
  GripVertical,
  Pencil,
  Check,
  Star,
  Flag,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Heart,
  ThumbsUp,
  Bell,
  Bookmark,
  Target,
  Lightbulb,
  Ban,
  Smile,
  MousePointer2,
  Hand,
  BoxSelect,
  Plug,
  Search,
  Paperclip,
  type LucideIcon,
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
  FlowAnnotation,
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
  INFORMATION_CATEGORY_OPTIONS,
  type InformationCategory,
  type InformationType,
} from '@/lib/dfd';
import type { SystemMaster } from '@/lib/masters';
import {
  diagramElementApi,
  type DiagramElementDto,
  type DiagramElementRestoreInput,
  type DiagramElementOp,
} from '@/lib/diagram-elements';
import { useImageOpLog, type ImageUndoApi } from '@/hooks/use-image-op-log';
import { transposeFreeElement } from './flow-lane-transpose';
import { nodeAttachmentApi } from '@/lib/node-attachments';
import { uploadProjectFile } from '@/lib/upload';
import { ImageElementNode } from '@/components/diagram/ImageElementNode';
import { NodeInspectorPanel } from '@/components/diagram/NodeInspectorPanel';
import { firstImageFile } from '@/components/diagram/diagram-drop';

const LANE_LABEL_W = 132;

export type FlowOrientation = 'horizontal' | 'vertical';

/** ロールの人/システム区分（@/lib/api の RoleType と同値）。 */
export type RoleType = 'HUMAN' | 'SYSTEM' | 'OTHER';

/**
 * 矢印に紐づけられる API エンドポイントの選択肢（@/lib/api の ApiEndpointItem と互換）。
 * コンポーネントを lib/api に依存させないため、必要なフィールドだけ局所定義する。
 */
export type ApiEndpointOption = {
  id: string;
  method: string;
  path: string;
  summary?: string | null;
};

/** ロール種別 → レーンヘッダーに出すアイコン（人/システム/中立）。 */
function roleTypeIcon(type: string | undefined): typeof User {
  if (type === 'SYSTEM') return Server;
  if (type === 'OTHER') return Circle;
  // 既定（未設定含む）は「人」扱い
  return User;
}

/** ノード更新の差分パッチ。プロパティ保存・ドラッグでの自由配置保存の双方で使う。 */
export interface NodeUpdatePatch {
  label?: string;
  type?: string;
  roleId?: string;
  order?: number;
  /** 自由配置の保存座標（ノード左上ではなく中心ではなく、サーバ保存値=左上基準）。 */
  positionX?: number;
  positionY?: number;
  /** 手動リサイズ後の描画幅（実カラム）。未指定なら既定 NODE_W で描画。 */
  width?: number;
  /** 手動リサイズ後の描画高さ（実カラム）。未指定なら既定 NODE_H で描画。 */
  height?: number;
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

/**
 * 整形が算出した 1 エッジ分の最近接サイド接続ハンドル。
 * `PUT /:flowId/nodes/positions` の edges[] に対応（位置保存と同一リクエストで送る）。
 */
export interface EdgeHandlePatch {
  id: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
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
  /** 画像Undo(op-log)の操作可否が変わるたびに親へ通知（ツールバー活性/⌘Z のチャンネル統合用）。 */
  onImageUndoStateChange?: (s: { canUndo: boolean; canRedo: boolean }) => void;
  /** 親が ⌘Z ルーターから画像Undoの undo/redo/peek を呼ぶための命令的ハンドル。 */
  imageUndoApiRef?: MutableRefObject<ImageUndoApi | null>;
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
  /**
   * ハンドルから空き場所（pane）にドロップしたとき、新ノードを生成して
   * 開始ノード → 新ノード を接続する（Whimsical風）。
   * - position: ドロップ先の flow 座標（ノード左上として保存される）
   * - roleId: 開始ノードと同じロール（レーン）
   * - sourceHandle/targetHandle: 開始ハンドル側 → その反対側で接続
   * 呼び出し側（ページ）は POST /:flowId/nodes（位置・ロール指定）→ POST /:flowId/edges
   * を順に叩いて生成＋接続する。schema/endpoint は不変。
   */
  onCreateConnectedNode?: (input: {
    sourceNodeId: string;
    sourceHandle: string;
    targetHandle: string;
    position: { x: number; y: number };
    roleId?: string;
  }) => void;
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
    patch: {
      informationTypeId?: string | null;
      label?: string;
      pathStyle?: string | null;
      labelT?: number | null;
      infoT?: number | null;
    },
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
  /**
   * フロー途中でロール（スイムレーン）を新規追加する。
   * 名前と人/システム区分（HUMAN|SYSTEM|OTHER）を受け取り、呼び出し側（ページ）が
   * rolesApi.create → ロール一覧再取得で roles prop を更新する。
   */
  onAddRole?: (name: string, type: RoleType) => Promise<void>;
  /**
   * 既存ロール（スイムレーン）を更新する。ロールチップ／レーンヘッダーの編集パネルから呼ぶ。
   * 名前・人/システム/その他 区分・SYSTEM のとき紐づくシステム・色を部分更新する。
   * 呼び出し側（ページ）が PATCH /api/roles/:id → ロール一覧再取得で roles prop を更新する。
   */
  onUpdateRole?: (
    roleId: string,
    patch: { name?: string; type?: RoleType; systemId?: string | null; color?: string },
  ) => Promise<void>;
  /**
   * ロール（スイムレーン）を削除する。編集パネルの削除ボタンから呼ぶ。
   * 呼び出し側（ページ）が DELETE /api/roles/:id → ロール一覧再取得で roles prop を更新する。
   */
  onDeleteRole?: (roleId: string) => Promise<void>;
  /**
   * プロジェクトのシステムマスタ一覧。ロールの type==='SYSTEM' のとき
   * 紐づけるシステムの選択肢として使う（編集パネルの system セレクト）。
   */
  systems?: SystemMaster[];
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
   * 情報種別マスタにその場で新規追加する（INPUT/OUTPUT 多選択・矢印が運ぶ情報の選択肢用）。
   * マスタが空でも操作を止めないため、各パネルから直接登録できる。成功で作成された情報種別を返す。
   * 呼び出し側（ページ）が informationTypeApi.create + 一覧再取得で informationTypes を更新する。
   */
  onCreateInformationType?: (input: {
    name: string;
    category: InformationCategory;
  }) => Promise<InformationType | null>;
  /**
   * ノードのプロパティ保存 / ドラッグでの自由配置保存・レーン移動で呼ばれる。
   * - 右サイドバー保存: { label?, type?, roleId?, metadata? }
   * - ドラッグ停止: { positionX, positionY, roleId? }（別レーンに落ちた場合のみ roleId を含む）
   */
  onUpdateNode?: (nodeId: string, patch: NodeUpdatePatch) => void;
  /**
   * 「整形」: 全ノードの位置/ロール/順序を一括保存する（`PUT /:flowId/nodes/positions`）。
   * computeFlowLayout で算出した綺麗な座標を渡し、呼び出し側が永続化→再取得する。
   * edges には整形後の最近接サイド接続ハンドル（任意）を渡し、同一リクエストで
   * 各エッジの sourceHandle/targetHandle も更新する。
   */
  onTidyNodes?: (
    positions: NodePositionPatch[],
    edges?: EdgeHandlePatch[],
  ) => Promise<void> | void;
  /**
   * スイムレーン（ロール）の手動リサイズ後の高さを永続化する。
   * レーン背景の下端ハンドルをドラッグすると呼ばれる（roleId, 新しい厚み）。
   * ページ側は PUT /api/business-flows/:flowId { laneHeights } で保存する。
   */
  onUpdateLaneHeight?: (roleId: string, height: number) => void;
  // --- Undo/Redo（スナップショット型。補助ツールバーボタン） ---
  /** Undo（⌘Z 相当）。端では canUndo=false。 */
  onUndo?: () => void;
  /** Redo（⌘⇧Z / ⌘Y 相当）。端では canRedo=false。 */
  onRedo?: () => void;
  /** これ以上戻れる履歴があるか（ボタン disabled 制御）。 */
  canUndo?: boolean;
  /** これ以上進める履歴があるか（ボタン disabled 制御）。 */
  canRedo?: boolean;
  // --- 注釈（付箋・コメント）。flowData.nodes/edges とは別系統。 ---
  /**
   * フロー図に貼る注釈一覧（付箋・コメント）。整形/縦横転置/Undo-Redo の対象外。
   * flow ノードとは別の専用ノード（type:'annotation'）として描画する。
   */
  annotations?: FlowAnnotation[];
  /**
   * 注釈を新規追加する（付箋 / コメント / アイコン）。位置はビュー中央付近を渡す。
   * kind==='ICON' のときは init.icon に lucide アイコン名（ICON_PALETTE のいずれか）を含める。
   */
  onAddAnnotation?: (
    kind: FlowAnnotation['kind'],
    init?: { positionX: number; positionY: number; icon?: string },
  ) => void;
  /** 注釈の本文・位置・アイコンを部分更新する（本文編集の onBlur / ドラッグ停止）。 */
  onUpdateAnnotation?: (
    id: string,
    patch: {
      text?: string;
      positionX?: number;
      positionY?: number;
      width?: number;
      height?: number;
      color?: string | null;
      icon?: string | null;
      /** kind==='SCOPE' の枠線スタイル（点線/実線）。 */
      borderStyle?: 'dashed' | 'solid';
      /** kind==='SCOPE' の背景塗り不透明度（0〜1）。 */
      fillOpacity?: number;
    },
  ) => void;
  /** 注釈を削除する（ホバー時の ✕）。 */
  onDeleteAnnotation?: (id: string) => void;
  // --- 矢印 × API エンドポイント紐づけ ---
  /**
   * プロジェクトの API エンドポイント一覧（コードカタログで抽出済みのもの）。
   * エッジ編集パネルの「API」セクションの選択肢として使う。
   */
  apiEndpoints?: ApiEndpointOption[];
  /**
   * 矢印に紐づく API エンドポイントを全置換保存する。
   * ページ側が PUT /flow-edges/:id/api-links（updateEdgeApiLinks）で永続化し、
   * flowData.edges[].apiLinks を更新する。
   */
  onSaveEdgeApiLinks?: (edgeId: string, apiEndpointIds: string[]) => Promise<void> | void;
  /**
   * 比較ビュー等で、自前のツールバー（右上）/全画面ボタン/IO候補パネル（左サイド）/
   * 左上パンくずバッジを隠す閲覧用埋め込みモード。
   * true のとき編集系UIを描画しない（MiniMap/Controls/ロール編集パネルは従来どおり）。
   */
  embedded?: boolean;
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

/** 整形後の各エッジの最近接サイド接続ハンドル（source/target の辺）。 */
interface PositionedEdgeGeom {
  id: string;
  sourceHandle: string;
  targetHandle: string;
}

interface FlowLayoutView {
  nodes: PositionedNodeGeom[];
  lanes: LaneGeom[];
  /** 整形後の各エッジの最近接サイド接続ハンドル。整形時に sourceHandle/targetHandle 永続化に使う。 */
  edges: PositionedEdgeGeom[];
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
  /** リサイズ確定時に呼ぶ（width/height を永続化）。embedded（閲覧）では未設定。 */
  onResizeEnd?: (id: string, size: { width: number; height: number }) => void;
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

function ContentNode({ id, data, selected }: { id: string; data: ContentNodeData; selected?: boolean }) {
  const cls = NODE_STYLE[data.ntype] ?? NODE_STYLE.PROCESS;
  return (
    <div
      className={`group/node px-3 py-2 rounded-lg border-2 shadow-sm w-full h-full flex flex-col items-center justify-center text-center transition-all ${cls} ${
        selected ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      }`}
    >
      {/* マウスリサイズ（選択時のみハンドル表示。embedded=閲覧では onResizeEnd 未設定＝非表示）。
          確定(onResizeEnd)で width/height を親へ渡し永続化する。アスペクト比固定なし。 */}
      {data.onResizeEnd && (
        <NodeResizer
          minWidth={120}
          minHeight={40}
          isVisible={!!selected}
          keepAspectRatio={false}
          onResizeEnd={(_, params) =>
            data.onResizeEnd?.(id, {
              width: Math.round(params.width),
              height: Math.round(params.height),
            })
          }
        />
      )}
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

/** リサイズハンドルが掴むレーン境界。横帯=上端/下端、縦列=左端/右端。 */
type LaneResizeEdge = 'top' | 'bottom' | 'left' | 'right';

type LaneNodeData = {
  name: string;
  color?: string;
  orientation: FlowOrientation;
  roleId: string;
  /** ロールの人/システム区分。ラベル左のアイコン分岐に使う（未割当レーンは undefined）。 */
  roleType?: string;
  /** リサイズ可能か（実ロールのみ。未割当レーンは不可）。 */
  resizable?: boolean;
  /** 手前側（上端/左端）ハンドルを出すか。先頭レーンは前レーンが無いので出さない。 */
  showStartHandle?: boolean;
  /**
   * リサイズハンドルの pointerDown。canvas 側がドラッグを引き受ける。
   * edge はドラッグした境界（横帯=top|bottom、縦列=left|right）。
   * 上端/左端は下端/右端と逆方向のデルタで厚みを更新する。
   */
  onResizeStart?: (roleId: string, edge: LaneResizeEdge, e: ReactPointerEvent) => void;
  /**
   * レーンヘッダー（ラベル帯）クリックでロール編集を開く（任意）。
   * 渡された時だけラベルがクリック可能になり、roleId を親へ上げる。
   */
  onLaneClick?: (roleId: string) => void;
};

function LaneNode({ data }: { data: LaneNodeData }) {
  const color = data.color ?? '#94a3b8';
  const isVertical = data.orientation === 'vertical';
  // ロール種別に応じた人/システム/中立アイコン（ラベル左）。
  const RoleIcon = roleTypeIcon(data.roleType);
  // レーンヘッダークリックでロール編集を開けるか（onLaneClick あり）。
  const labelClickable = !!data.onLaneClick;
  const onLabelClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    data.onLaneClick?.(data.roleId);
  };

  // レーン境界のリサイズハンドルを両端に出す。横帯=上端と下端、縦列=左端と右端。
  // 親（lane 背景）は pointer-events-none なので、ハンドルだけ pointer-events-auto。
  const makeHandle = (edge: LaneResizeEdge) => (
    <div
      key={edge}
      role="separator"
      aria-orientation={isVertical ? 'vertical' : 'horizontal'}
      title="ドラッグでレーンの幅を調整"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        data.onResizeStart?.(data.roleId, edge, e);
      }}
      className={`nodrag nopan pointer-events-auto absolute z-10 group ${
        edge === 'top'
          ? 'left-0 top-0 w-full h-2 cursor-row-resize'
          : edge === 'bottom'
          ? 'left-0 bottom-0 w-full h-2 cursor-row-resize'
          : edge === 'left'
          ? 'left-0 top-0 h-full w-2 cursor-col-resize'
          : 'top-0 right-0 h-full w-2 cursor-col-resize'
      }`}
    >
      <div
        className={`opacity-0 group-hover:opacity-100 transition-opacity ${
          edge === 'top'
            ? 'absolute top-0 left-0 w-full h-1'
            : edge === 'bottom'
            ? 'absolute bottom-0 left-0 w-full h-1'
            : edge === 'left'
            ? 'absolute left-0 top-0 h-full w-1'
            : 'absolute right-0 top-0 h-full w-1'
        }`}
        style={{ backgroundColor: color }}
      />
    </div>
  );
  const handles =
    data.resizable && data.onResizeStart
      ? isVertical
        ? [data.showStartHandle ? makeHandle('left') : null, makeHandle('right')]
        : [data.showStartHandle ? makeHandle('top') : null, makeHandle('bottom')]
      : null;

  if (isVertical) {
    // 縦列: ラベルは列の上端、帯は右境界に縦線
    return (
      <div
        className="w-full h-full pointer-events-none"
        style={{ backgroundColor: `${color}0d`, borderRight: `2px solid ${color}33` }}
      >
        <div
          onClick={labelClickable ? onLabelClick : undefined}
          title={labelClickable ? `${data.name}（クリックで編集）` : undefined}
          className={`absolute left-0 top-0 w-full flex items-center justify-center gap-1 text-xs font-medium px-2 text-center border-b ${
            labelClickable ? 'nodrag nopan cursor-pointer pointer-events-auto hover:brightness-95' : ''
          }`}
          style={{
            height: LANE_LABEL_W,
            backgroundColor: `${color}1f`,
            color,
            borderColor: `${color}33`,
          }}
        >
          <RoleIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-3">{data.name}</span>
        </div>
        {handles}
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
        onClick={labelClickable ? onLabelClick : undefined}
        title={labelClickable ? `${data.name}（クリックで編集）` : undefined}
        className={`absolute left-0 top-0 h-full flex items-center justify-center gap-1 text-xs font-medium px-2 text-center border-r ${
          labelClickable ? 'nodrag nopan cursor-pointer pointer-events-auto hover:brightness-95' : ''
        }`}
        style={{ width: LANE_LABEL_W, backgroundColor: `${color}1f`, color, borderColor: `${color}33` }}
      >
        <RoleIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-3">{data.name}</span>
      </div>
      {handles}
    </div>
  );
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function EditableEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, selected, data,
}: EdgeProps & {
  data?: {
    onLabelUpdate?: (id: string, label: string) => void;
    onInsertNode?: (id: string) => void;
    /** この矢印が運ぶ情報種別名（チップ表示用）。未設定なら表示しない。 */
    informationTypeName?: string | null;
    /** この矢印に紐づく API エンドポイント数（>0 でパス中央付近に「API n」バッジを出す）。 */
    apiLinkCount?: number;
    /** 矢印の先端（終点）をドラッグして別ノードへ付け替える。ドロップ先ノードIDを渡す。 */
    onReconnectTarget?: (edgeId: string, newTargetNodeId: string) => void;
    /** 先端をノードから離れた場所にドロップした時、矢印自体を削除する。 */
    onDeleteSelf?: (edgeId: string) => void;
    /** ラベル/チップなど線以外の部分をクリックしても矢印を選択できるようにする。 */
    onSelect?: (edgeId: string) => void;
    /** 線の形状（smoothstep|bezier|straight）。 */
    pathStyle?: string | null;
    /** ラベル・チップのパス上位置（0〜1）。 */
    labelT?: number | null;
    infoT?: number | null;
    /** ラベル/チップをパスに沿って移動した時に割合 t を保存する。 */
    onMoveLabel?: (edgeId: string, t: number) => void;
    onMoveInfo?: (edgeId: string, t: number) => void;
  };
}) {
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((label as string) || '');
  const inputRef = useRef<HTMLInputElement>(null);
  // 先端ドラッグ（付け替え/削除）用: 開始点(screen)とカーソル位置を保持してゴースト線を描く。
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // ラベル/チップをパスに沿って移動中の live な割合（ドラッグ確定後も保持して props 反映まで保つ）。
  const [liveLabelT, setLiveLabelT] = useState<number | null>(null);
  const [liveInfoT, setLiveInfoT] = useState<number | null>(null);
  // クリックとドラッグを区別（移動したら直後の click 選択を抑止）。
  const movedRef = useRef(false);

  const onReconnectTarget = data?.onReconnectTarget;
  const onDeleteSelf = data?.onDeleteSelf;
  const onMoveLabel = data?.onMoveLabel;
  const onMoveInfo = data?.onMoveInfo;

  // 形状に応じてパスを生成（既定は角ばった smoothstep）。
  const pathParams = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  let edgePath: string;
  let labelX: number;
  let labelY: number;
  if (data?.pathStyle === 'bezier') {
    [edgePath, labelX, labelY] = getBezierPath(pathParams);
  } else if (data?.pathStyle === 'straight') {
    [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else {
    [edgePath, labelX, labelY] = getSmoothStepPath(pathParams);
  }

  // パス上の任意割合 t の座標を出す（detached path の getPointAtLength）。
  const measure = useMemo(() => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', edgePath);
    let len = 0;
    try { len = p.getTotalLength(); } catch { len = 0; }
    return { p, len };
  }, [edgePath]);
  const pointAt = useCallback(
    (t: number) => {
      try {
        const pt = measure.p.getPointAtLength(clamp01(t) * measure.len);
        return { x: pt.x, y: pt.y };
      } catch {
        return { x: labelX, y: labelY };
      }
    },
    [measure, labelX, labelY],
  );
  const nearestT = useCallback(
    (fx: number, fy: number) => {
      if (!measure.len) return 0.5;
      let best = 0.5;
      let bd = Infinity;
      for (let i = 0; i <= 48; i++) {
        const t = i / 48;
        let pt: DOMPoint;
        try { pt = measure.p.getPointAtLength(t * measure.len); } catch { continue; }
        const d = (pt.x - fx) ** 2 + (pt.y - fy) ** 2;
        if (d < bd) { bd = d; best = t; }
      }
      return best;
    },
    [measure],
  );

  // ラベル/チップをパスに沿ってドラッグ。移動したら割合 t を計算して保存。
  const startAlongDrag = useCallback(
    (
      e: ReactPointerEvent,
      setLive: (t: number) => void,
      persist?: (edgeId: string, t: number) => void,
    ) => {
      if (!persist) return;
      e.stopPropagation();
      const sx = e.clientX;
      const sy = e.clientY;
      movedRef.current = false;
      const move = (ev: PointerEvent) => {
        if (!movedRef.current && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        movedRef.current = true;
        const flow = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
        setLive(clamp01(nearestT(flow.x, flow.y)));
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (movedRef.current) {
          const flow = rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
          const t = clamp01(nearestT(flow.x, flow.y));
          setLive(t);
          persist(id, t);
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [rf, nearestT, id],
  );

  // 先端アンカーのドラッグ: ノードにドロップ=付け替え / 何もない所=削除。
  const onTargetAnchorDown = useCallback(
    (e: ReactPointerEvent) => {
      if (!onReconnectTarget && !onDeleteSelf) return;
      e.stopPropagation();
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      dragStartRef.current = { x: sx, y: sy };
      setDragPos({ x: sx, y: sy });
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 6) moved = true;
        setDragPos({ x: ev.clientX, y: ev.clientY });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragPos(null);
        dragStartRef.current = null;
        if (!moved) return; // ただのクリックは無視（誤削除/誤付け替え防止）
        const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
        const nodeEl = el?.closest('.react-flow__node') as HTMLElement | null;
        const newId = nodeEl?.getAttribute('data-id');
        if (newId && onReconnectTarget) onReconnectTarget(id, newId);
        else if (onDeleteSelf) onDeleteSelf(id);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [onReconnectTarget, onDeleteSelf, id],
  );

  const dragging = dragPos !== null;
  const commit = () => {
    setEditing(false);
    if (data?.onLabelUpdate && value !== label) data.onLabelUpdate(id, value);
  };
  const handleSelectClick = (e: ReactMouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) { movedRef.current = false; return; } // 直前がドラッグなら選択しない
    data?.onSelect?.(id);
  };

  const infoName = data?.informationTypeName;
  const labelPt = pointAt(liveLabelT ?? data?.labelT ?? 0.5);
  const infoPt = pointAt(liveInfoT ?? data?.infoT ?? 0.5);
  const insertPt = pointAt(0.5);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        // 線が細くても掴みやすいよう、クリック判定の帯を広く取る（どこを押しても選択可能に）。
        interactionWidth={34}
        style={{ strokeWidth: selected ? 3 : 2, stroke: selected ? '#3b82f6' : '#64748b' }}
      />
      <EdgeLabelRenderer>
        {/* 運ぶ情報種別のチップ: パス上 infoT の位置。ドラッグでパスに沿って移動、クリックで選択。 */}
        {infoName && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${infoPt.x}px,${infoPt.y - 30}px)`,
              pointerEvents: 'all',
            }}
            className={`nodrag nopan ${onMoveInfo ? 'cursor-move' : 'cursor-pointer'}`}
            onPointerDown={(e) => startAlongDrag(e, (t) => setLiveInfoT(t), onMoveInfo)}
            onClick={handleSelectClick}
            title="ドラッグで矢印に沿って移動 / クリックで選択"
          >
            <span
              className={`inline-flex items-center gap-0.5 rounded-full border bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 shadow-sm ${
                selected ? 'border-indigo-400' : 'border-indigo-200'
              }`}
            >
              <Database className="h-2.5 w-2.5" />
              {infoName}
            </span>
          </div>
        )}
        {/* 紐づくAPIのバッジ: パス中央付近に小さく「API n」。クリックで矢印を選択（編集パネルでAPI編集）。 */}
        {(data?.apiLinkCount ?? 0) > 0 && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${insertPt.x}px,${insertPt.y + 16}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan cursor-pointer"
            onClick={handleSelectClick}
            title="このやり取りに紐づくAPI（クリックで選択して編集）"
          >
            <span
              className={`inline-flex items-center gap-0.5 rounded-full border bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700 shadow-sm ${
                selected ? 'border-violet-400' : 'border-violet-200'
              }`}
            >
              <Plug className="h-2.5 w-2.5" />
              API {data?.apiLinkCount}
            </span>
          </div>
        )}
        {/* エッジ中点の「＋」: クリックでこの接続線の途中にノードを挿入。実際のパス中心に置く。 */}
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
              transform: `translate(-50%,-50%) translate(${insertPt.x}px,${insertPt.y}px)`,
              pointerEvents: 'all',
            }}
            className={`nodrag nopan flex h-5 w-5 items-center justify-center rounded-full border bg-white text-sky-600 shadow-sm transition-all hover:bg-sky-50 hover:scale-110 hover:opacity-100 ${
              selected ? 'border-sky-500 opacity-100' : 'border-gray-300 opacity-40'
            }`}
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
        {/* ラベル文字: パス上 labelT の位置。ドラッグでパスに沿って移動。 */}
        <div
          style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelPt.x}px,${labelPt.y - 10}px)`, pointerEvents: 'all' }}
          className={`nodrag nopan ${onMoveLabel && (label || selected) ? 'cursor-move' : ''}`}
          onPointerDown={(e) => { if (label || selected) startAlongDrag(e, (t) => setLiveLabelT(t), onMoveLabel); }}
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
              onClick={handleSelectClick}
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className={`px-2 py-0.5 text-xs bg-white border rounded shadow-sm hover:bg-blue-50 ${selected ? 'border-blue-500' : 'border-gray-300'}`}
              title="ドラッグで移動 / クリックで選択 / ダブルクリックで編集"
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
        {/* 矢印の先端（終点）をドラッグ: ノードへドロップ=付け替え / 何もない所=削除。
            選択中の矢印だけに出す（未選択ノードの接続ハンドルを塞がないため）。 */}
        {(onReconnectTarget || onDeleteSelf) && (selected || dragging) && (
          <div
            className={`nodrag nopan flex items-center justify-center ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            }`}
            title="ドラッグ: ノードへ=付け替え / 何もない所へ=削除"
            onPointerDown={onTargetAnchorDown}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${targetX}px,${targetY}px)`,
              pointerEvents: 'all',
              width: 22,
              height: 22,
            }}
          >
            <span
              className={`block rounded-full ring-2 transition-all ${
                dragging
                  ? 'h-3.5 w-3.5 bg-blue-500 ring-blue-300'
                  : 'h-3 w-3 bg-blue-500/80 ring-blue-200'
              }`}
            />
          </div>
        )}
      </EdgeLabelRenderer>
      {/* ドラッグ中のゴースト線（接続先選択の視覚フィードバック）。最前面・イベント透過。 */}
      {dragging &&
        dragStartRef.current &&
        dragPos &&
        createPortal(
          <svg
            style={{
              position: 'fixed',
              inset: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          >
            <line
              x1={dragStartRef.current.x}
              y1={dragStartRef.current.y}
              x2={dragPos.x}
              y2={dragPos.y}
              stroke="#3b82f6"
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <circle cx={dragPos.x} cy={dragPos.y} r={5} fill="#3b82f6" />
          </svg>,
          document.body,
        )}
    </>
  );
}

// コンテンツノードの描画サイズ（自由配置のシード/整形と一致させる。
// flow-layout の DEFAULT_LAYOUT_OPTIONS.nodeWidth/nodeHeight と揃える）。
const NODE_W = 156;
const NODE_H = 52;

/**
 * 接続ドラッグ中のカスタム接続線（Whimsical風）。
 * 線に加えて、カーソル位置に「これから生成されるノード」の半透明矩形ゴーストを描く。
 * ハンドルから空きへドロップ → ノード自動生成、という挙動を視覚的に予告する。
 * ConnectionLineComponentProps の toX/toY がカーソルの flow 座標。
 */
function GhostConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  connectionStatus,
}: ConnectionLineComponentProps) {
  // ノード/ハンドル上(valid/invalid)では既存ノードへの接続なので線だけ。
  // 空き pane (connectionStatus===null) の時だけ「これから生成されるノード」ゴーストを出す。
  const overEmpty = connectionStatus == null;
  return (
    <g>
      <path
        d={`M${fromX},${fromY} L${toX},${toY}`}
        fill="none"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="5 4"
      />
      {overEmpty && (
        <>
          {/* これから生成されるノードのゴースト（カーソル位置を中心に） */}
          <rect
            x={toX - NODE_W / 2}
            y={toY - NODE_H / 2}
            width={NODE_W}
            height={NODE_H}
            rx={8}
            ry={8}
            fill="#bfdbfe"
            fillOpacity={0.35}
            stroke="#3b82f6"
            strokeOpacity={0.6}
            strokeWidth={2}
            strokeDasharray="4 3"
          />
          <circle cx={toX} cy={toY} r={3} fill="#3b82f6" />
        </>
      )}
    </g>
  );
}

// ===========================================
// 注釈ノード（付箋・コメント）
// flowData.nodes とは別系統。type:'annotation' の専用ノードとして描画する。
// 本文は常時 textarea で編集 → onBlur で onUpdateAnnotation(id,{text})。
// ホバーで ✕ 削除ボタン → onDeleteAnnotation(id)。ドラッグ移動可（drag stop で位置保存）。
// ===========================================

type AnnotationNodeData = {
  kind: FlowAnnotation['kind'];
  text: string;
  color?: string | null;
  /** kind==='ICON' のとき表示する lucide アイコン名（ICON_MAP のキー）。 */
  icon?: string | null;
  /** kind==='SCOPE' のときの枠線スタイル（未設定は dashed 扱い）。 */
  borderStyle?: 'dashed' | 'solid' | null;
  /** kind==='SCOPE' のときの背景塗りの不透明度（0〜1。未設定は既定 0.08）。 */
  fillOpacity?: number | null;
  onUpdateText?: (id: string, text: string) => void;
  onDelete?: (id: string) => void;
  /** リサイズ確定時に呼ぶ（width/height を永続化）。embedded（閲覧）では未設定。 */
  onResizeEnd?: (id: string, size: { width: number; height: number }) => void;
  /** kind==='SCOPE' の枠スタイル/色/塗りを更新する（選択時の編集ポップ）。 */
  onUpdateStyle?: (
    id: string,
    patch: { color?: string; borderStyle?: 'dashed' | 'solid'; fillOpacity?: number },
  ) => void;
};

const ANNOTATION_W = 200;
const ANNOTATION_MIN_H = 96;
// アイコン注釈ノードの一辺（透明背景の小ノード。h-8 w-8 のアイコンを中央に置く）。
const ICON_ANNOTATION_SIZE = 40;
// スコープ囲み（kind==='SCOPE'）の既定サイズ・色・塗り。ノード群を囲える広めの矩形で生成する。
const SCOPE_DEFAULT_W = 320;
const SCOPE_DEFAULT_H = 200;
const SCOPE_DEFAULT_COLOR = '#6366f1';
const SCOPE_DEFAULT_FILL_OPACITY = 0.08;
// スコープの色プリセット（選択時の編集ポップ）。
const SCOPE_COLOR_PRESETS = [
  '#6366f1',
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#64748b',
];

/** #rrggbb → rgba(r,g,b,alpha)。スコープの背景塗り（色×不透明度）に使う。 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(99,102,241,${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * 注釈の実効描画サイズ（保存済み width/height があればそれ、無ければ種別ごとの既定）。
 * 縦横切替の追従（アンカー相対の再配置）と SCOPE の内外判定で共通に使う。
 */
function annotationSizeOf(
  a: Pick<FlowAnnotation, 'kind' | 'width' | 'height'>,
): { w: number; h: number } {
  const defW =
    a.kind === 'ICON' ? ICON_ANNOTATION_SIZE : a.kind === 'SCOPE' ? SCOPE_DEFAULT_W : ANNOTATION_W;
  const defH =
    a.kind === 'ICON'
      ? ICON_ANNOTATION_SIZE
      : a.kind === 'SCOPE'
      ? SCOPE_DEFAULT_H
      : ANNOTATION_MIN_H;
  return {
    w: typeof a.width === 'number' && a.width > 0 ? a.width : defW,
    h: typeof a.height === 'number' && a.height > 0 ? a.height : defH,
  };
}

// アイコン注釈で選べる固定パレット（lucide 名）。順序がパレットの並び。
const ICON_PALETTE = [
  'Star',
  'Flag',
  'AlertTriangle',
  'CheckCircle2',
  'Zap',
  'Heart',
  'ThumbsUp',
  'Bell',
  'Bookmark',
  'Target',
  'Lightbulb',
  'Ban',
  'Database',
  'User',
] as const;

// アイコン名 → lucide コンポーネント。AnnotationNode / パレット双方で参照する。
const ICON_MAP: Record<string, LucideIcon> = {
  Star,
  Flag,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Heart,
  ThumbsUp,
  Bell,
  Bookmark,
  Target,
  Lightbulb,
  Ban,
  // ツールバーのプリセット（DB / 人）からワンクリック配置する lucide アイコン。
  Database,
  User,
};

// アイコン注釈の既定色（未指定 icon のフォールバックも含む）。
const ICON_ANNOTATION_DEFAULT_COLOR = '#f59e0b';

function AnnotationNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: AnnotationNodeData;
  selected?: boolean;
}) {
  const isSticky = data.kind === 'STICKY';
  const isIcon = data.kind === 'ICON';
  const isScope = data.kind === 'SCOPE';
  const [value, setValue] = useState(data.text ?? '');
  // スコープのラベル（左上）はダブルクリックで input 編集に切り替える。
  const [editingLabel, setEditingLabel] = useState(false);
  // 塗りスライダーのドラッグ中ライブ値（pointerup で永続化。props 反映までちらつかせない）。
  const [liveFill, setLiveFill] = useState<number | null>(null);
  useEffect(() => {
    setLiveFill(null);
  }, [data.fillOpacity]);
  // 外部（再取得・楽観更新）で本文が変わったら同期。編集中の onBlur 確定後の再取得でも破綻しない。
  useEffect(() => {
    setValue(data.text ?? '');
  }, [data.text]);

  const handleBlur = useCallback(() => {
    if (value !== (data.text ?? '')) {
      data.onUpdateText?.(id, value);
    }
  }, [value, data, id]);

  // スコープ囲み: 業務領域を点線/実線の角丸矩形＋薄い背景塗りで囲う。
  // ノードより背面（zIndex 0）に描かれ、ラッパは pointerEvents:none のため
  // 内側のフローノード/エッジ操作を奪わない。掴めるのは枠線沿いの帯とラベルのみ。
  if (isScope) {
    const scopeColor = data.color || SCOPE_DEFAULT_COLOR;
    const borderStyle: 'dashed' | 'solid' = data.borderStyle === 'solid' ? 'solid' : 'dashed';
    const fillOpacity =
      liveFill ?? (typeof data.fillOpacity === 'number' ? data.fillOpacity : SCOPE_DEFAULT_FILL_OPACITY);
    const commitLabel = () => {
      setEditingLabel(false);
      handleBlur();
    };
    return (
      <div className="group/annotation relative h-full w-full">
        {/* 枠＋背景塗り（クリックを奪わない装飾層） */}
        <div
          className="pointer-events-none absolute inset-0 rounded-xl border-2"
          style={{
            borderStyle,
            borderColor: scopeColor,
            backgroundColor: hexToRgba(scopeColor, fillOpacity),
          }}
        />
        {/* 枠線沿いのドラッグ帯（ここを掴んで移動 / クリックで選択）。内側は素通し。 */}
        {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
          <div
            key={edge}
            title="ドラッグで移動 / クリックで選択"
            className={`pointer-events-auto absolute cursor-move ${
              edge === 'top'
                ? 'left-0 top-0 h-3 w-full'
                : edge === 'bottom'
                ? 'bottom-0 left-0 h-3 w-full'
                : edge === 'left'
                ? 'left-0 top-0 h-full w-3'
                : 'right-0 top-0 h-full w-3'
            }`}
          />
        ))}
        {/* ラベル（枠の左上）。ダブルクリックで編集 → onBlur で保存。 */}
        <div className="pointer-events-auto absolute left-2 top-1.5 max-w-[85%]">
          {editingLabel ? (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitLabel();
                if (e.key === 'Escape') {
                  setValue(data.text ?? '');
                  setEditingLabel(false);
                }
              }}
              placeholder="スコープ名"
              className="nodrag nopan h-6 w-40 rounded border border-gray-300 bg-white px-1.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          ) : (
            <div
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (data.onUpdateText) setEditingLabel(true);
              }}
              title="ドラッグで移動 / ダブルクリックでラベル編集"
              className="cursor-move truncate rounded px-1.5 py-0.5 text-[11px] font-semibold"
              style={{ color: scopeColor, backgroundColor: hexToRgba(scopeColor, 0.12) }}
            >
              {value || 'スコープ'}
            </div>
          )}
        </div>
        {/* 選択時の編集ポップ（枠スタイル / 色 / 塗り）。NodeToolbar はポータル描画のため
            前面のフローノードにも隠れない。 */}
        {data.onUpdateStyle && (
          <NodeToolbar isVisible={!!selected} position={Position.Top} align="start">
            <div className="nodrag nopan flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-md">
              <div className="flex items-center gap-0.5">
                {(
                  [
                    { v: 'dashed', label: '点線' },
                    { v: 'solid', label: '実線' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => data.onUpdateStyle?.(id, { borderStyle: opt.v })}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors ${
                      borderStyle === opt.v
                        ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="h-4 w-px bg-gray-200" />
              <div className="flex items-center gap-1">
                {SCOPE_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => data.onUpdateStyle?.(id, { color: c })}
                    title={c}
                    className={`h-3.5 w-3.5 rounded-full border transition-transform ${
                      scopeColor.toLowerCase() === c.toLowerCase()
                        ? 'scale-110 ring-2 ring-blue-400 ring-offset-1'
                        : ''
                    }`}
                    style={{ backgroundColor: c, borderColor: `${c}aa` }}
                  />
                ))}
              </div>
              <span className="h-4 w-px bg-gray-200" />
              <label className="flex items-center gap-1 text-[10px] text-gray-500">
                塗り
                <input
                  type="range"
                  min={0}
                  max={0.5}
                  step={0.02}
                  value={fillOpacity}
                  onChange={(e) => setLiveFill(Number(e.target.value))}
                  onPointerUp={(e) =>
                    data.onUpdateStyle?.(id, {
                      fillOpacity: Number((e.target as HTMLInputElement).value),
                    })
                  }
                  className="w-16"
                  title="背景塗りの濃さ"
                />
              </label>
            </div>
          </NodeToolbar>
        )}
        {/* ホバー/選択時に出る削除ボタン（付箋・コメントと同じ✕） */}
        <button
          type="button"
          title="このスコープを削除"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete?.(id);
          }}
          className={`nodrag nopan pointer-events-auto absolute -right-2 -top-2 h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-red-50 hover:text-red-600 group-hover/annotation:flex ${
            selected ? 'flex' : 'hidden'
          }`}
        >
          <X className="h-3 w-3" />
        </button>
        {/* マウスリサイズ（選択時のみ。embedded=閲覧では onResizeEnd 未設定＝非表示）。
            ラッパが pointerEvents:none のためハンドル/ラインに明示的に pointer-events を戻す。
            ドラッグ帯より後に描画して、選択中は枠リサイズを優先させる。 */}
        {data.onResizeEnd && (
          <NodeResizer
            minWidth={160}
            minHeight={100}
            isVisible={!!selected}
            keepAspectRatio={false}
            handleClassName="pointer-events-auto"
            lineClassName="pointer-events-auto"
            onResizeEnd={(_, params) =>
              data.onResizeEnd?.(id, {
                width: Math.round(params.width),
                height: Math.round(params.height),
              })
            }
          />
        )}
      </div>
    );
  }

  // 付箋=黄色付箋風、コメント=白＋吹き出し風。
  const stickyColor = data.color || '#fef9c3';
  const wrapperClass = isSticky
    ? 'rounded-sm border border-amber-300/70 shadow-md'
    : 'relative rounded-lg border-2 border-gray-300 bg-white shadow-md';

  // アイコン注釈: 箱を出さず透明背景の小ノード。lucide アイコンを大きめ＋color で表示。
  // ホバーで ✕ 削除（既存経路）、ドラッグ移動は flow ノードの drag stop で永続化される。
  if (isIcon) {
    const IconComp = ICON_MAP[data.icon ?? ''] ?? Star;
    const iconColor = data.color || ICON_ANNOTATION_DEFAULT_COLOR;
    return (
      <div className="group/annotation relative flex h-full w-full items-center justify-center">
        {/* マウスリサイズ（選択時のみハンドル。embedded=閲覧では onResizeEnd 未設定＝非表示）。 */}
        {data.onResizeEnd && (
          <NodeResizer
            minWidth={24}
            minHeight={24}
            isVisible={!!selected}
            keepAspectRatio
            onResizeEnd={(_, params) =>
              data.onResizeEnd?.(id, {
                width: Math.round(params.width),
                height: Math.round(params.height),
              })
            }
          />
        )}
        {/* アイコンは箱いっぱいに描画＝リサイズで拡大縮小する（keepAspectRatio で正方形維持）。 */}
        <IconComp className="h-full w-full p-1" style={{ color: iconColor }} strokeWidth={2} />
        {/* ホバーで出る削除ボタン（付箋・コメントと同じ✕） */}
        <button
          type="button"
          title="この注釈を削除"
          onClick={(e) => {
            e.stopPropagation();
            data.onDelete?.(id);
          }}
          className="nodrag nopan absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-red-50 hover:text-red-600 group-hover/annotation:flex"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group/annotation flex w-full h-full flex-col ${wrapperClass}`}
      style={isSticky ? { backgroundColor: stickyColor } : undefined}
    >
      {/* マウスリサイズ（選択時のみハンドル。embedded=閲覧では onResizeEnd 未設定＝非表示）。 */}
      {data.onResizeEnd && (
        <NodeResizer
          minWidth={120}
          minHeight={ANNOTATION_MIN_H}
          isVisible={!!selected}
          keepAspectRatio={false}
          onResizeEnd={(_, params) =>
            data.onResizeEnd?.(id, {
              width: Math.round(params.width),
              height: Math.round(params.height),
            })
          }
        />
      )}
      {/* コメントは左下に小さな吹き出しのしっぽを付ける */}
      {!isSticky && (
        <>
          <div className="absolute -bottom-2 left-5 h-3 w-3 rotate-45 border-b-2 border-r-2 border-gray-300 bg-white" />
        </>
      )}
      {/* 種別ラベル（小） */}
      <div
        className={`flex shrink-0 items-center justify-between px-2 pt-1 text-[10px] font-medium ${
          isSticky ? 'text-amber-700/80' : 'text-gray-400'
        }`}
      >
        <span>{isSticky ? '付箋' : 'コメント'}</span>
      </div>
      <textarea
        // ノード本体のドラッグや pan を奪わないよう nodrag/nopan を付与（テキスト編集を優先）。
        // 箱の高さに追従して伸縮させるため flex-1（min-h-0 で縮小も許可）。
        className={`nodrag nopan min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-2 pb-2 text-xs leading-snug outline-none ${
          isSticky ? 'text-amber-900 placeholder:text-amber-700/40' : 'text-gray-800 placeholder:text-gray-400'
        }`}
        value={value}
        placeholder={isSticky ? 'メモを入力…' : 'コメントを入力…'}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
      />
      {/* ホバーで出る削除ボタン */}
      <button
        type="button"
        title="この注釈を削除"
        onClick={(e) => {
          e.stopPropagation();
          data.onDelete?.(id);
        }}
        className="nodrag nopan absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-red-50 hover:text-red-600 group-hover/annotation:flex"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

const nodeTypes = { content: ContentNode, lane: LaneNode, annotation: AnnotationNode, imageElement: ImageElementNode };
const edgeTypes = { editable: EditableEdge };

// カテゴリ → バッジ配色（情報/物体/帳票）。
const INFO_CATEGORY_BADGE: Record<InformationCategory, string> = {
  INFORMATION: 'bg-sky-100 text-sky-700 border-sky-200',
  OBJECT: 'bg-amber-100 text-amber-700 border-amber-200',
  DOCUMENT: 'bg-violet-100 text-violet-700 border-violet-200',
};

// ===========================================
// ドラッグ移動できる浮遊パネルの土台（共通）
// ===========================================

/**
 * キャンバス上の浮遊パネルを「ヘッダーを掴んで自由に動かせる」ようにする小さな土台。
 *
 *  - 初期位置は呼び出し側が `className`（absolute left-3 top-1/2 ... 等）で指定する。
 *    ドラッグ量は内部 state の {x,y} オフセットで持ち、`transform: translate(x,y)` で
 *    重ねる。Tailwind の `-translate-y-1/2` のような初期 transform が必要な場合は
 *    `baseTransform` に渡すと drag translate の前段に合成する。
 *  - React Flow のパン/ノードドラッグを誘発しないよう全体に 'nodrag nopan'、
 *    ヘッダーの pointerdown では e.stopPropagation() してドラッグを開始する。
 *  - `header` はタイトル行（掴む対象）。`children` は本体。
 *  - 折りたたみ等の状態は呼び出し側が持つ（このコンポーネントは位置だけを担当）。
 */
function DraggableFloating({
  className,
  baseTransform = '',
  header,
  children,
  bodyClassName,
  style,
}: {
  className: string;
  baseTransform?: string;
  header: ReactNode;
  children?: ReactNode;
  bodyClassName?: string;
  style?: CSSProperties;
}) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const onHeaderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // 左クリック以外は無視。React Flow のパンへ伝播させない。
      if (e.button !== 0) return;
      e.stopPropagation();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        baseX: offset.x,
        baseY: offset.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [offset.x, offset.y],
  );

  const onHeaderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    setOffset({
      x: d.baseX + (e.clientX - d.startX),
      y: d.baseY + (e.clientY - d.startY),
    });
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }, []);

  const transform = `${baseTransform} translate(${offset.x}px, ${offset.y}px)`.trim();

  return (
    <div className={`nodrag nopan ${className}`} style={{ ...style, transform }}>
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="cursor-move touch-none select-none"
      >
        {header}
      </div>
      {children !== undefined && <div className={bodyClassName}>{children}</div>}
    </div>
  );
}

/**
 * 左サイドの INPUT/OUTPUT 候補パネル（④）。
 * プロジェクトの InformationType マスタ（DFD と共通の1テーブル）を一覧表示する。
 * 「ノードの INPUT/OUTPUT 候補 ＝ DFD と同じ1テーブル」を常に見える形にするのが目的。
 * 選択自体は既存のノードプロパティのマルチセレクトのまま（ここは閲覧＋新規追加のみ）。
 * 折りたたみ可。新規追加は onCreateInformationType（= informationTypeApi.create）を流用。
 */
function InformationTypeSidePanel({
  informationTypes,
  onCreateInformationType,
}: {
  informationTypes: InformationType[];
  onCreateInformationType?: SwimlaneCanvasProps['onCreateInformationType'];
}) {
  // 既定は折りたたみ。展開時もロールレーン左端のラベル列に被らないよう左下隅に置く
  // （従来は left-3 top-1/2 でレーンのロール名ラベルに重なって隠していた）。
  const [collapsed, setCollapsed] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<InformationCategory>('INFORMATION');
  const [busy, setBusy] = useState(false);

  const commitAdd = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || !onCreateInformationType) return;
    setBusy(true);
    try {
      const created = await onCreateInformationType({ name: trimmed, category });
      if (created) {
        setName('');
        setCategory('INFORMATION');
        setAdding(false);
      }
    } finally {
      setBusy(false);
    }
  }, [name, category, onCreateInformationType]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        title="INPUT/OUTPUT 候補（情報種別マスタ）を開く"
        className="absolute bottom-4 left-3 z-20 flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-600 shadow-sm hover:bg-gray-50"
      >
        <Database className="h-4 w-4 text-indigo-500" />
        <span>INPUT/OUTPUT候補</span>
      </button>
    );
  }

  return (
    <DraggableFloating
      className="absolute bottom-14 left-3 z-20 flex max-h-[70%] w-56 flex-col rounded-lg border border-gray-200 bg-white shadow-md"
      bodyClassName="flex min-h-0 flex-1 flex-col"
      header={
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
            <Database className="h-4 w-4 text-indigo-500" />
            <span className="text-[12px] font-semibold text-gray-700">INPUT/OUTPUT 候補</span>
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed(true)}
            title="折りたたむ"
            className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      }
    >
      <p className="px-3 pt-2 text-[10px] leading-snug text-gray-400">
        DFD と共通の情報種別マスタ。各ノードの INPUT/OUTPUT はノードのプロパティから選びます。
      </p>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {informationTypes.length === 0 ? (
          <p className="px-1 py-2 text-[11px] text-gray-400">まだ情報種別がありません。</p>
        ) : (
          <ul className="space-y-1">
            {informationTypes.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-1.5 rounded border border-gray-100 px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] text-gray-700" title={it.name}>
                  {it.name}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${INFO_CATEGORY_BADGE[it.category]}`}
                >
                  {INFORMATION_CATEGORY_LABELS[it.category]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {onCreateInformationType && (
        <div className="border-t border-gray-100 px-2 py-2">
          {adding ? (
            <div className="space-y-1.5">
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void commitAdd();
                  if (e.key === 'Escape') { setAdding(false); setName(''); }
                }}
                placeholder="名称（例: 注文書）"
                className="w-full rounded border border-gray-300 px-2 py-1 text-[12px]"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as InformationCategory)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-[12px]"
              >
                {INFORMATION_CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={() => void commitAdd()}
                  disabled={busy || !name.trim()}
                  className="h-7 flex-1 text-[12px]"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : '追加'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setAdding(false); setName(''); }}
                  disabled={busy}
                  className="h-7 text-[12px] text-gray-500"
                >
                  取消
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-indigo-300 px-2 py-1.5 text-[11px] text-indigo-600 hover:bg-indigo-50"
            >
              <Plus className="h-3 w-3" />
              新規追加
            </button>
          )}
        </div>
      )}
    </DraggableFloating>
  );
}

// ===========================================
// ロール一覧チップ + フロー途中でのロール追加（キャンバス左上 Panel）
// ===========================================

/** 人/システム区分の選択肢（ロール追加フォーム用）。 */
const ROLE_TYPE_OPTIONS: Array<{ value: RoleType; label: string }> = [
  { value: 'HUMAN', label: '人' },
  { value: 'SYSTEM', label: 'システム' },
  { value: 'OTHER', label: 'その他' },
];

/**
 * 現在のロール（スイムレーン）をチップで一覧表示し、フロー編集中に
 * その場でロールを追加できる小さなフォームを持つ。
 * 追加自体は onAddRole（= rolesApi.create + 一覧再取得）に委譲する。
 */
/** ロール編集パネルの色プリセット（スイムレーン帯の配色）。 */
const ROLE_COLOR_PRESETS = [
  '#3b82f6',
  '#0ea5e9',
  '#14b8a6',
  '#22c55e',
  '#84cc16',
  '#eab308',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
  '#64748b',
];

/**
 * 既存ロールをクリックで編集する小パネル。
 * 名前 input・人/システム/その他 区分・type==='SYSTEM' のとき systems から system 選択・色を編集し、
 * 保存=onUpdateRole / 削除=onDeleteRole を呼ぶ。閉じる=onClose。
 */
function RoleEditPanel({
  role,
  systems,
  onUpdateRole,
  onDeleteRole,
  onClose,
}: {
  role: Role;
  systems: SystemMaster[];
  onUpdateRole: SwimlaneCanvasProps['onUpdateRole'];
  onDeleteRole: SwimlaneCanvasProps['onDeleteRole'];
  onClose: () => void;
}) {
  const [name, setName] = useState(role.name);
  const [type, setType] = useState<RoleType>((role.type as RoleType) ?? 'HUMAN');
  const [systemId, setSystemId] = useState<string>(
    ((role as { systemId?: string | null }).systemId ?? '') || '',
  );
  const [color, setColor] = useState<string>(role.color || '#3b82f6');
  const [busy, setBusy] = useState(false);

  // 別のロールチップを選び直したらフォームを差し替える。
  useEffect(() => {
    setName(role.name);
    setType((role.type as RoleType) ?? 'HUMAN');
    setSystemId(((role as { systemId?: string | null }).systemId ?? '') || '');
    setColor(role.color || '#3b82f6');
  }, [role]);

  const commitSave = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy || !onUpdateRole) return;
    setBusy(true);
    try {
      await onUpdateRole(role.id, {
        name: trimmed,
        type,
        color,
        // SYSTEM のときだけ systemId を送る。未選択は null（紐づけ解除）。
        systemId: type === 'SYSTEM' ? (systemId || null) : null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  }, [name, type, color, systemId, busy, onUpdateRole, role.id, onClose]);

  const commitDelete = useCallback(async () => {
    if (busy || !onDeleteRole) return;
    setBusy(true);
    try {
      await onDeleteRole(role.id);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [busy, onDeleteRole, role.id, onClose]);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/40 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-600">ロールを編集</span>
        <button
          type="button"
          onClick={onClose}
          title="閉じる"
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commitSave();
          if (e.key === 'Escape') onClose();
        }}
        placeholder="ロール名"
        className="w-full rounded border border-gray-300 px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value as RoleType)}
        className="w-full rounded border border-gray-300 px-2 py-1 text-[12px] bg-white"
      >
        {ROLE_TYPE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {/* type==='SYSTEM' のときだけ、紐づくシステムを選ぶ。 */}
      {type === 'SYSTEM' && (
        <select
          value={systemId}
          onChange={(e) => setSystemId(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1 text-[12px] bg-white"
        >
          <option value="">（システム未選択）</option>
          {systems.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {/* 色プリセット */}
      <div className="flex flex-wrap gap-1">
        {ROLE_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            title={c}
            className={`h-4 w-4 rounded-full border transition-transform ${
              color.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-offset-1 ring-blue-400 scale-110' : ''
            }`}
            style={{ backgroundColor: c, borderColor: `${c}aa` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          onClick={() => void commitSave()}
          disabled={busy || !name.trim() || !onUpdateRole}
          className="h-7 flex-1 text-[12px]"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : (<><Check className="mr-1 h-3 w-3" />保存</>)}
        </Button>
        {onDeleteRole && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void commitDelete()}
            disabled={busy}
            title="このロールを削除"
            className="h-7 text-[12px] text-red-500 hover:text-red-600"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function AddRoleControl({
  roles,
  onAddRole,
  systems = [],
  onUpdateRole,
  onDeleteRole,
  editingRoleId,
  onEditRole,
}: {
  roles: Role[];
  onAddRole?: (name: string, type: RoleType) => Promise<void>;
  systems?: SystemMaster[];
  onUpdateRole?: SwimlaneCanvasProps['onUpdateRole'];
  onDeleteRole?: SwimlaneCanvasProps['onDeleteRole'];
  /** 外部（レーンヘッダークリック）から開かれている編集対象ロールID。 */
  editingRoleId?: string | null;
  /** 編集対象ロールIDの変更を親へ通知（チップクリック / 閉じる）。 */
  onEditRole?: (roleId: string | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<RoleType>('HUMAN');
  const [busy, setBusy] = useState(false);

  // ロールチップ編集が可能か（更新ハンドラがあるとき）。
  const canEditRoles = !!onUpdateRole;
  const editingRole = canEditRoles ? roles.find((r) => r.id === editingRoleId) ?? null : null;

  const commitAdd = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy || !onAddRole) return;
    setBusy(true);
    try {
      await onAddRole(trimmed, type);
      setName('');
      setType('HUMAN');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }, [name, type, busy, onAddRole]);

  return (
    <DraggableFloating
      className="flex max-w-[260px] flex-col rounded-lg border border-gray-200 bg-white p-2 shadow-sm"
      bodyClassName="flex flex-col gap-1.5"
      header={
        <div className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-gray-600">
          <GripVertical className="h-3.5 w-3.5 shrink-0 text-gray-300" />
          <Users className="h-3.5 w-3.5 text-blue-600" />
          ロール
        </div>
      }
    >
      {/* ロールチップ一覧（人/システム区分アイコン付き）。
          編集可能（onUpdateRole あり）なら、クリックで編集パネルを開く。 */}
      {roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roles.map((r) => {
            const RoleIcon = roleTypeIcon(r.type);
            const isEditing = canEditRoles && r.id === editingRoleId;
            const chipClass =
              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium' +
              (canEditRoles ? ' cursor-pointer hover:brightness-95' : '') +
              (isEditing ? ' ring-2 ring-blue-400 ring-offset-1' : '');
            const chipStyle = {
              backgroundColor: `${r.color}14`,
              borderColor: `${r.color}55`,
              color: r.color,
            };
            const chipInner = (
              <>
                <RoleIcon className="h-3 w-3" />
                <span className="max-w-[80px] truncate">{r.name}</span>
                {canEditRoles && <Pencil className="h-2.5 w-2.5 opacity-50" />}
              </>
            );
            return canEditRoles ? (
              <button
                key={r.id}
                type="button"
                onClick={() => onEditRole?.(isEditing ? null : r.id)}
                className={chipClass}
                style={chipStyle}
                title={`${r.name}（クリックで編集）`}
              >
                {chipInner}
              </button>
            ) : (
              <span key={r.id} className={chipClass} style={chipStyle} title={r.name}>
                {chipInner}
              </span>
            );
          })}
        </div>
      )}
      {/* ロール編集パネル（チップ / レーンヘッダークリックで開く） */}
      {editingRole && onUpdateRole && (
        <RoleEditPanel
          role={editingRole}
          systems={systems}
          onUpdateRole={onUpdateRole}
          onDeleteRole={onDeleteRole}
          onClose={() => onEditRole?.(null)}
        />
      )}
      {/* ＋ロール追加（名前 + 人/システム） */}
      {!onAddRole ? null : adding ? (
        <div className="flex flex-col gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitAdd();
              if (e.key === 'Escape') { setAdding(false); setName(''); }
            }}
            placeholder="ロール名（例: 営業部）"
            className="w-full rounded border border-gray-300 px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as RoleType)}
            className="w-full rounded border border-gray-300 px-2 py-1 text-[12px] bg-white"
          >
            {ROLE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              onClick={() => void commitAdd()}
              disabled={busy || !name.trim()}
              className="h-7 flex-1 text-[12px]"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : '追加'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setAdding(false); setName(''); }}
              disabled={busy}
              className="h-7 text-[12px] text-gray-500"
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1 rounded border border-dashed border-blue-300 px-2 py-1 text-[11px] text-blue-600 hover:bg-blue-50"
        >
          <Plus className="h-3 w-3" />
          ロール追加
        </button>
      )}
    </DraggableFloating>
  );
}

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

/** ノードが「未配置（座標が保存されていない）」か判定。 */
function isUnpositioned(n: FlowDataNode): boolean {
  return (n.positionX ?? 0) === 0 && (n.positionY ?? 0) === 0;
}

function readStoredOrientation(flowId: string): FlowOrientation {
  if (typeof window === 'undefined') return 'horizontal';
  const v = window.localStorage.getItem('flow-orientation-' + flowId);
  return v === 'vertical' ? 'vertical' : 'horizontal';
}

function readStoredInteractMode(flowId: string): 'select' | 'move' {
  if (typeof window === 'undefined') return 'select';
  const v = window.localStorage.getItem('flow-interact-mode-' + flowId);
  return v === 'move' ? 'move' : 'select';
}

function SwimlaneCanvasInner(props: SwimlaneCanvasProps) {
  const { flowData, roles } = props;
  const { fitView, getViewport, screenToFlowPosition } = useReactFlow();
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  // ロール編集パネルで開いているロールID（ロールチップ / レーンヘッダークリックで開く）。
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  // 表示中ロールが消えた（一覧再取得で削除済み）場合は編集対象を閉じる。
  useEffect(() => {
    if (editingRoleId && !roles.some((r) => r.id === editingRoleId)) {
      setEditingRoleId(null);
    }
  }, [roles, editingRoleId]);
  // 全画面トグル: true の間、最外ラッパを fixed inset-0 z-50 に拡大して
  // React Flow を画面いっぱいに表示する。Esc / ボタン再押下で解除。
  const [isFullscreen, setIsFullscreen] = useState(false);
  // アイコン注釈パレット（ツールバーの「アイコン」ボタンのポップオーバー）の開閉。
  const [iconPaletteOpen, setIconPaletteOpen] = useState(false);
  // クリック選択中の SCOPE 注釈。右サイドに「この囲みが何を受け取り何を出すか」
  // （境界をまたぐ INPUT/OUTPUT 矢印一覧）パネルを表示する。
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  // 選択中の SCOPE が消えた（削除・フロー切替での再取得）らパネルを閉じる。
  useEffect(() => {
    if (
      selectedScopeId &&
      !(props.annotations ?? []).some((a) => a.id === selectedScopeId && a.kind === 'SCOPE')
    ) {
      setSelectedScopeId(null);
    }
  }, [props.annotations, selectedScopeId]);
  // 操作モード（選択 / 移動）。embedded（比較ビュー）では使わない。
  //   - 'select': 左ドラッグで範囲選択・ノード移動。中/右ドラッグで画面パン。Space 押しながら左ドラッグでもパン。
  //   - 'move'  : 左ドラッグで画面パン。
  // 向き（orientation）と同様に flow ごとに localStorage 永続化し、再マウントしても保持する。
  const [interactMode, setInteractModeState] = useState<'select' | 'move'>('select');
  useEffect(() => {
    setInteractModeState(readStoredInteractMode(flowData.id));
  }, [flowData.id]);
  const setInteractMode = useCallback(
    (next: 'select' | 'move' | ((m: 'select' | 'move') => 'select' | 'move')) => {
      setInteractModeState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('flow-interact-mode-' + flowData.id, resolved);
        }
        return resolved;
      });
    },
    [flowData.id],
  );
  const wrapperRef = useRef<HTMLDivElement>(null);

  // --- 画像要素（DiagramElement.type=IMAGE）— flow ノード/注釈とは別系統 ---
  const [imageElements, setImageElements] = useState<DiagramElementDto[]>([]);
  const flowId = flowData.id;
  // 現在の画像配列の最新参照。イベントハンドラ/効果から pre-mutation 値を同期的に読み、
  // op の逆操作（移動前座標・削除前 DTO 等）を取りこぼさず記録するために使う。
  const imageElementsRef = useRef<DiagramElementDto[]>(imageElements);
  imageElementsRef.current = imageElements;

  // 画像 op-log（スナップショット比較ではなく操作ログで Undo/Redo）。各 mutation site が
  // do/undo ペアを記録し、undo/redo は applyDelta（純粋）＋ applyOps（冪等）で反映する。
  // フロー切替（diagramId 変化）時の履歴破棄はフック内部で行う。
  const imageOps = useImageOpLog({
    projectId: props.projectId,
    diagramId: flowId,
    setImageElements,
  });
  const recordImageOpRef = useRef(imageOps.recordImageOp);
  recordImageOpRef.current = imageOps.recordImageOp;

  // 画像 DTO → 安定射影（op 要素ペイロード用。createdAt 等の揮発フィールドを落とす）。
  const toRestoreInput = useCallback(
    (e: DiagramElementDto): DiagramElementRestoreInput => ({
      id: e.id, type: e.type,
      positionX: e.positionX, positionY: e.positionY,
      width: e.width, height: e.height, rotation: e.rotation, z: e.z,
      attachmentId: e.attachmentId, text: e.text, color: e.color,
    }),
    [],
  );

  // フロー切替で画像をサーバから読み直す（op-log 履歴の破棄はフック側が diagramId で行う）。
  // 取得失敗時は空のまま（旧実装の「親 baseline を巻き込む空通知」は廃止）。
  useEffect(() => {
    const pid = props.projectId;
    setImageElements([]);
    if (!pid || !flowId) return;
    let cancelled = false;
    void diagramElementApi
      .list(pid, 'FLOW', flowId)
      .then((list) => {
        if (!cancelled) setImageElements(list.filter((e) => e.type === 'IMAGE'));
      })
      .catch(() => {
        /* 取得失敗は致命ではない（空のまま表示） */
      });
    return () => { cancelled = true; };
  }, [props.projectId, flowId]);

  // 画像Undoの操作可否＋命令的ハンドルを親へ公開（⌘Z ルーター/ツールバー活性の統合用）。
  const onImageUndoStateChange = props.onImageUndoStateChange;
  const imageUndoApiRef = props.imageUndoApiRef;
  const {
    undo: imageUndo, redo: imageRedo,
    peekUndoSeq: imagePeekUndo, peekRedoSeq: imagePeekRedo,
    canUndo: imageCanUndo, canRedo: imageCanRedo,
  } = imageOps;
  useEffect(() => {
    onImageUndoStateChange?.({ canUndo: imageCanUndo, canRedo: imageCanRedo });
  }, [onImageUndoStateChange, imageCanUndo, imageCanRedo]);
  useEffect(() => {
    if (!imageUndoApiRef) return;
    imageUndoApiRef.current = {
      undo: imageUndo, redo: imageRedo,
      peekUndoSeq: imagePeekUndo, peekRedoSeq: imagePeekRedo,
    };
    return () => { imageUndoApiRef.current = null; };
  }, [imageUndoApiRef, imageUndo, imageRedo, imagePeekUndo, imagePeekRedo]);

  // --- ノードインスペクタパネル（content ノード単一クリック時） ---
  const [panel, setPanel] = useState<{ nodeId: string; nodeLabel: string } | null>(null);

  // --- 向き（縦/横）: flow ごとに localStorage 永続化 ---
  const [orientation, setOrientation] = useState<FlowOrientation>('horizontal');
  useEffect(() => {
    setOrientation(readStoredOrientation(flowData.id));
  }, [flowData.id]);
  // 低レベル: 向きを state へ反映しつつ localStorage に永続化する。
  // 実際の「トグル + 新しい向きでの再レイアウト保存」は tidyLayout 定義後の
  // toggleOrientation（後段）で行う。
  const applyOrientation = useCallback(
    (next: FlowOrientation) => {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('flow-orientation-' + flowData.id, next);
      }
      setOrientation(next);
    },
    [flowData.id],
  );

  const isVertical = orientation === 'vertical';

  // --- 整形/縦横切替の保存往復ガード ---
  // persistLayout（onTidyNodes = PUT + 再取得）が完了するまで flowData.nodes の座標は
  // 旧レイアウト世代のまま残る。一方、注釈は onUpdateAnnotation の楽観更新で即座に
  // 新世代の座標へ移る。完了前に次の縦横切替が走ると、toggleOrientation が
  // 「新世代の注釈座標 × 旧世代のノード座標」を突き合わせて誤アンカー選択・誤った
  // SCOPE メンバー判定を行い、壊れた配置を PATCH で永続化してしまう。
  // そのため保存往復中は 整形/縦横 ボタンを無効化し、ハンドラ側でも早期 return する。
  const [layoutSaving, setLayoutSaving] = useState(false);

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

  // computeFlowLayout への入力（ノード/エッジ）。整形・向きトグル再レイアウトで共有する。
  const layoutInputNodes = useMemo<LayoutInputNode[]>(
    () =>
      flowData.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        roleId: n.roleId ?? n.role?.id ?? null,
        order: n.order,
        // 整形（縦横転置含む）が実サイズで配置できるよう、保存済みのリサイズ値を渡す。
        // 未設定なら computeFlowLayout のデフォルト（NODE_W/H 相当）が使われる。
        width: typeof n.width === 'number' && n.width > 0 ? n.width : undefined,
        height: typeof n.height === 'number' && n.height > 0 ? n.height : undefined,
      })),
    [flowData.nodes],
  );
  const layoutInputEdges = useMemo<LayoutInputEdge[]>(
    () =>
      flowData.edges.map((e) => ({
        id: e.id,
        source: e.sourceNodeId,
        target: e.targetNodeId,
      })),
    [flowData.edges],
  );

  // --- 整形エンジン（computeFlowLayout）: 綺麗な決定的座標 ---
  // 用途は 2 つ:
  //  1) 未配置ノード（positionX/Y が 0,0）のシード位置（原点スタックを防ぐ）
  //  2) 「整形」ボタンが永続化する綺麗なレイアウト
  // ノードの roleId が変わったり向きが変わると再計算される。
  const tidyLayout = useMemo<FlowLayoutView>(() => {
    // 整形が算出するレーン厚を背景レーン帯（computeLaneBands）と完全一致させるため、
    // 同一の laneHeightOverrides を渡す。これにより整形後にノード中心が必ず
    // 自レーン帯内に収まり、帯の外へはみ出さない。
    return computeFlowLayout(layoutInputNodes, layoutInputEdges, laneRoles, {
      orientation,
      laneHeightOverrides,
    } as Parameters<typeof computeFlowLayout>[3]) as unknown as FlowLayoutView;
  }, [layoutInputNodes, layoutInputEdges, laneRoles, orientation, laneHeightOverrides]);

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
      // リサイズ済みノードは実サイズで帯に内包させる（保存値→なければ既定）。
      const w = typeof n.width === 'number' && n.width > 0 ? n.width : NODE_W;
      const h = typeof n.height === 'number' && n.height > 0 ? n.height : NODE_H;
      return {
        id: n.id,
        roleId: n.roleId ?? n.role?.id ?? null,
        // computeLaneBands は中心座標を取る → 左上 + 半サイズ
        x: pos.x + w / 2,
        y: pos.y + h / 2,
        width: w,
        height: h,
      };
    });
    return computeLaneBands(bandNodes, laneRoles, orientation, {
      laneHeightOverrides,
    });
  }, [flowData.nodes, effectivePositions, laneRoles, orientation, laneHeightOverrides]);

  // --- レーン境界ハンドルのドラッグ: レーン厚を手動リサイズ ---
  // レーンは順番に上→下（縦なら左→右）へ積まれるため、あるレーンの厚みを増やすと
  // 必ず「下（右）側」へ伸びる。そこで掴んだ境界が必ずカーソルに追従するよう、
  //  ・下端/右端 = そのレーン自身の厚みを増減（下/右が＋）
  //  ・上端/左端 = ひとつ前（上/左）のレーンとの共有境界 → 前のレーンの厚みを増減
  // とし、どちらも「下/右へドラッグ＝＋」の同じ符号で扱う（上をドラッグして下が伸びる違和感を解消）。
  // 先頭レーンの上端/左端は前レーンが無いので操作対象外（ハンドル自体も出さない）。
  // 画面ピクセル差をズームで割って flow 座標の差に変換し、ローカル先取り表示。pointerup で永続化。
  const handleLaneResizeStart = useCallback(
    (roleId: string, edge: 'top' | 'bottom' | 'left' | 'right', e: ReactPointerEvent) => {
      const idx = bands.lanes.findIndex((l) => l.roleId === roleId);
      if (idx < 0) return;
      const isStartEdge = edge === 'top' || edge === 'left'; // 手前側＝前レーンとの共有境界
      const targetLane = isStartEdge ? bands.lanes[idx - 1] : bands.lanes[idx];
      if (!targetLane) return; // 先頭レーンの手前側境界は触れない
      const targetRoleId = targetLane.roleId;
      const MIN_LANE_THICKNESS = 60;
      const startThickness = isVertical ? targetLane.width ?? 0 : targetLane.height;
      const startClient = isVertical ? e.clientX : e.clientY;
      const zoom = getViewport().zoom || 1;

      // 境界を 下/右 へ動かす（client 増）と対象レーンが太る = 常に同符号。
      const computeNext = (client: number) =>
        Math.max(
          MIN_LANE_THICKNESS,
          Math.round(startThickness + (client - startClient) / zoom),
        );

      const onMove = (ev: PointerEvent) => {
        const next = computeNext(isVertical ? ev.clientX : ev.clientY);
        setLocalLaneHeights((prev) => ({ ...prev, [targetRoleId]: next }));
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const next = computeNext(isVertical ? ev.clientX : ev.clientY);
        // ローカル先取りはサーバ再取得（flowData.laneHeights）が反映されるまで残す。
        setLocalLaneHeights((prev) => ({ ...prev, [targetRoleId]: next }));
        props.onUpdateLaneHeight?.(targetRoleId, next);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [bands, isVertical, getViewport, props],
  );

  // --- React Flow ノード（背景レーン + コンテンツ） ---
  const rfNodes: Node[] = useMemo(() => {
    const laneNodes: Node[] = bands.lanes.map((lane, idx) => {
      // 実ロールのみリサイズ可（未割当レーンは不可）。永続化ハンドラが無ければ無効。
      const realRole = roles.find((r) => r.id === lane.roleId);
      const resizable = !!props.onUpdateLaneHeight && !!realRole;
      const laneData: LaneNodeData = {
        name: lane.name,
        color: lane.color,
        orientation,
        roleId: lane.roleId,
        // bands.lanes は type を持たないため、roles から id で引いて種別を渡す（最小変更）。
        roleType: realRole?.type,
        resizable,
        // 先頭レーンは前レーンが無いので手前側（上端/左端）ハンドルは出さない。
        showStartHandle: idx > 0,
        onResizeStart: handleLaneResizeStart,
        // レーンヘッダークリックでロール編集を開く（実ロールかつ編集ハンドラありのとき）。
        onLaneClick:
          props.onUpdateRole && realRole ? () => setEditingRoleId(lane.roleId) : undefined,
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
          connectable: false,
          zIndex: 0,
          width,
          height: LANE_LABEL_W + bands.height + 80,
          // レーン背景ラッパーはクリックを奪わない（下層のエッジ線を選択できるように）。
          // 内部のリサイズハンドルだけ pointer-events:auto で操作可能。
          style: { width, height: LANE_LABEL_W + bands.height + 80, pointerEvents: 'none' },
        } as Node;
      }
      return {
        id: `lane-${lane.roleId}`,
        type: 'lane',
        position: { x: -LANE_LABEL_W, y: lane.top },
        data: laneData,
        draggable: false,
        selectable: false,
        connectable: false,
        zIndex: 0,
        width: LANE_LABEL_W + bands.width + 80,
        height: lane.height,
        // レーン背景ラッパーはクリックを奪わない（下層のエッジ線を選択できるように）。
        style: { width: LANE_LABEL_W + bands.width + 80, height: lane.height, pointerEvents: 'none' },
      } as Node;
    });

    const contentNodes: Node[] = flowData.nodes.map((src) => {
      const pos = effectivePositions.get(src.id) ?? { x: 0, y: 0 };
      // 保存済みリサイズ値があればその寸法で描画、無ければ既定 NODE_W/H。
      const w = typeof src.width === 'number' && src.width > 0 ? src.width : NODE_W;
      const h = typeof src.height === 'number' && src.height > 0 ? src.height : NODE_H;
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
          // embedded（閲覧）ではリサイズ不可（ハンドルを出さない）。
          onResizeEnd: props.embedded
            ? undefined
            : (id, size) => props.onUpdateNode?.(id, { width: size.width, height: size.height }),
        } as ContentNodeData,
        width: w,
        height: h,
        style: { width: w, height: h },
        draggable: true,
        zIndex: 1,
      } as Node;
    });

    // 注釈ノード（付箋・コメント）。flowData.nodes とは別系統で append する。
    // id は注釈の uuid をそのまま使う（flow ノード id とは UUID 空間が別なので衝突しない）。
    // zIndex を高めにしてノード/エッジの上に重ねる。
    const annotationNodes: Node[] = (props.annotations ?? []).map((a) => {
      const data: AnnotationNodeData = {
        kind: a.kind,
        text: a.text,
        color: a.color,
        icon: a.icon,
        borderStyle: a.borderStyle,
        fillOpacity: a.fillOpacity,
        onUpdateText: (id, text) => props.onUpdateAnnotation?.(id, { text }),
        onDelete: (id) => props.onDeleteAnnotation?.(id),
        // embedded（閲覧）ではリサイズ不可（ハンドルを出さない）。
        onResizeEnd: props.embedded
          ? undefined
          : (id, size) => props.onUpdateAnnotation?.(id, { width: size.width, height: size.height }),
        // スコープの枠スタイル/色/塗りの編集ポップ（選択時）。embedded では出さない。
        onUpdateStyle:
          props.embedded || a.kind !== 'SCOPE'
            ? undefined
            : (id, patch) => props.onUpdateAnnotation?.(id, patch),
      };
      // アイコン注釈は透明背景の小ノード。付箋/コメントの箱（幅 200 / 最低高 96）は出さない。
      const isIconAnnotation = a.kind === 'ICON';
      // スコープ囲みはノード群を覆う広い矩形（既定 320×200）。
      const isScopeAnnotation = a.kind === 'SCOPE';
      // 保存済みリサイズ値があればその寸法で描画、無ければ既定サイズ。
      const defaultW = isIconAnnotation
        ? ICON_ANNOTATION_SIZE
        : isScopeAnnotation
        ? SCOPE_DEFAULT_W
        : ANNOTATION_W;
      const defaultH = isIconAnnotation
        ? ICON_ANNOTATION_SIZE
        : isScopeAnnotation
        ? SCOPE_DEFAULT_H
        : ANNOTATION_MIN_H;
      const w = typeof a.width === 'number' && a.width > 0 ? a.width : defaultW;
      const h = typeof a.height === 'number' && a.height > 0 ? a.height : defaultH;
      return {
        id: a.id,
        type: 'annotation',
        position: { x: a.positionX, y: a.positionY },
        data,
        width: w,
        height: h,
        // スコープはノード（zIndex 1）より背面（レーン帯と同じ 0。DOM 順でレーンより手前）。
        // さらにラッパは pointerEvents:none にし、内側のフローノード/エッジ操作を奪わない
        // （掴めるのは AnnotationNode 側で pointer-events を戻した枠帯・ラベルのみ）。
        style: isScopeAnnotation
          ? { width: w, height: h, pointerEvents: 'none' as const }
          : { width: w, height: h },
        draggable: true,
        selectable: true,
        connectable: false,
        zIndex: isScopeAnnotation ? 0 : 5,
      } as Node;
    });

    return [...laneNodes, ...contentNodes, ...annotationNodes];
  }, [
    bands,
    flowData.nodes,
    effectivePositions,
    orientation,
    isVertical,
    roles,
    handleLaneResizeStart,
    props.embedded,
    props.onUpdateNode,
    props.onUpdateLaneHeight,
    props.onUpdateRole,
    props.annotations,
    props.onUpdateAnnotation,
    props.onDeleteAnnotation,
  ]);

  // 画像要素ノード（type:'imageElement'）— flow ノード/注釈とは別系統。connectable:false。
  // 整形（onTidyNodes）・縦横転置・Undo-Redo の対象外。zIndex 4 でコンテンツより上。
  const imageElementRfNodes: Node[] = useMemo(
    () =>
      imageElements.map((e) => ({
        id: e.id,
        type: 'imageElement',
        position: { x: e.positionX, y: e.positionY },
        width: e.width ?? 200,
        height: e.height ?? 150,
        style: { width: e.width ?? 200, height: e.height ?? 150 },
        draggable: true,
        selectable: true,
        connectable: false,
        zIndex: 4,
        data: {
          url: nodeAttachmentApi.fileUrl(e.attachmentId!),
          onResizeEnd: (id: string, size: { width: number; height: number }) => {
            void diagramElementApi.patch(id, { width: size.width, height: size.height });
            // 逆操作＝リサイズ前のサイズへ。e は useMemo[imageElements] 時点（リサイズ前）の値。
            const before = toRestoreInput(e);
            recordImageOpRef.current(
              { type: 'upsert', elements: [{ ...before, width: size.width, height: size.height }] },
              { type: 'upsert', elements: [before] },
            );
            setImageElements((prev) =>
              prev.map((x) => (x.id === id ? { ...x, width: size.width, height: size.height } : x)),
            );
          },
        },
      } as Node)),
    [imageElements],
  );

  // 全ノード = レーン背景 + コンテンツ + 注釈 + 画像要素。
  // 画像要素はレーン帯の上、コンテンツ/注釈には干渉しない独立ノード。
  const allRfNodes = useMemo(
    () => [...rfNodes, ...imageElementRfNodes],
    [rfNodes, imageElementRfNodes],
  );

  // React Flow は制御モードでは onNodesChange が無いとドラッグで位置が動かない。
  // 決定的レイアウト(allRfNodes)を初期値にした内部 state を持ち、ドラッグ中の位置変更を
  // 反映させる。レイアウトが再計算されたら(allRfNodes が変わったら)正規位置へ同期し直す。
  const [dragNodes, setDragNodes, onNodesChange] = useNodesState(allRfNodes);
  useEffect(() => {
    setDragNodes(allRfNodes);
  }, [allRfNodes, setDragNodes]);

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
          // 紐づくAPI数（>0 でパス中央付近に「API n」バッジを表示）。
          apiLinkCount: e.apiLinks?.length ?? 0,
          // 線の形状・ラベル/チップのパス上位置。
          pathStyle: e.pathStyle ?? null,
          labelT: e.labelT ?? null,
          infoT: e.infoT ?? null,
          // ラベル/チップなど線以外をクリックしても選択できるように。
          onSelect: (eid: string) => setSelectedEdgeId(eid),
          // ラベル/チップをパスに沿って移動 → 割合 t を保存。
          onMoveLabel: props.onUpdateEdge
            ? (edgeId: string, t: number) => props.onUpdateEdge?.(edgeId, { labelT: t })
            : undefined,
          onMoveInfo: props.onUpdateEdge
            ? (edgeId: string, t: number) => props.onUpdateEdge?.(edgeId, { infoT: t })
            : undefined,
          // 先端ドラッグでの付け替え（ドロップ先ノードへ target を変更）。
          onReconnectTarget: props.onReconnectEdge
            ? (edgeId: string, newTargetNodeId: string) => {
                const cur = flowData.edges.find((x) => x.id === edgeId);
                if (!cur || newTargetNodeId === cur.sourceNodeId) return;
                props.onReconnectEdge?.(edgeId, {
                  sourceNodeId: cur.sourceNodeId,
                  targetNodeId: newTargetNodeId,
                  sourceHandle: cur.sourceHandle ?? null,
                  targetHandle: cur.targetHandle ?? null,
                });
              }
            : undefined,
          // 先端を何もない所へドロップ → 矢印を削除。
          onDeleteSelf: props.onDeleteEdge
            ? (edgeId: string) => {
                props.onDeleteEdge?.(edgeId);
                if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
              }
            : undefined,
        },
      })),
    [
      flowData.edges,
      selectedEdgeId,
      props.onUpdateEdgeLabel,
      props.onInsertNodeOnEdge,
      props.onReconnectEdge,
      props.onUpdateEdge,
      props.onDeleteEdge,
    ],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitView, flowData.id, orientation]);

  // 全画面トグル: 拡大/縮小いずれもサイズ変化後に fitView で図を収め直す。
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => {
      const next = !prev;
      // ラッパのサイズが変わってから fitView する（同期実行だと旧サイズで計算される）。
      setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 60);
      return next;
    });
  }, [fitView]);

  // 全画面中に Esc で解除（入力欄フォーカス中は無視）。
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setIsFullscreen(false);
      setTimeout(() => fitView({ padding: 0.2, duration: 200 }), 60);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, fitView]);

  // 選択中の矢印を Delete / Backspace で削除（入力欄にフォーカス中は無視）。
  // React Flow 標準の削除(deleteKeyCode)はノードまで巻き込むため無効化し、自前で矢印だけ消す。
  const onDeleteEdge = props.onDeleteEdge;
  useEffect(() => {
    if (!selectedEdgeId || !onDeleteEdge) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      onDeleteEdge(selectedEdgeId);
      setSelectedEdgeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEdgeId, onDeleteEdge]);

  // 選択中の自由配置要素（画像 / 注釈=DB/人/アイコン・付箋・コメント・スコープ）を
  // Delete / Backspace で削除する。コンテンツノード（業務ブロック）は誤削除防止のため
  // 対象外（従来どおりパネル/右クリックから削除）。React Flow の選択(node.selected)を見る。
  const dragNodesRef = useRef(dragNodes);
  dragNodesRef.current = dragNodes;
  const onDeleteAnnotationKb = props.onDeleteAnnotation;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const selected = dragNodesRef.current.filter((n) => n.selected);
      const imgIds = selected.filter((n) => n.type === 'imageElement').map((n) => n.id);
      const annoIds = selected.filter((n) => n.type === 'annotation').map((n) => n.id);
      if (imgIds.length === 0 && annoIds.length === 0) return;
      e.preventDefault();
      if (imgIds.length > 0) {
        // 逆操作（id 保持で復活）のため削除前 DTO を ref から同期取得してから消す。
        const removed = imageElementsRef.current.filter((x) => imgIds.includes(x.id));
        for (const id of imgIds) void diagramElementApi.remove(id);
        setImageElements((prev) => prev.filter((x) => !imgIds.includes(x.id)));
        if (removed.length > 0) {
          recordImageOpRef.current(
            { type: 'delete', ids: removed.map((x) => x.id) },
            { type: 'upsert', elements: removed.map(toRestoreInput) },
          );
        }
      }
      for (const id of annoIds) onDeleteAnnotationKb?.(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDeleteAnnotationKb]);

  // 接続ドラッグを開始したノード/ハンドルを覚えておく。
  // - 向きの正規化（開始ノード → ドロップ先）に使う。
  // - 空き場所にドロップした時の「ノード自動生成＋接続」（②）で開始ハンドルを使う。
  const connectStartRef = useRef<{ nodeId: string; handleId: string | null } | null>(null);
  // onConnect（有効ノードに繋がった）が発火したかを onConnectEnd で判定するためのフラグ。
  const connectedToNodeRef = useRef(false);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      connectedToNodeRef.current = true;
      let source = c.source;
      let target = c.target;
      let sourceHandle = c.sourceHandle ?? null;
      let targetHandle = c.targetHandle ?? null;
      // 矢印は「ドラッグを始めたノード → ドロップしたノード」に固定する。
      // ConnectionMode.Loose では各辺に source/target ハンドルが重なっており、
      // React Flow が向きを逆に割り当てることがあるため、開始ノードを起点に正規化する。
      const start = connectStartRef.current?.nodeId ?? null;
      if (start && start === c.target) {
        source = c.target;
        target = c.source;
        sourceHandle = c.targetHandle ?? null;
        targetHandle = c.sourceHandle ?? null;
      }
      props.onConnectNodes?.(source, target, { sourceHandle, targetHandle });
    },
    [props],
  );

  // --- ハンドルから空き場所(pane)へドロップ → ノード自動生成＋接続（Whimsical風） ② ---
  // onConnectStart で開始ノード/ハンドルを記録し、onConnect が呼ばれなかった
  // （= 有効なノード/ハンドルに繋がらなかった）場合のみ、ドロップ座標に新ノードを生成する。
  const onConnectStart = useCallback(
    (_e: unknown, params: OnConnectStartParams) => {
      connectStartRef.current = params.nodeId
        ? { nodeId: params.nodeId, handleId: params.handleId ?? null }
        : null;
      connectedToNodeRef.current = false;
    },
    [],
  );

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const start = connectStartRef.current;
      connectStartRef.current = null;
      // 有効なノード/ハンドルに繋がった（onConnect 発火済み）なら何もしない。
      if (connectedToNodeRef.current) {
        connectedToNodeRef.current = false;
        return;
      }
      if (!start || !props.onCreateConnectedNode) return;

      // ドロップ先がノード/ハンドルでない（空き pane など）か判定する。
      // event.target が .react-flow__node / __handle 配下なら有効な接続なので無視。
      const targetEl = event.target as HTMLElement | null;
      const droppedOnNode = !!targetEl?.closest('.react-flow__node');
      const droppedOnHandle = !!targetEl?.closest('.react-flow__handle');
      if (droppedOnNode || droppedOnHandle) return;

      // ドロップ座標（flow 座標）。touch/mouse の両対応で clientX/Y を取り出す。
      const point =
        'changedTouches' in event && event.changedTouches.length > 0
          ? { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY }
          : { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
      const flowPos = screenToFlowPosition(point);

      // 開始ハンドル → その反対側で接続（①と同じ最近接サイド規約）。
      const opposite: Record<string, string> = {
        top: 'bottom',
        bottom: 'top',
        left: 'right',
        right: 'left',
      };
      const sourceHandle = start.handleId ?? (isVertical ? 'bottom' : 'right');
      const targetHandle = opposite[sourceHandle] ?? (isVertical ? 'top' : 'left');

      // 新ノードのロールは開始ノードと同じ（同一レーン）。
      const srcNode = flowData.nodes.find((n) => n.id === start.nodeId);
      const roleId = srcNode?.roleId ?? srcNode?.role?.id;

      // ほぼクリック（動かさず離す）でも空き扱いになるため、生成位置はドロップ座標を
      // ノード中心とみなして左上基準へ補正する。
      props.onCreateConnectedNode({
        sourceNodeId: start.nodeId,
        sourceHandle,
        targetHandle,
        position: { x: flowPos.x - NODE_W / 2, y: flowPos.y - NODE_H / 2 },
        roleId,
      });
    },
    [props, screenToFlowPosition, isVertical, flowData.nodes],
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

  // --- 注釈（付箋・コメント）を新規追加 ---
  // 初期位置は現在表示中のビュー中央付近（screenToFlowPosition でラッパー中心を flow 座標へ）。
  // 取得できなければ固定オフセットにフォールバック。複数追加で重ならないよう少しずつずらす。
  const handleAddAnnotation = useCallback(
    (kind: FlowAnnotation['kind'], icon?: string) => {
      // アイコン注釈は小ノード（ICON_ANNOTATION_SIZE）、スコープは広い矩形、
      // 付箋/コメントは箱サイズで左上補正する。
      const w = kind === 'ICON' ? ICON_ANNOTATION_SIZE : kind === 'SCOPE' ? SCOPE_DEFAULT_W : ANNOTATION_W;
      const h = kind === 'ICON' ? ICON_ANNOTATION_SIZE : kind === 'SCOPE' ? SCOPE_DEFAULT_H : ANNOTATION_MIN_H;
      let cx = 80;
      let cy = 80;
      const root = wrapperRef.current;
      if (root) {
        const rect = root.getBoundingClientRect();
        try {
          const p = screenToFlowPosition({
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          });
          // ノード中心ではなく左上基準に置く（描画幅ぶん左へ寄せる）。
          cx = p.x - w / 2;
          cy = p.y - h / 2;
        } catch {
          /* viewport 未確定時は固定オフセット */
        }
      }
      // 既存注釈数に応じて少しずらし、新規が重ならないようにする。
      const jitter = (props.annotations?.length ?? 0) % 6;
      props.onAddAnnotation?.(kind, {
        positionX: cx + jitter * 16,
        positionY: cy + jitter * 16,
        ...(icon ? { icon } : {}),
      });
    },
    [screenToFlowPosition, props],
  );

  // --- 画像ファイルのドラッグ＆ドロップ: キャンバスへ画像を貼り付ける ---
  const onDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(async (e: ReactDragEvent) => {
    e.preventDefault();
    const file = firstImageFile(Array.from(e.dataTransfer.files));
    if (!file) return;
    const pid = props.projectId;
    if (!pid) return;
    const pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    try {
      const att = await uploadProjectFile(pid, file);
      const created = await diagramElementApi.create(pid, {
        diagramKind: 'FLOW',
        diagramId: flowId,
        type: 'IMAGE',
        attachmentId: att.id,
        positionX: pos.x,
        positionY: pos.y,
        width: 200,
        height: 150,
      });
      setImageElements((prev) => [...prev, created]);
      // 逆操作＝この id を削除。redo は同 id で upsert（id 保持で復活）。
      recordImageOpRef.current(
        { type: 'upsert', elements: [toRestoreInput(created)] },
        { type: 'delete', ids: [created.id] },
      );
    } catch {
      /* 作成失敗は致命ではない */
    }
  }, [props.projectId, flowId, screenToFlowPosition]);

  // --- ドロップ先レーン（ロール）判定の共通ロジック ---
  // content ノードの左上座標とサイズ・現在の roleId を受け取り、ドロップ位置が含まれる
  // 帯（レーン）を探して、変更すべき roleId を返す（変更不要なら undefined）。
  // horizontal は Y で帯[top, top+height]、vertical は X で列[left, left+width]。
  // 帯の外（上端より上 / 下端より下）に落ちた場合は最近傍の帯にスナップする。
  // 未割当レーンは roleId を持たない（割当解除はここではしない）ので、実ロールの帯に
  // 落ちた場合かつ現状と異なる場合のみ新しい roleId を返す。
  // 単一ドラッグ・複数選択ドラッグの双方で同じ判定を使い、挙動を一致させる。
  const resolveDroppedRoleId = useCallback(
    (left: number, top: number, w: number, h: number, currentRoleId: string | null): string | undefined => {
      if (bands.lanes.length === 0) return undefined;
      const centerX = left + w / 2;
      const centerY = top + h / 2;
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
      const isRealRole = roles.some((r) => r.id === hit!.roleId);
      if (isRealRole && hit!.roleId !== currentRoleId) {
        return hit!.roleId;
      }
      return undefined;
    },
    [bands, isVertical, roles],
  );

  // --- ドラッグ停止: 自由配置座標を保存 + ドロップ先レーンへロール再割当 ---
  // 旧実装は order/roleId だけ保存していたため位置がスナップバックしていた。
  // 新実装はドロップした左上座標を positionX/positionY としてそのまま保存する。
  const handleNodeDragStop = useCallback(
    (_evt: unknown, node: Node) => {
      // 注釈ノード（付箋・コメント）は別系統。位置だけ保存して以降の flow ノード処理には進めない。
      if (node.type === 'annotation') {
        props.onUpdateAnnotation?.(node.id, {
          positionX: node.position.x,
          positionY: node.position.y,
        });
        return;
      }
      // 画像要素ノードは DiagramElement API へ位置を保存する（flow ノード系とは独立）。
      // 整形バッチ（onTidyNodes）には渡さず、常にこのブランチで完結する。
      if (node.type === 'imageElement') {
        const np = { positionX: node.position.x, positionY: node.position.y };
        void diagramElementApi.patch(node.id, np);
        // 逆操作のため移動前座標を ref から同期取得。
        const before = imageElementsRef.current.find((el) => el.id === node.id);
        // ローカル state も更新する。さもないと imageElementRfNodes が旧座標のままになり、
        // 次の allRfNodes 再同期(setDragNodes)でドラッグ位置が巻き戻る（スナップバック）。
        setImageElements((prev) => prev.map((el) => (el.id === node.id ? { ...el, ...np } : el)));
        if (before) {
          const beforeInput = toRestoreInput(before);
          recordImageOpRef.current(
            { type: 'upsert', elements: [{ ...beforeInput, ...np }] },
            { type: 'upsert', elements: [beforeInput] },
          );
        }
        return;
      }
      if (node.type !== 'content') return;

      const w = node.width ?? NODE_W;
      const h = node.height ?? NODE_H;
      // ドロップした左上座標（= サーバ保存値）
      const left = node.position.x;
      const top = node.position.y;

      const patch: NodeUpdatePatch = {
        positionX: left,
        positionY: top,
      };

      const src = flowData.nodes.find((n) => n.id === node.id);
      const currentRoleId = src?.roleId ?? src?.role?.id ?? null;
      const nextRoleId = resolveDroppedRoleId(left, top, w, h, currentRoleId);
      if (nextRoleId !== undefined) {
        patch.roleId = nextRoleId;
      }

      props.onUpdateNode?.(node.id, patch);
      // ローカル位置はドラッグ済みの座標のまま。保存後の再取得で同座標に戻るため
      // スナップバックは起きない。
    },
    [resolveDroppedRoleId, flowData.nodes, props],
  );

  // 複数選択ドラッグの保存。React Flow は複数ノードを (event, nodes) で渡すので、
  // 各ノードについて handleNodeDragStop と同じ保存経路で永続化する。
  // 単一ドラッグと同様に、各 content ノードはドロップ先レーンへのロール再割当
  // (patch.roleId) も含めて保存し、挙動の不一致（位置だけ動いてレーンが変わらない /
  // 再取得・整形・縦横転置で元レーンへ戻る）を防ぐ。
  const handleSelectionDragStop = useCallback(
    (_evt: unknown, nodes: Node[]) => {
      // 複数選択ドラッグ内の画像移動は 1 つの op にまとめる（1 回の ⌘Z でまとめて戻す）。
      const imgDoEls: DiagramElementRestoreInput[] = [];
      const imgUndoEls: DiagramElementRestoreInput[] = [];
      for (const node of nodes) {
        if (node.type === 'content') {
          const w = node.width ?? NODE_W;
          const h = node.height ?? NODE_H;
          const left = node.position.x;
          const top = node.position.y;
          const patch: NodeUpdatePatch = {
            positionX: left,
            positionY: top,
          };
          const src = flowData.nodes.find((n) => n.id === node.id);
          const currentRoleId = src?.roleId ?? src?.role?.id ?? null;
          const nextRoleId = resolveDroppedRoleId(left, top, w, h, currentRoleId);
          if (nextRoleId !== undefined) {
            patch.roleId = nextRoleId;
          }
          props.onUpdateNode?.(node.id, patch);
        } else if (node.type === 'annotation') {
          props.onUpdateAnnotation?.(node.id, {
            positionX: node.position.x,
            positionY: node.position.y,
          });
        } else if (node.type === 'imageElement') {
          // 画像要素は DiagramElement API へ位置を保存する（flow バッチとは独立）。
          const np = { positionX: node.position.x, positionY: node.position.y };
          void diagramElementApi.patch(node.id, np);
          const before = imageElementsRef.current.find((el) => el.id === node.id);
          setImageElements((prev) => prev.map((el) => (el.id === node.id ? { ...el, ...np } : el)));
          if (before) {
            const beforeInput = toRestoreInput(before);
            imgDoEls.push({ ...beforeInput, ...np });
            imgUndoEls.push(beforeInput);
          }
        }
      }
      if (imgDoEls.length > 0) {
        recordImageOpRef.current(
          { type: 'upsert', elements: imgDoEls },
          { type: 'upsert', elements: imgUndoEls },
        );
      }
    },
    [resolveDroppedRoleId, flowData.nodes, props],
  );

  // 与えられたレイアウト（computeFlowLayout の結果）を一括保存ペイロードへ変換する。
  // ノード位置（中心→左上）と、最近接サイド接続ハンドル（edges）を同一リクエストで送る。
  const persistLayout = useCallback(
    (layout: FlowLayoutView) => {
      const positions: NodePositionPatch[] = layout.nodes.map((pn) => ({
        id: pn.id,
        // computeFlowLayout は中心座標 → サーバ保存は左上基準
        positionX: pn.x - pn.width / 2,
        positionY: pn.y - pn.height / 2,
        // 未割当レーンの roleId はノードへ書き戻さない（null のまま）
        roleId: roles.some((r) => r.id === pn.roleId) ? pn.roleId : null,
        order: typeof pn.order === 'number' ? pn.order : undefined,
      }));
      const edges: EdgeHandlePatch[] = layout.edges.map((e) => ({
        id: e.id,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      }));
      // 保存往復（PUT + 再取得）の完了まで layoutSaving を立て、整形/縦横の連打を防ぐ。
      const pending = props.onTidyNodes?.(positions, edges);
      if (pending) {
        setLayoutSaving(true);
        void Promise.resolve(pending).finally(() => setLayoutSaving(false));
      }
    },
    [roles, props],
  );

  // --- 「整形」: computeFlowLayout で綺麗な座標を作り、一括保存して再取得 ---
  // ぐちゃぐちゃになった自由配置を、ロール×前後関係の決定的レイアウトへ戻す安全網。
  const handleTidy = useCallback(() => {
    if (layoutSaving) return; // 前回の整形/切替の保存往復が完了するまで受け付けない
    setMenu(null);
    persistLayout(tidyLayout);
  }, [tidyLayout, persistLayout, layoutSaving]);

  // --- 向きトグル: 「整形」ではなく座標変換（転置）で手動配置を保持する ---
  // 縦↔横の切替で再整形すると、手で並べた配置が毎回潰れてしまう。
  // そこで各ノード中心の x↔y を入れ替えて図を転置し、相対配置をそのまま新しい向きへ移す。
  // （横ではロール帯が上下／縦では左右に並ぶため、中心の入替でロール順・前後関係が保たれる）
  // エッジの接続ハンドルだけは転置後の中心から最近接サイドへ取り直す。
  // localStorage 永続化は applyOrientation が担う。
  const toggleOrientation = useCallback(() => {
    // 前回の切替/整形の保存往復（PUT + 再取得）が完了するまで受け付けない。
    // 完了前に実行すると effectivePositions（flowData 由来＝旧世代）と
    // 楽観更新済みの注釈座標（新世代）を突き合わせ、壊れた注釈配置を永続化してしまう。
    if (layoutSaving) return;
    const next: FlowOrientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    applyOrientation(next);
    // 縦横切替は「ノード実サイズ＋矢印前後関係を考慮した再整形」で並べ直す。
    // 単純な座標転置だとノードは回転せず幅×高さのままのため、サイズの違うノードや
    // 並列分岐が重なってしまう。computeFlowLayout は layoutInputNodes の width/height と
    // 運ぶ情報チップ幅を考慮するので、新しい向きでも重なりなく配置できる。
    const relaid = computeFlowLayout(layoutInputNodes, layoutInputEdges, laneRoles, {
      orientation: next,
      laneHeightOverrides,
    } as Parameters<typeof computeFlowLayout>[3]) as unknown as FlowLayoutView;

    // --- 自由配置要素（画像 / ICON注釈）をレーン相対で新しい向きへ移し替える ---
    // 旧/新のレーン帯（横断方向）＋ time軸コンテンツ範囲（ノード中心の最小〜最大）を用意し、
    // 「どのロールのどこにいたか」の相対位置を新しい向きのレーン幾何へ写像する。
    const oldLaneBands = bands.lanes.map((l) => ({
      roleId: l.roleId,
      crossStart: (orientation === 'horizontal' ? l.top : l.left) ?? 0,
      crossThickness: (orientation === 'horizontal' ? l.height : l.width) ?? 0,
    }));
    const newLaneBands = relaid.lanes.map((l) => ({
      roleId: l.roleId,
      crossStart: (next === 'horizontal' ? l.top : l.left) ?? 0,
      crossThickness: (next === 'horizontal' ? l.height : l.width) ?? 0,
    }));
    let oldMainMin = Infinity;
    let oldMainMax = -Infinity;
    for (const n of flowData.nodes) {
      const pos = effectivePositions.get(n.id) ?? { x: 0, y: 0 };
      const w = typeof n.width === 'number' && n.width > 0 ? n.width : NODE_W;
      const h = typeof n.height === 'number' && n.height > 0 ? n.height : NODE_H;
      const c = orientation === 'horizontal' ? pos.x + w / 2 : pos.y + h / 2;
      oldMainMin = Math.min(oldMainMin, c);
      oldMainMax = Math.max(oldMainMax, c);
    }
    let newMainMin = Infinity;
    let newMainMax = -Infinity;
    for (const pn of relaid.nodes) {
      const c = next === 'horizontal' ? pn.x : pn.y;
      newMainMin = Math.min(newMainMin, c);
      newMainMax = Math.max(newMainMax, c);
    }
    const transposeFree = (center: { x: number; y: number }, w: number, h: number) =>
      transposeFreeElement({
        center,
        size: { w, h },
        fromOrientation: orientation,
        toOrientation: next,
        oldLanes: oldLaneBands,
        newLanes: newLaneBands,
        oldMain: { min: oldMainMin, max: oldMainMax },
        newMain: { min: newMainMin, max: newMainMax },
      });

    // 画像要素: レーン相対で移し替えて patch（レーンが取れなければ据え置き）。
    if (imageElements.length > 0) {
      const tDoEls: DiagramElementRestoreInput[] = [];
      const tUndoEls: DiagramElementRestoreInput[] = [];
      const movedImages = imageElements.map((el) => {
        const w = el.width ?? 200;
        const h = el.height ?? 150;
        const np = transposeFree({ x: el.positionX + w / 2, y: el.positionY + h / 2 }, w, h);
        if (!np) return el;
        void diagramElementApi.patch(el.id, np);
        const beforeInput = toRestoreInput(el);
        tDoEls.push({ ...beforeInput, ...np });
        tUndoEls.push(beforeInput);
        return { ...el, ...np };
      });
      setImageElements(movedImages);
      // 転置で実際に動いた画像だけを 1 op に束ねる（1 回の ⌘Z でまとめて戻す）。
      if (tDoEls.length > 0) {
        recordImageOpRef.current(
          { type: 'upsert', elements: tDoEls },
          { type: 'upsert', elements: tUndoEls },
        );
      }
    }

    // --- 注釈（付箋/コメント/アイコン/スコープ）のアンカー相対追従 ---
    // flowData.nodes は再整形で動くが annotations は絶対座標のため置き去りになる。
    // 切替の直前に各注釈の「アンカー」＝最寄りのノード（矩形中心）またはエッジ（両端
    // ノード中心の中点）を決め、アンカーからの相対オフセット (dx,dy) を記録 →
    // 切替後のアンカー新座標に、縦横転置へ合わせて入れ替えたオフセット (dy,dx) を足して
    // 再配置する（オフセットが極端に大きい場合は方向を保ったまま 200px 程度にクランプ）。
    // SCOPE 囲みは「切替前に矩形へ中心が入っていたノード集合」の新バウンディングボックス
    // ＋元のパディング（転置で 左右↔上下 を入替）で再配置・リサイズする。
    // 各注釈は onUpdateAnnotation（楽観更新＋PATCH を並列 fire）で即時反映・永続化する。
    // 注釈は従来どおり Undo/Redo の対象外。
    const annos = props.annotations ?? [];
    if (annos.length > 0 && props.onUpdateAnnotation) {
      // 切替前のノード中心・半サイズ（保存座標 or シード座標 + 実サイズ）
      const oldCenter = new Map<string, { x: number; y: number }>();
      const oldHalf = new Map<string, { hw: number; hh: number }>();
      for (const n of flowData.nodes) {
        const pos = effectivePositions.get(n.id) ?? { x: 0, y: 0 };
        const w = typeof n.width === 'number' && n.width > 0 ? n.width : NODE_W;
        const h = typeof n.height === 'number' && n.height > 0 ? n.height : NODE_H;
        oldCenter.set(n.id, { x: pos.x + w / 2, y: pos.y + h / 2 });
        oldHalf.set(n.id, { hw: w / 2, hh: h / 2 });
      }
      // 切替後のノード中心・半サイズ（computeFlowLayout は中心座標を返す）
      const newCenter = new Map<string, { x: number; y: number }>();
      const newHalf = new Map<string, { hw: number; hh: number }>();
      for (const pn of relaid.nodes) {
        newCenter.set(pn.id, { x: pn.x, y: pn.y });
        newHalf.set(pn.id, { hw: pn.width / 2, hh: pn.height / 2 });
      }
      // アンカー候補 = 全ノード中心 + 全エッジ中点。旧/新座標のペアで持つ。
      const anchors: Array<{ ox: number; oy: number; nx: number; ny: number }> = [];
      for (const [id, oc] of Array.from(oldCenter.entries())) {
        const nc = newCenter.get(id);
        if (nc) anchors.push({ ox: oc.x, oy: oc.y, nx: nc.x, ny: nc.y });
      }
      for (const e of flowData.edges) {
        const so = oldCenter.get(e.sourceNodeId);
        const to = oldCenter.get(e.targetNodeId);
        const sn = newCenter.get(e.sourceNodeId);
        const tn = newCenter.get(e.targetNodeId);
        if (so && to && sn && tn) {
          anchors.push({
            ox: (so.x + to.x) / 2,
            oy: (so.y + to.y) / 2,
            nx: (sn.x + tn.x) / 2,
            ny: (sn.y + tn.y) / 2,
          });
        }
      }
      if (anchors.length > 0) {
        // アンカーから離れすぎた注釈は、方向を保ったまま 200px 程度に寄せる。
        const MAX_ANNOTATION_OFFSET = 200;
        // SCOPE 再配置時に最低限確保するパディング（元が負でも枠がノード群を覆う）。
        const SCOPE_MIN_PAD = 12;
        for (const a of annos) {
          const { w, h } = annotationSizeOf(a);
          if (a.kind !== 'SCOPE') {
            // ICON(DB/人/アイコン)・付箋(STICKY)・コメント(COMMENT)はレーン相対で移し替える。
            // レーンが取れない場合のみ下の最寄りアンカー追従へフォールバックする。
            // （SCOPE 囲みは下の専用ロジック＝メンバーノードの新バウンディングボックスで再配置。）
            const np = transposeFree({ x: a.positionX + w / 2, y: a.positionY + h / 2 }, w, h);
            if (np) {
              props.onUpdateAnnotation(a.id, np);
              continue;
            }
          }
          if (a.kind === 'SCOPE') {
            // 囲みノード集合 = 切替前に SCOPE 矩形へ中心が入っていたノード
            const memberIds: string[] = [];
            for (const [id, c] of Array.from(oldCenter.entries())) {
              if (
                c.x >= a.positionX &&
                c.x <= a.positionX + w &&
                c.y >= a.positionY &&
                c.y <= a.positionY + h
              ) {
                memberIds.push(id);
              }
            }
            if (memberIds.length > 0) {
              // 旧/新バウンディングボックス（メンバーノード矩形の外接）
              let oL = Infinity;
              let oT = Infinity;
              let oR = -Infinity;
              let oB = -Infinity;
              let nL = Infinity;
              let nT = Infinity;
              let nR = -Infinity;
              let nB = -Infinity;
              let complete = true;
              for (const id of memberIds) {
                const oc = oldCenter.get(id)!;
                const oh = oldHalf.get(id)!;
                const nc = newCenter.get(id);
                const nh = newHalf.get(id);
                if (!nc || !nh) {
                  complete = false;
                  break;
                }
                oL = Math.min(oL, oc.x - oh.hw);
                oT = Math.min(oT, oc.y - oh.hh);
                oR = Math.max(oR, oc.x + oh.hw);
                oB = Math.max(oB, oc.y + oh.hh);
                nL = Math.min(nL, nc.x - nh.hw);
                nT = Math.min(nT, nc.y - nh.hh);
                nR = Math.max(nR, nc.x + nh.hw);
                nB = Math.max(nB, nc.y + nh.hh);
              }
              if (complete) {
                // 元のパディング（負なら最小値へクランプ）。転置に合わせて 左右↔上下 を入れ替える。
                const padL = Math.max(SCOPE_MIN_PAD, oL - a.positionX);
                const padT = Math.max(SCOPE_MIN_PAD, oT - a.positionY);
                const padR = Math.max(SCOPE_MIN_PAD, a.positionX + w - oR);
                const padB = Math.max(SCOPE_MIN_PAD, a.positionY + h - oB);
                const newLeft = nL - padT;
                const newTop = nT - padL;
                const newRight = nR + padB;
                const newBottom = nB + padR;
                props.onUpdateAnnotation(a.id, {
                  positionX: Math.round(newLeft),
                  positionY: Math.round(newTop),
                  width: Math.round(newRight - newLeft),
                  height: Math.round(newBottom - newTop),
                });
                continue;
              }
            }
            // メンバー 0 件の SCOPE は付箋と同じ最寄りアンカー追従（サイズ維持）へフォールバック
          }
          // 最寄りアンカー（ノード中心 or エッジ中点のうち、注釈中心に最も近いもの）
          const cx = a.positionX + w / 2;
          const cy = a.positionY + h / 2;
          let best = anchors[0];
          let bestD = Infinity;
          for (const an of anchors) {
            const d = (an.ox - cx) * (an.ox - cx) + (an.oy - cy) * (an.oy - cy);
            if (d < bestD) {
              bestD = d;
              best = an;
            }
          }
          // 相対オフセット (dx,dy) を縦横転置に合わせて (dy,dx) に入れ替える
          let offX = cy - best.oy;
          let offY = cx - best.ox;
          const len = Math.hypot(offX, offY);
          if (len > MAX_ANNOTATION_OFFSET) {
            offX = (offX / len) * MAX_ANNOTATION_OFFSET;
            offY = (offY / len) * MAX_ANNOTATION_OFFSET;
          }
          props.onUpdateAnnotation(a.id, {
            positionX: Math.round(best.nx + offX - w / 2),
            positionY: Math.round(best.ny + offY - h / 2),
          });
        }
      }
    }

    persistLayout(relaid);
  }, [
    orientation,
    applyOrientation,
    layoutInputNodes,
    layoutInputEdges,
    laneRoles,
    laneHeightOverrides,
    persistLayout,
    flowData.nodes,
    flowData.edges,
    effectivePositions,
    bands,
    imageElements,
    props,
    layoutSaving,
  ]);

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <div
      ref={wrapperRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={
        isFullscreen
          ? 'fixed inset-0 z-50 bg-white'
          : 'relative w-full h-full bg-white'
      }
    >
      <ReactFlow
        nodes={dragNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onReconnect={onReconnect}
        onNodesChange={onNodesChange}
        deleteKeyCode={null}
        nodesDraggable={!props.embedded}
        nodesConnectable={!props.embedded}
        elementsSelectable={!props.embedded}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={GhostConnectionLine}
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        panOnScroll
        zoomOnScroll={false}
        // 操作モード:
        //   選択モード … 左ドラッグ=範囲選択（＋ノード移動）/ 中・右ドラッグ=パン / Space+左ドラッグ=パン
        //   移動モード … 左ドラッグ=パン
        // embedded（比較ビュー）は従来どおり左ドラッグで自由にパン。
        selectionOnDrag={!props.embedded && interactMode === 'select'}
        panOnDrag={props.embedded ? true : interactMode === 'move' ? true : [1, 2]}
        panActivationKeyCode={'Space'}
        selectionMode={SelectionMode.Partial}
        proOptions={{ hideAttribution: true }}
        onNodeDragStop={handleNodeDragStop}
        onSelectionDragStop={handleSelectionDragStop}
        onPaneClick={() => { setSelectedEdgeId(null); setSelectedScopeId(null); setPanel(null); closeMenu(); }}
        onEdgeClick={(_, edge) => { if (props.embedded) return; setSelectedEdgeId(edge.id); }}
        onNodeClick={(_, node) => {
          if (props.embedded) return;
          if (node.type === 'content') {
            // ノードプロパティと SCOPE 入出力パネルは右サイドを取り合うため排他にする。
            setSelectedScopeId(null);
            setEditingNodeId(node.id);
            // 添付・ナレッジグラフは NodePropertyPanel 内の「添付・ナレッジグラフ」ボタンで開く。
            // ここでは inspector を開かず、編集パネルのみ開く（右辺衝突回避）。
            return;
          }
          // imageElement クリックはドラッグ/リサイズのみ。パネルは開かない。
          if (node.type === 'imageElement') { setPanel(null); return; }
          // SCOPE 囲みクリック → 境界 INPUT/OUTPUT パネルを開く（付箋/コメント/アイコンは対象外）。
          if (node.type === 'annotation') {
            const ann = (props.annotations ?? []).find((a) => a.id === node.id);
            if (ann?.kind === 'SCOPE') {
              setEditingNodeId(null);
              setPanel(null);
              setSelectedScopeId(node.id);
            }
          }
        }}
        onNodeDoubleClick={(_, node) => {
          if (props.embedded) return;
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
          if (props.embedded) return; // 閲覧用埋め込みでは右クリックメニューを出さない
          // レーン・付箋（annotation）は対象外。付箋の削除/編集は AnnotationNode 側で完結する
          if (node.type !== 'content') return;
          e.preventDefault();
          const src = flowData.nodes.find((n) => n.id === node.id);
          setMenu({ kind: 'node', x: e.clientX, y: e.clientY, nodeId: node.id, hasChildFlow: !!src?.hasChildFlow });
        }}
        onEdgeContextMenu={(e, edge) => {
          if (props.embedded) return;
          e.preventDefault();
          setMenu({ kind: 'edge', x: e.clientX, y: e.clientY, edgeId: edge.id });
        }}
        onPaneContextMenu={(e) => {
          if (props.embedded) return;
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

        {!props.embedded && (
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
        )}

        {/* ロール一覧 + フロー途中でのロール追加 + ロール編集（左上、パンくずの下）。
            ヘッダーを掴んで自由に動かせる（box は AddRoleControl 内の DraggableFloating が持つ）。 */}
        {(props.onAddRole || props.onUpdateRole) && (
          <Panel position="top-left" className="mt-14">
            <AddRoleControl
              roles={roles}
              onAddRole={props.onAddRole}
              systems={props.systems}
              onUpdateRole={props.onUpdateRole}
              onDeleteRole={props.onDeleteRole}
              editingRoleId={editingRoleId}
              onEditRole={setEditingRoleId}
            />
          </Panel>
        )}

        {/* ツールバー（右上）: Undo/Redo + 整形 + 縦横トグル + PNG出力 */}
        {!props.embedded && (
        <Panel position="top-right" className="bg-white border border-gray-200 rounded-lg shadow-sm p-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInteractMode((m) => (m === 'select' ? 'move' : 'select'))}
              className="text-gray-700"
              title="選択: ドラッグで範囲選択・ノード移動／移動: ドラッグで画面移動。選択中も Space 押しながらで画面移動"
            >
              {interactMode === 'select' ? (
                <>
                  <MousePointer2 className="w-4 h-4 mr-1" />
                  選択
                </>
              ) : (
                <>
                  <Hand className="w-4 h-4 mr-1" />
                  移動
                </>
              )}
            </Button>
            <span className="mx-0.5 h-5 w-px bg-gray-200" />
            {(props.onUndo || props.onRedo) && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => props.onUndo?.()}
                  disabled={!props.onUndo || !props.canUndo}
                  className="text-gray-700"
                  title="元に戻す（⌘Z / Ctrl+Z）"
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => props.onRedo?.()}
                  disabled={!props.onRedo || !props.canRedo}
                  className="text-gray-700"
                  title="やり直し（⌘⇧Z / Ctrl+Shift+Z）"
                >
                  <Redo2 className="w-4 h-4" />
                </Button>
                <span className="mx-0.5 h-5 w-px bg-gray-200" />
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleTidy}
              disabled={!props.onTidyNodes || flowData.nodes.length === 0 || layoutSaving}
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
              disabled={layoutSaving}
              className="text-gray-700"
              title="スイムレーンの向きを切り替え"
            >
              <RotateCw className="w-4 h-4 mr-1" />
              {isVertical ? '縦' : '横'}
            </Button>
            {/* 注釈（付箋・コメント）追加。flowData.nodes とは別系統で永続化される。 */}
            {props.onAddAnnotation && (
              <>
                <span className="mx-0.5 h-5 w-px bg-gray-200" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddAnnotation('STICKY')}
                  className="text-gray-700"
                  title="メモ（付箋）を追加"
                >
                  <StickyNote className="w-4 h-4 mr-1" />
                  メモ（付箋）
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddAnnotation('COMMENT')}
                  className="text-gray-700"
                  title="コメントを追加"
                >
                  <MessageSquarePlus className="w-4 h-4 mr-1" />
                  コメント
                </Button>
                {/* スコープ囲み: 業務領域を点線/実線の角丸矩形＋背景塗りで囲う（ノードより背面）。 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddAnnotation('SCOPE')}
                  className="text-gray-700"
                  title="スコープ囲み（業務領域を枠で囲む）を追加。ラベルはダブルクリックで編集"
                >
                  <BoxSelect className="w-4 h-4 mr-1" />
                  スコープ
                </Button>
                {/* アイコン注釈: ボタン→小さなパレットでアイコンを選んで追加。 */}
                <div className="relative">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIconPaletteOpen((v) => !v)}
                    className="text-gray-700"
                    title="アイコン注釈を追加"
                  >
                    <Smile className="w-4 h-4 mr-1" />
                    アイコン
                  </Button>
                  {iconPaletteOpen && (
                    <>
                      {/* 背景クリックでパレットを閉じる透明オーバーレイ */}
                      <div
                        className="fixed inset-0 z-30"
                        onClick={() => setIconPaletteOpen(false)}
                      />
                      <div className="absolute left-0 top-full z-40 mt-1 grid grid-cols-4 gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                        {ICON_PALETTE.map((iconName) => {
                          const IconComp = ICON_MAP[iconName];
                          return (
                            <button
                              key={iconName}
                              type="button"
                              title={`${iconName} を追加`}
                              onClick={() => {
                                handleAddAnnotation('ICON', iconName);
                                setIconPaletteOpen(false);
                              }}
                              className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-amber-50 hover:text-amber-600"
                            >
                              <IconComp className="h-5 w-5" />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
                {/* よく使うアイコンのプリセット: DB / 人 をワンクリック配置（kind=ICON）。 */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddAnnotation('ICON', 'Database')}
                  className="text-gray-700"
                  title="DB（データベース）アイコンを追加"
                >
                  <Database className="w-4 h-4 mr-1" />
                  DB
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAddAnnotation('ICON', 'User')}
                  className="text-gray-700"
                  title="人アイコンを追加"
                >
                  <User className="w-4 h-4 mr-1" />
                  人
                </Button>
                <span className="mx-0.5 h-5 w-px bg-gray-200" />
              </>
            )}
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
            <Button
              variant="outline"
              size="sm"
              onClick={toggleFullscreen}
              className="text-gray-700"
              title={isFullscreen ? '全画面を解除（Esc）' : '全画面表示'}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4 mr-1" />
              ) : (
                <Maximize2 className="w-4 h-4 mr-1" />
              )}
              {isFullscreen ? '縮小' : '全画面'}
            </Button>
          </div>
        </Panel>
        )}
      </ReactFlow>

      {/* 左サイド: INPUT/OUTPUT 候補（DFD と共通の情報種別マスタ一覧。折りたたみ可） ④ */}
      {!props.embedded && (
        <InformationTypeSidePanel
          informationTypes={props.informationTypes ?? []}
          onCreateInformationType={props.onCreateInformationType}
        />
      )}

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
          onCreateInformationType={props.onCreateInformationType}
          onOpenAttachments={
            !props.embedded && props.projectId
              ? (nodeId, nodeLabel) => {
                  setEditingNodeId(null);
                  setPanel({ nodeId, nodeLabel });
                }
              : undefined
          }
        />
      )}

      {/* ノードインスペクタパネル（添付ファイル / ナレッジグラフ。NodePropertyPanel の「添付・ナレッジグラフ」ボタン経由で開く） */}
      {!props.embedded && panel && props.projectId && (
        <NodeInspectorPanel
          projectId={props.projectId}
          nodeKind="FLOW_NODE"
          nodeId={panel.nodeId}
          nodeLabel={panel.nodeLabel}
          onClose={() => setPanel(null)}
        />
      )}

      {/* スコープ境界 INPUT/OUTPUT パネル（SCOPE 注釈クリックで表示。
          ノードプロパティが開いている間はそちらを優先する） */}
      {!props.embedded && !editingNodeId && selectedScopeId && (() => {
        const scope = (props.annotations ?? []).find(
          (a) => a.id === selectedScopeId && a.kind === 'SCOPE',
        );
        if (!scope) return null;
        return (
          <ScopeIoPanel
            key={scope.id}
            scope={scope}
            nodes={flowData.nodes}
            edges={flowData.edges}
            positions={effectivePositions}
            onClose={() => setSelectedScopeId(null)}
            onSelectNode={(nodeId) => {
              setSelectedScopeId(null);
              setEditingNodeId(nodeId);
            }}
            onUpdateAnnotation={props.onUpdateAnnotation}
          />
        );
      })()}

      {/* エッジ編集パネル（矢印が選択されている間） */}
      {selectedEdgeId && (() => {
        const edge = flowData.edges.find((e) => e.id === selectedEdgeId);
        if (!edge) return null;
        // source/target ノードのロール種別が HUMAN⇄SYSTEM を跨ぐか。
        // 跨ぐエッジは人とシステムのやり取り＝API が介在しやすいので、
        // パネルの API セクションを上部に目立たせる（未設定/OTHER は HUMAN 扱い）。
        const roleTypeOfNode = (nodeId: string): 'HUMAN' | 'SYSTEM' => {
          const n = flowData.nodes.find((x) => x.id === nodeId);
          const rid = n?.roleId ?? n?.role?.id;
          const t = roles.find((r) => r.id === rid)?.type ?? n?.role?.type;
          return t === 'SYSTEM' ? 'SYSTEM' : 'HUMAN';
        };
        const crossesHumanSystem =
          roleTypeOfNode(edge.sourceNodeId) !== roleTypeOfNode(edge.targetNodeId);
        return (
          <EdgePropertyPanel
            key={selectedEdgeId}
            edge={edge}
            informationTypes={props.informationTypes ?? []}
            apiEndpoints={props.apiEndpoints ?? []}
            onSaveApiLinks={props.onSaveEdgeApiLinks}
            crossesHumanSystem={crossesHumanSystem}
            nodes={flowData.nodes
              .filter((n) => n.type !== 'lane')
              .map((n) => ({ id: n.id, label: n.label }))}
            sourceLabel={flowData.nodes.find((n) => n.id === edge.sourceNodeId)?.label}
            targetLabel={flowData.nodes.find((n) => n.id === edge.targetNodeId)?.label}
            onClose={() => setSelectedEdgeId(null)}
            onUpdateEdge={props.onUpdateEdge}
            onCreateInformationType={props.onCreateInformationType}
            onDelete={
              props.onDeleteEdge
                ? () => {
                    props.onDeleteEdge?.(edge.id);
                    setSelectedEdgeId(null);
                  }
                : undefined
            }
            onRepoint={
              props.onReconnectEdge
                ? (next) => props.onReconnectEdge?.(edge.id, next)
                : undefined
            }
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
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-white border border-gray-200 rounded-lg px-5 py-4 shadow-sm flex flex-col items-center gap-2 text-gray-600">
            <Users className="w-6 h-6 text-blue-600" />
            <span className="text-sm font-medium">まずロール（スイムレーン）を追加してください</span>
            <span className="inline-flex items-center gap-1 text-xs text-blue-600 font-medium">
              <Plus className="w-3.5 h-3.5" />左上の「ロール追加」から
            </span>
          </div>
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

// マスタが空でも各パネルからその場で情報種別を登録できる小フォーム。
// 追加後は呼び出し側が informationTypes を再取得するため、各セレクトに即反映される。
function InlineInformationTypeCreate({
  onCreate,
}: {
  onCreate?: (input: { name: string; category: InformationCategory }) => Promise<InformationType | null>;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<InformationCategory>('INFORMATION');
  const [busy, setBusy] = useState(false);
  if (!onCreate) return null;
  const add = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      await onCreate({ name: n, category });
      setName('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50/60 p-2 space-y-1.5">
      <div className="text-[11px] font-medium text-gray-500">情報種別を新規追加</div>
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="例: 注文データ"
          className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as InformationCategory)}
          className="shrink-0 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {INFORMATION_CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !name.trim()}
          className="shrink-0 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          追加
        </button>
      </div>
    </div>
  );
}

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
// 矢印 × API エンドポイント紐づけ（エッジ編集パネル内セクション）
// プロジェクトの API 一覧（method+path で検索可能）から複数選択し、
// パネルの保存時に onSaveApiLinks（PUT /flow-edges/:id/api-links 全置換）へ渡す。
// ===========================================

/** HTTP メソッド → バッジ配色。 */
const API_METHOD_BADGE: Record<string, string> = {
  GET: 'bg-sky-100 text-sky-700 border-sky-200',
  POST: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  PUT: 'bg-amber-100 text-amber-700 border-amber-200',
  PATCH: 'bg-orange-100 text-orange-700 border-orange-200',
  DELETE: 'bg-rose-100 text-rose-700 border-rose-200',
};

function EdgeApiLinkSection({
  apiEndpoints,
  selectedIds,
  onChange,
  emphasized,
}: {
  apiEndpoints: ApiEndpointOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  /** HUMAN⇄SYSTEM を跨ぐエッジで true。枠を強調し説明を添える。 */
  emphasized: boolean;
}) {
  const [query, setQuery] = useState('');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const byId = useMemo(
    () => new Map(apiEndpoints.map((a) => [a.id, a] as const)),
    [apiEndpoints],
  );
  // method + path + summary を対象に部分一致検索（大文字小文字無視）。
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apiEndpoints;
    return apiEndpoints.filter((a) =>
      `${a.method} ${a.path} ${a.summary ?? ''}`.toLowerCase().includes(q),
    );
  }, [apiEndpoints, query]);

  const toggle = (id: string, checked: boolean) => {
    if (checked) {
      if (!selected.has(id)) onChange([...selectedIds, id]);
    } else {
      onChange(selectedIds.filter((x) => x !== id));
    }
  };

  return (
    <div
      className={`space-y-2 rounded border px-2.5 py-2 ${
        emphasized ? 'border-violet-300 bg-violet-50/60' : 'border-gray-200 bg-gray-50/60'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Plug className={`h-3.5 w-3.5 ${emphasized ? 'text-violet-600' : 'text-gray-500'}`} />
        <span className="text-[11px] font-semibold text-gray-700">API（このやり取りを担うAPI）</span>
        <span className="ml-auto text-[10px] text-gray-400">{selectedIds.length} 件</span>
      </div>
      {emphasized && (
        <p className="text-[10px] leading-snug text-violet-700">
          人⇄システムを跨ぐ矢印です。対応するAPIエンドポイントを紐づけましょう（任意）。
        </p>
      )}
      {/* 選択済みチップ（✕ で外す） */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedIds.map((id) => {
            const ep = byId.get(id);
            return (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-200 bg-white py-0.5 pl-1.5 pr-1 text-[10px] text-violet-700"
                title={ep ? `${ep.method} ${ep.path}${ep.summary ? `（${ep.summary}）` : ''}` : id}
              >
                <span className="font-bold">{ep?.method ?? 'API'}</span>
                <span className="max-w-[140px] truncate">{ep?.path ?? id}</span>
                <button
                  type="button"
                  onClick={() => toggle(id, false)}
                  className="rounded-full p-0.5 hover:bg-violet-100"
                  title="紐づけを外す"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {apiEndpoints.length === 0 ? (
        <p className="text-[10px] text-gray-400">
          プロジェクトにAPIエンドポイントが登録されていません（コードカタログから抽出できます）。
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="method / path で検索"
              className="w-full rounded border border-gray-300 bg-white py-1 pl-6 pr-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          <div className="max-h-40 divide-y divide-gray-100 overflow-auto rounded border border-gray-200 bg-white">
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-[10px] text-gray-400">該当するAPIがありません。</p>
            ) : (
              filtered.map((ep) => {
                const checked = selected.has(ep.id);
                const badge =
                  API_METHOD_BADGE[ep.method?.toUpperCase() ?? ''] ??
                  'bg-gray-100 text-gray-600 border-gray-200';
                return (
                  <label
                    key={ep.id}
                    className="flex cursor-pointer items-center gap-1.5 px-2 py-1 hover:bg-violet-50/50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(ep.id, e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    <span className={`shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold ${badge}`}>
                      {ep.method}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-[11px] text-gray-800"
                      title={`${ep.path}${ep.summary ? `（${ep.summary}）` : ''}`}
                    >
                      {ep.path}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </>
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
  nodes,
  sourceLabel,
  targetLabel,
  apiEndpoints,
  onSaveApiLinks,
  crossesHumanSystem,
  onClose,
  onUpdateEdge,
  onRepoint,
  onReverse,
  onDelete,
  onCreateInformationType,
}: {
  edge: FlowDataEdge;
  informationTypes: InformationType[];
  /** 付け替え先候補（このフローの処理ノード）。接続元/接続先のセレクトに出す。 */
  nodes: Array<{ id: string; label: string }>;
  sourceLabel?: string;
  targetLabel?: string;
  /** プロジェクトの API エンドポイント一覧（API セクションの選択肢）。 */
  apiEndpoints?: ApiEndpointOption[];
  /** 矢印に紐づく API を全置換保存する（保存時に変化があったときのみ呼ぶ）。 */
  onSaveApiLinks?: (edgeId: string, apiEndpointIds: string[]) => Promise<void> | void;
  /** source/target のロール種別が HUMAN⇄SYSTEM を跨ぐか（API セクションを上部に強調表示）。 */
  crossesHumanSystem?: boolean;
  onClose: () => void;
  /** この矢印を削除する。 */
  onDelete?: () => void;
  onUpdateEdge?: (
    edgeId: string,
    patch: {
      informationTypeId?: string | null;
      label?: string;
      pathStyle?: string | null;
      labelT?: number | null;
      infoT?: number | null;
    },
  ) => Promise<void> | void;
  /** 矢印の接続元/接続先ノードを付け替える（ドラッグに頼らず select で確実に編集）。 */
  onRepoint?: (next: {
    sourceNodeId: string;
    targetNodeId: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }) => void;
  onReverse?: () => void;
  onCreateInformationType?: (input: {
    name: string;
    category: InformationCategory;
  }) => Promise<InformationType | null>;
}) {
  const [informationTypeId, setInformationTypeId] = useState<string>(
    edge.informationTypeId ?? '',
  );
  const [label, setLabel] = useState<string>(edge.label ?? '');
  // 紐づく API（複数選択）。保存時に初期値から変わっていれば全置換保存する。
  const initialApiIds = useMemo(
    () => (edge.apiLinks ?? []).map((l) => l.apiEndpointId),
    [edge.apiLinks],
  );
  const [apiIds, setApiIds] = useState<string[]>(initialApiIds);

  const initialInfoId = edge.informationTypeId ?? '';
  const initialLabel = edge.label ?? '';

  // 情報種別 / ラベルが初期値から変わったぶんだけ送る（informationTypeId は '' → null）。
  // API 紐づけは別エンドポイント（PUT /flow-edges/:id/api-links）へ、変化時のみ全置換保存。
  const save = useCallback(() => {
    if (onSaveApiLinks) {
      const sameIdSet =
        apiIds.length === initialApiIds.length &&
        [...apiIds].sort().join(' ') === [...initialApiIds].sort().join(' ');
      if (!sameIdSet) void onSaveApiLinks(edge.id, apiIds);
    }
    if (!onUpdateEdge) return;
    const patch: { informationTypeId?: string | null; label?: string } = {};
    if (informationTypeId !== initialInfoId) {
      patch.informationTypeId = informationTypeId === '' ? null : informationTypeId;
    }
    if (label !== initialLabel) patch.label = label;
    if (patch.informationTypeId === undefined && patch.label === undefined) return;
    void onUpdateEdge(edge.id, patch);
  }, [
    onUpdateEdge,
    edge.id,
    informationTypeId,
    label,
    initialInfoId,
    initialLabel,
    onSaveApiLinks,
    apiIds,
    initialApiIds,
  ]);

  // API セクション（選択UI）。HUMAN⇄SYSTEM を跨ぐ矢印では上部に強調表示する。
  const apiSection = onSaveApiLinks ? (
    <EdgeApiLinkSection
      apiEndpoints={apiEndpoints ?? []}
      selectedIds={apiIds}
      onChange={setApiIds}
      emphasized={!!crossesHumanSystem}
    />
  ) : null;

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
        {/* HUMAN⇄SYSTEM を跨ぐ矢印では API セクションを最上部に目立たせる。 */}
        {crossesHumanSystem && apiSection}

        {/* 接続元 → 接続先（select で付け替え可能。ドラッグに頼らない確実な編集）。 */}
        {onRepoint ? (
          <div className="space-y-2 rounded border border-gray-200 bg-gray-50 px-3 py-2">
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">接続元（起点）</label>
              <select
                value={edge.sourceNodeId}
                onChange={(e) =>
                  onRepoint({
                    sourceNodeId: e.target.value,
                    targetNodeId: edge.targetNodeId,
                    sourceHandle: edge.sourceHandle ?? null,
                    targetHandle: edge.targetHandle ?? null,
                  })
                }
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id} disabled={n.id === edge.targetNodeId}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-center">
              <ArrowRight className="h-3.5 w-3.5 rotate-90 text-gray-400" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-500 mb-1">接続先（終点・矢印の先）</label>
              <select
                value={edge.targetNodeId}
                onChange={(e) =>
                  onRepoint({
                    sourceNodeId: edge.sourceNodeId,
                    targetNodeId: e.target.value,
                    sourceHandle: edge.sourceHandle ?? null,
                    targetHandle: edge.targetHandle ?? null,
                  })
                }
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id} disabled={n.id === edge.sourceNodeId}>
                    {n.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-gray-400">
              運ぶ情報は、起点ノードの OUTPUT・終点ノードの INPUT になります。
            </p>
          </div>
        ) : (
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
        )}

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
          <div className="mt-1.5">
            <InlineInformationTypeCreate onCreate={onCreateInformationType} />
          </div>
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

        {onUpdateEdge && (
          <div>
            <label className="block text-[11px] font-medium text-gray-500 mb-1">線の形</label>
            <div className="grid grid-cols-3 gap-1">
              {([
                { v: 'smoothstep', label: '角ばり' },
                { v: 'bezier', label: '曲線' },
                { v: 'straight', label: '直線' },
              ] as const).map((opt) => {
                const active = (edge.pathStyle ?? 'smoothstep') === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => onUpdateEdge(edge.id, { pathStyle: opt.v })}
                    className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                      active
                        ? 'border-blue-500 bg-blue-50 text-blue-700 font-medium'
                        : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 跨がない矢印でも API は紐づけ可能（通常位置に表示）。 */}
        {!crossesHumanSystem && apiSection}

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

        {onDelete && (
          <button
            type="button"
            onClick={() => {
              onDelete();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50"
            title="この矢印を削除します（Delete / Backspace キーでも削除できます）"
          >
            <Trash2 className="h-3.5 w-3.5" />
            矢印を削除
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
  onCreateInformationType,
  onFetchNodeLinks,
  onCreateNodeLink,
  onDeleteNodeLink,
  onFetchFlowNodes,
  onOpenAttachments,
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
  onCreateInformationType?: (input: {
    name: string;
    category: InformationCategory;
  }) => Promise<InformationType | null>;
  onFetchNodeLinks?: (nodeId: string) => Promise<NodeLinksResult>;
  onCreateNodeLink?: (
    nodeId: string,
    input: { direction: FlowLinkDirection; targetFlowId: string; targetNodeId?: string; label?: string },
  ) => Promise<void>;
  onDeleteNodeLink?: (linkId: string) => Promise<void>;
  onFetchFlowNodes?: (flowId: string) => Promise<Array<{ id: string; label: string }>>;
  /** 添付ファイル / ナレッジグラフ inspector を開く（embedded or projectId 未設定時は undefined）。 */
  onOpenAttachments?: (nodeId: string, nodeLabel: string) => void;
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
        <div className="flex items-center gap-1">
          {onOpenAttachments && (
            <button
              type="button"
              onClick={() => onOpenAttachments(node.id, node.label ?? '')}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-gray-100 text-gray-600"
              title="添付・ナレッジグラフ"
            >
              <Paperclip className="w-3.5 h-3.5" />
              添付・ナレッジグラフ
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-500"
            title="閉じる"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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

        <InlineInformationTypeCreate onCreate={onCreateInformationType} />

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

// ===========================================
// スコープ境界 INPUT/OUTPUT パネル（右サイドバー）
// SCOPE 注釈をクリック選択すると表示。内側ノード集合（中心が SCOPE 矩形内）を求め、
// 境界をまたぐ矢印を「受け取り(INPUT)=外→内」「出力(OUTPUT)=内→外」に分けて一覧する。
// これで「この囲みが何を受け取り何を出すか」が一目で分かる。
// ===========================================

function ScopeIoPanel({
  scope,
  nodes,
  edges,
  positions,
  onClose,
  onSelectNode,
  onUpdateAnnotation,
}: {
  scope: FlowAnnotation;
  nodes: FlowDataNode[];
  edges: FlowDataEdge[];
  /** 各ノードの実効左上座標（保存値 or 整形シード）。内外判定に使う。 */
  positions: Map<string, { x: number; y: number }>;
  onClose: () => void;
  /** ノード名クリックでそのノードのプロパティを開く（任意）。 */
  onSelectNode?: (nodeId: string) => void;
  /** ラベル（annotation.text）の編集保存（任意。embedded では渡されない）。 */
  onUpdateAnnotation?: (id: string, patch: { text?: string }) => void;
}) {
  // ラベル編集（SCOPE 上のダブルクリックインライン編集と同じ text を編集する別経路）。
  const [label, setLabel] = useState(scope.text ?? '');
  useEffect(() => {
    setLabel(scope.text ?? '');
  }, [scope.text]);

  const { insideNodes, inputs, outputs } = useMemo(() => {
    const { w, h } = annotationSizeOf(scope);
    const right = scope.positionX + w;
    const bottom = scope.positionY + h;
    // 内側ノード集合 = 中心が SCOPE 矩形内のノード
    const inside = new Set<string>();
    for (const n of nodes) {
      const pos = positions.get(n.id) ?? { x: n.positionX, y: n.positionY };
      const nw = typeof n.width === 'number' && n.width > 0 ? n.width : NODE_W;
      const nh = typeof n.height === 'number' && n.height > 0 ? n.height : NODE_H;
      const cx = pos.x + nw / 2;
      const cy = pos.y + nh / 2;
      if (cx >= scope.positionX && cx <= right && cy >= scope.positionY && cy <= bottom) {
        inside.add(n.id);
      }
    }
    return {
      insideNodes: nodes.filter((n) => inside.has(n.id)),
      // 受け取り(INPUT) = 外→内 / 出力(OUTPUT) = 内→外 の境界をまたぐ矢印
      inputs: edges.filter((e) => inside.has(e.targetNodeId) && !inside.has(e.sourceNodeId)),
      outputs: edges.filter((e) => inside.has(e.sourceNodeId) && !inside.has(e.targetNodeId)),
    };
  }, [scope, nodes, edges, positions]);

  const scopeColor = scope.color || SCOPE_DEFAULT_COLOR;
  const labelOf = (nodeId: string) => nodes.find((n) => n.id === nodeId)?.label ?? '不明なノード';

  // ノード名チップ（クリックでそのノードのプロパティを開く）。inner はスコープ色で強調。
  const nodeChip = (nodeId: string, inner: boolean) => (
    <button
      type="button"
      onClick={onSelectNode ? () => onSelectNode(nodeId) : undefined}
      disabled={!onSelectNode}
      title={onSelectNode ? 'クリックでノードのプロパティを開く' : undefined}
      className={`max-w-[120px] truncate rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
        onSelectNode ? 'hover:ring-1 hover:ring-blue-300' : 'cursor-default'
      } ${inner ? '' : 'bg-gray-100 text-gray-700'}`}
      style={inner ? { color: scopeColor, backgroundColor: hexToRgba(scopeColor, 0.12) } : undefined}
    >
      {labelOf(nodeId)}
    </button>
  );

  // 境界をまたぐ矢印 1 本分の行: 「外側ノード名 → 内側ノード名」＋情報種別チップ。
  const edgeRow = (e: FlowDataEdge, direction: 'INPUT' | 'OUTPUT') => {
    const category = e.informationType?.category as InformationCategory | undefined;
    const badgeClass =
      (category && INFO_CATEGORY_BADGE[category]) || 'bg-sky-100 text-sky-700 border-sky-200';
    return (
      <div key={e.id} className="rounded border border-gray-200 px-2 py-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {nodeChip(e.sourceNodeId, direction === 'OUTPUT')}
          <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" />
          {nodeChip(e.targetNodeId, direction === 'INPUT')}
        </div>
        {e.informationType?.name && (
          <div className="mt-1">
            <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${badgeClass}`}>
              {e.informationType.name}
            </span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="absolute top-0 right-0 h-full w-full sm:w-80 bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col animate-in slide-in-from-right duration-200">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-gray-900">
          <span
            className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border-2 border-dashed"
            style={{ borderColor: scopeColor, backgroundColor: hexToRgba(scopeColor, 0.15) }}
          />
          <span className="truncate">スコープ「{scope.text || 'スコープ'}」</span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-500"
          title="閉じる"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {/* ラベル編集（text 空なら図上は「スコープ」とフォールバック表示される） */}
        <div>
          <label className="block text-[11px] font-medium text-gray-500 mb-1">ラベル</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              if (onUpdateAnnotation && label !== (scope.text ?? '')) {
                onUpdateAnnotation(scope.id, { text: label });
              }
            }}
            placeholder="スコープ"
            disabled={!onUpdateAnnotation}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50"
          />
        </div>

        {/* 内側ノード集合（中心が SCOPE 矩形内） */}
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
            <BoxSelect className="h-3.5 w-3.5" style={{ color: scopeColor }} />
            囲んでいるノード
            <span className="text-gray-400">{insideNodes.length}件</span>
          </div>
          {insideNodes.length === 0 ? (
            <div className="text-xs text-gray-400">なし（枠内に中心があるノードがありません）</div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {insideNodes.map((n) => (
                <span key={n.id}>{nodeChip(n.id, true)}</span>
              ))}
            </div>
          )}
        </div>

        {/* 受け取り(INPUT) = 外→内 の矢印一覧 */}
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
            <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" />
            受け取り（INPUT: 外 → 内）
            <span className="text-gray-400">{inputs.length}件</span>
          </div>
          {inputs.length === 0 ? (
            <div className="text-xs text-gray-400">なし</div>
          ) : (
            <div className="space-y-1">{inputs.map((e) => edgeRow(e, 'INPUT'))}</div>
          )}
        </div>

        {/* 出力(OUTPUT) = 内→外 の矢印一覧 */}
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
            <ArrowUpRight className="h-3.5 w-3.5 text-blue-600" />
            出力（OUTPUT: 内 → 外）
            <span className="text-gray-400">{outputs.length}件</span>
          </div>
          {outputs.length === 0 ? (
            <div className="text-xs text-gray-400">なし</div>
          ) : (
            <div className="space-y-1">{outputs.map((e) => edgeRow(e, 'OUTPUT'))}</div>
          )}
        </div>
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
