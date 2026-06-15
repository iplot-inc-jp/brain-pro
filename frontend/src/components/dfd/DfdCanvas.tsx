'use client';

/**
 * DfdCanvas — データフロー図（DFD）を SEC帳票風＋色付きで描画する React Flow キャンバス。
 *
 * SwimlaneCanvas.tsx をミラー（nodeTypes / useNodesState+onNodesChange / toPng / ドラッグ保存）。
 *   - nodeTypes: function=楕円(navy枠/番号+label), external=四角(slate), datastore=開いた四角「=」(emerald)。
 *   - edgeTypes: ラベル付き矢印（dataItem ＋ 情報種別チップ）。
 *   - 破線楕円のシステム境界（背景レイヤ）＋凡例パネル＋帳票ヘッダ/フッタ。
 *   - ノードドラッグ → onSavePositions（左上座標を positionX/Y で保存）。
 *   - onConnect → onAddFlow（dataItem は仮入力 → 後で編集）。
 *   - ツールバー: 外部実体追加 / オブジェクト追加 / 付箋・メモ / 再生成 / PNG出力(toPng)。
 *   - 注釈（付箋・メモ）: DfdAnnotation API で永続化される別系統ノード。
 *     SwimlaneCanvas の注釈実装を踏襲（ドラッグ移動・インライン編集・色・✕削除・リサイズ）。
 *     diagram.nodes/flows とは独立しているため、DFDの再生成・整形の影響を受けない。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
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
  type OnConnectStartParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createPortal } from 'react-dom';
import { toPng } from 'html-to-image';
import {
  Plus,
  Trash2,
  Download,
  RotateCw,
  Square,
  Database,
  Circle,
  FileText,
  Maximize2,
  Minimize2,
  Boxes,
  StickyNote,
  MessageSquarePlus,
  MousePointer2,
  Hand,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InformationTypePicker } from '@/components/masters/InformationTypePicker';
import type { DataObjectDto } from '@/lib/data-objects';
import {
  assignFunctionNumbers,
  informationTypeApi,
  INFORMATION_CATEGORY_LABELS,
  type DfdDiagram,
  type DfdNode as DfdNodeModel,
  type DfdFlow as DfdFlowModel,
  type DfdNodeKind,
  type DfdAnnotation,
  type DfdAnnotationKind,
  type InformationType,
  type InformationTypeAttachment,
} from '@/lib/dfd';

// 色（navy / blue / emerald / slate）
const NAVY = '#050f3e';
const BLUE = '#2563eb';
const EMERALD = '#10b981';
const SLATE = '#475569';

// ノードの描画サイズ（自由配置のシード/保存と一致させる）
const NODE_W = 168;
const NODE_H = 76;

export interface DfdCanvasProps {
  diagram: DfdDiagram;
  /** ノード差分更新（ラベル/番号/位置/種別）。 */
  onUpdateNode?: (id: string, patch: Partial<DfdNodeModel>) => void | Promise<void>;
  /** ノード追加（外部実体/データストア）。 */
  onAddNode?: (body: Partial<DfdNodeModel> & { kind: DfdNodeKind; label: string }) => void | Promise<void>;
  onDeleteNode?: (id: string) => void | Promise<void>;
  /**
   * データフロー追加（接続）。
   * ドラッグで使ったハンドル側（'top'|'right'|'bottom'|'left'）を
   * sourceHandle/targetHandle として渡す。呼び出し側は create body に含める。
   */
  onAddFlow?: (body: {
    sourceNodeId: string;
    targetNodeId: string;
    dataItem: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }) => void | Promise<void>;
  onUpdateFlow?: (id: string, patch: Partial<DfdFlowModel>) => void | Promise<void>;
  /**
   * 既存データフローの端点をドラッグで付け替える（再ルーティング）。
   * React Flow v12 の onReconnect から呼ばれ、新しい source/target ノードとハンドル側を渡す。
   * 呼び出し側は PATCH /api/dfd-flows/:id で永続化する。
   */
  onReconnectFlow?: (
    flowId: string,
    next: {
      sourceNodeId: string;
      targetNodeId: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => void | Promise<void>;
  onDeleteFlow?: (id: string) => void | Promise<void>;
  /** ノード位置の一括保存（ドラッグ完了で呼ぶ）。 */
  onSavePositions?: (positions: { id: string; positionX: number; positionY: number }[]) => void | Promise<void>;
  /** 再生成（第2: そのフローから／第1: プロジェクトから）。 */
  onRegenerate?: () => void | Promise<void>;
  /** FUNCTIONノードのドリルダウン（第1→第2）。refFlowId が無いノードでは出さない。 */
  onFunctionOpen?: (refFlowId: string) => void;
  /** プロジェクトの情報種別一覧（エッジの情報チップ名・セレクタに使用）。 */
  informationTypes?: InformationType[];
  /** プロジェクトのオブジェクト（共通マスタ）一覧。DATA_STORE ノードの紐づけセレクタ・バッジに使用。 */
  dataObjects?: DataObjectDto[];
  /** 情報種別の新規追加先プロジェクト（未指定時は useParams から取得）。 */
  projectId?: string;
  /**
   * DFDに貼る注釈（付箋・メモ）。diagram.nodes/flows とは別系統で永続化されるため、
   * 再生成・整形の影響を受けない。未指定なら注釈UIは出さない。
   */
  annotations?: DfdAnnotation[];
  /** 注釈の追加（STICKY=付箋 / COMMENT=メモ）。初期位置は flow 座標の左上基準。 */
  onAddAnnotation?: (
    kind: DfdAnnotationKind,
    init: { positionX: number; positionY: number },
  ) => void | Promise<void>;
  /** 注釈の部分更新（本文・位置・サイズ・色）。 */
  onUpdateAnnotation?: (
    id: string,
    patch: {
      text?: string;
      positionX?: number;
      positionY?: number;
      width?: number;
      height?: number;
      color?: string | null;
    },
  ) => void | Promise<void>;
  /** 注釈の削除（✕ボタン）。 */
  onDeleteAnnotation?: (id: string) => void | Promise<void>;
}

// ===========================================
// ノードの見た目（3種）
// ===========================================

type DfdNodeData = {
  kind: DfdNodeKind;
  label: string;
  number: string | null;
  hasRefFlow: boolean;
  /** DATA_STORE に紐づくオブジェクト（共通マスタ）名。未紐づけなら null。 */
  dataObjectName: string | null;
  /** オブジェクトバッジのリンク先（オブジェクトマップ）。projectId 不明時は null。 */
  objectMapHref: string | null;
  /** ノード内インライン改名（ダブルクリック→input→blur/Enter保存）。DATA_STORE はマスタ rename になる。 */
  onRename?: (label: string) => void;
};

// 4辺の接続ハンドル定義。ConnectionMode.Loose 下では各ハンドルが source/target 両用。
// id は安定値（'top'|'right'|'bottom'|'left'）で、保存された接続側の復元に使う。
const HANDLE_SIDES: Array<{ id: string; position: Position }> = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
];

/**
 * 4辺の接続ハンドル（source/target 兼用）。
 * - source/target を同位置に重ね、見た目は source 側のドットのみ表示する。
 * - ノード本体のドラッグを邪魔しないよう nodrag を付与。
 * - 矢印を任意の辺へ付け替え／任意の辺から接続できるようにする。
 */
function SideHandles({ color }: { color: string }) {
  return (
    <>
      {HANDLE_SIDES.map((h) => (
        <Handle
          key={`s-${h.id}`}
          type="source"
          id={h.id}
          position={h.position}
          className="nodrag !w-2 !h-2 !min-w-0 !min-h-0 !border !border-white opacity-50 transition-opacity"
          style={{ backgroundColor: color }}
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
    </>
  );
}

/** FUNCTION = 楕円（navy枠 / 番号＋label）。 */
function FunctionNode({ data, selected }: { data: DfdNodeData; selected?: boolean }) {
  return (
    <div
      className="group/node w-full h-full flex flex-col items-center justify-center text-center px-3 transition-all"
      style={{
        borderRadius: '50%',
        border: `2.5px solid ${NAVY}`,
        backgroundColor: '#eff3ff',
        color: NAVY,
        boxShadow: selected ? `0 0 0 3px ${BLUE}55` : '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <SideHandles color="#94a3b8" />
      {data.number && (
        <div className="text-[11px] font-bold leading-none mb-0.5" style={{ color: BLUE }}>
          {data.number}
        </div>
      )}
      <div className="font-semibold text-[13px] leading-tight line-clamp-2">{data.label}</div>
    </div>
  );
}

/** EXTERNAL_ENTITY = 四角（slate）。 */
function ExternalNode({ data, selected }: { data: DfdNodeData; selected?: boolean }) {
  return (
    <div
      className="group/node w-full h-full flex items-center justify-center text-center px-3 rounded-sm transition-all"
      style={{
        border: `2.5px solid ${SLATE}`,
        backgroundColor: '#f1f5f9',
        color: '#1e293b',
        boxShadow: selected ? `0 0 0 3px ${BLUE}55` : '0 1px 2px rgba(0,0,0,0.06)',
      }}
    >
      <SideHandles color="#94a3b8" />
      <div className="font-medium text-[13px] leading-tight line-clamp-2">{data.label}</div>
    </div>
  );
}

/** DATA_STORE = 開いた四角「=」（上下に線, emerald）。ノード＝オブジェクト（共通マスタ）。 */
function DataStoreNode({ data, selected }: { data: DfdNodeData; selected?: boolean }) {
  // ダブルクリック → インライン改名（保存はオブジェクトマスタの rename になる）
  const [editing, setEditing] = useState(false);

  const commit = (value: string) => {
    setEditing(false);
    const v = value.trim();
    if (v && v !== data.label) data.onRename?.(v);
  };

  return (
    <div
      className="group/node w-full h-full flex items-center justify-center text-center px-3 transition-all"
      style={{
        borderTop: `2.5px solid ${EMERALD}`,
        borderBottom: `2.5px solid ${EMERALD}`,
        backgroundColor: '#ecfdf5',
        color: '#065f46',
        boxShadow: selected ? `0 0 0 3px ${BLUE}55` : 'none',
      }}
      onDoubleClick={(e) => {
        if (!data.onRename) return;
        e.stopPropagation();
        setEditing(true);
      }}
      title="ダブルクリックで名前を変更（オブジェクトマスタにも反映）"
    >
      <SideHandles color="#34d399" />
      {/* ノード名＝オブジェクト名（統合済み）なので名前バッジは出さず、
          マップへのリンクはアイコンだけの小バッジにする。 */}
      {data.dataObjectName && data.objectMapHref && (
        <Link
          href={data.objectMapHref}
          onClick={(e) => e.stopPropagation()}
          className="nodrag nopan absolute -top-2.5 left-1/2 -translate-x-1/2 inline-flex items-center px-1 rounded-full border border-violet-300 bg-violet-50 text-violet-700 leading-4 shadow-sm hover:bg-violet-100 hover:border-violet-400"
          title={`オブジェクト: ${data.dataObjectName}（クリックでオブジェクトマップへ）`}
        >
          <Boxes className="w-2.5 h-2.5 shrink-0" />
        </Link>
      )}
      {editing ? (
        <input
          autoFocus
          defaultValue={data.label}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
          className="nodrag nopan w-full bg-white border border-emerald-300 rounded px-1 py-0.5 text-[13px] text-center text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      ) : (
        <div className="font-medium text-[13px] leading-tight line-clamp-2">{data.label}</div>
      )}
    </div>
  );
}

/** システム境界（破線楕円, 背景レイヤ）。 */
function BoundaryNode({ data }: { data: { label: string } }) {
  return (
    <div
      className="w-full h-full pointer-events-none"
      style={{
        borderRadius: '50%',
        border: `2px dashed ${BLUE}66`,
        backgroundColor: `${BLUE}08`,
      }}
    >
      <div
        className="absolute left-1/2 top-2 -translate-x-1/2 text-[11px] font-semibold px-2 py-0.5 rounded"
        style={{ color: BLUE, backgroundColor: '#ffffffcc' }}
      >
        {data.label}
      </div>
    </div>
  );
}

// ===========================================
// 注釈ノード（付箋・メモ）
// diagram.nodes とは別系統。type:'annotation' の専用ノードとして描画する。
// SwimlaneCanvas の AnnotationNode（STICKY/COMMENT）の操作感を踏襲:
//   - 本文は常時 textarea でインライン編集 → onBlur で onUpdateText(id,{text})。
//   - ホバー/選択で ✕ 削除ボタン → onDelete(id)。ドラッグ移動可（drag stop で位置保存）。
//   - 選択時 NodeResizer でリサイズ（width/height を永続化）。
//   - 付箋（STICKY）は選択時に色プリセットのポップで色変更。
// ===========================================

type DfdAnnotationNodeData = {
  kind: DfdAnnotationKind;
  text: string;
  color?: string | null;
  onUpdateText?: (id: string, text: string) => void;
  /** 付箋（STICKY）の色変更（選択時の色プリセット）。 */
  onUpdateColor?: (id: string, color: string) => void;
  onDelete?: (id: string) => void;
  /** リサイズ確定時に呼ぶ（width/height を永続化）。未設定ならハンドル非表示。 */
  onResizeEnd?: (id: string, size: { width: number; height: number }) => void;
};

// 注釈（付箋・メモ）の既定サイズ（SwimlaneCanvas と同値）。
const ANNOTATION_W = 200;
const ANNOTATION_MIN_H = 96;
// 付箋の既定色と色プリセット（選択時の編集ポップ）。
const STICKY_DEFAULT_COLOR = '#fef9c3';
const STICKY_COLOR_PRESETS = ['#fef9c3', '#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#e9d5ff'];

function AnnotationNode({
  id,
  data,
  selected,
}: {
  id: string;
  data: DfdAnnotationNodeData;
  selected?: boolean;
}) {
  const isSticky = data.kind === 'STICKY';
  const [value, setValue] = useState(data.text ?? '');
  // 外部（再取得・楽観更新）で本文が変わったら同期。編集中の onBlur 確定後の再取得でも破綻しない。
  useEffect(() => {
    setValue(data.text ?? '');
  }, [data.text]);

  const handleBlur = useCallback(() => {
    if (value !== (data.text ?? '')) data.onUpdateText?.(id, value);
  }, [value, data, id]);

  const stickyColor = data.color || STICKY_DEFAULT_COLOR;

  return (
    <div
      className={`group/annotation flex w-full h-full flex-col ${
        isSticky
          ? 'rounded-sm border border-amber-300/70 shadow-md'
          : 'relative rounded-lg border-2 border-gray-300 bg-white shadow-md'
      }`}
      style={isSticky ? { backgroundColor: stickyColor } : undefined}
    >
      {/* マウスリサイズ（選択時のみハンドル表示）。 */}
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
      {/* 付箋の色プリセット（選択時のみ）。NodeToolbar はポータル描画のため他ノードに隠れない。 */}
      {isSticky && data.onUpdateColor && (
        <NodeToolbar isVisible={!!selected} position={Position.Top} align="start">
          <div className="nodrag nopan flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1.5 shadow-md">
            {STICKY_COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => data.onUpdateColor?.(id, c)}
                title={c}
                className={`h-3.5 w-3.5 rounded-full border transition-transform ${
                  stickyColor.toLowerCase() === c.toLowerCase()
                    ? 'scale-110 ring-2 ring-blue-400 ring-offset-1'
                    : ''
                }`}
                style={{ backgroundColor: c, borderColor: '#d1d5db' }}
              />
            ))}
          </div>
        </NodeToolbar>
      )}
      {/* メモ（COMMENT）は左下に小さな吹き出しのしっぽを付ける */}
      {!isSticky && (
        <div className="absolute -bottom-2 left-5 h-3 w-3 rotate-45 border-b-2 border-r-2 border-gray-300 bg-white" />
      )}
      {/* 種別ラベル（小） */}
      <div
        className={`flex shrink-0 items-center justify-between px-2 pt-1 text-[10px] font-medium ${
          isSticky ? 'text-amber-700/80' : 'text-gray-400'
        }`}
      >
        <span>{isSticky ? '付箋' : 'メモ'}</span>
      </div>
      <textarea
        // ノード本体のドラッグや pan を奪わないよう nodrag/nopan を付与（テキスト編集を優先）。
        // 箱の高さに追従して伸縮させるため flex-1（min-h-0 で縮小も許可）。
        className={`nodrag nopan min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-2 pb-2 text-xs leading-snug outline-none ${
          isSticky ? 'text-amber-900 placeholder:text-amber-700/40' : 'text-gray-800 placeholder:text-gray-400'
        }`}
        value={value}
        placeholder={isSticky ? '付箋に入力…' : 'メモを入力…'}
        onChange={(e) => setValue(e.target.value)}
        onBlur={handleBlur}
      />
      {/* ホバー/選択で出る削除ボタン */}
      <button
        type="button"
        title="この注釈を削除"
        onClick={(e) => {
          e.stopPropagation();
          data.onDelete?.(id);
        }}
        className={`nodrag nopan absolute -right-2 -top-2 h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:bg-red-50 hover:text-red-600 group-hover/annotation:flex ${
          selected ? 'flex' : 'hidden'
        }`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

const nodeTypes = {
  function: FunctionNode,
  external: ExternalNode,
  datastore: DataStoreNode,
  boundary: BoundaryNode,
  annotation: AnnotationNode,
};

// ===========================================
// エッジ（データフロー矢印 + dataItem + 帳票チップ）
// ===========================================

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function DataFlowEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, selected, data,
}: EdgeProps & {
  data?: {
    informationName?: string | null;
    informationCategoryLabel?: string | null;
    informationAttachmentCount?: number;
    onLabelUpdate?: (id: string, label: string) => void;
    /** ラベル/チップなど線以外の部分をクリックしても矢印を選択できるようにする。 */
    onSelect?: (edgeId: string) => void;
    /** 線の形状（smoothstep|bezier|straight）。 */
    pathStyle?: string | null;
    /** データ項目ラベル・情報チップのパス上位置（0〜1）。 */
    labelT?: number | null;
    infoT?: number | null;
    /** ラベル/チップをパスに沿って移動した時に割合 t を保存する。 */
    onMoveLabel?: (edgeId: string, t: number) => void;
    onMoveInfo?: (edgeId: string, t: number) => void;
    /** 矢印の先端（終点）をドラッグして別ノードへ付け替える。ドロップ先ノードIDを渡す。 */
    onReconnectTarget?: (edgeId: string, newTargetNodeId: string) => void;
    /** 先端をノードから離れた場所にドロップした時、矢印自体を削除する。 */
    onDeleteSelf?: (edgeId: string) => void;
  };
}) {
  const rf = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((label as string) || '');
  // 先端ドラッグ（付け替え/削除）用: 開始点(screen)とカーソル位置を保持してゴースト線を描く。
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  // ラベル/チップをパスに沿って移動中の live な割合（props 反映まで保つ）。
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

  const labelPt = pointAt(liveLabelT ?? data?.labelT ?? 0.5);
  const infoPt = pointAt(liveInfoT ?? data?.infoT ?? 0.5);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        // 線が細くても掴みやすいよう、クリック判定の帯を広く取る（どこを押しても選択可能に）。
        interactionWidth={34}
        style={{ strokeWidth: selected ? 3 : 2, stroke: selected ? BLUE : SLATE }}
      />
      <EdgeLabelRenderer>
        {/* 運ぶ情報種別のチップ: パス上 infoT の位置。ドラッグでパスに沿って移動、クリックで選択。 */}
        {data?.informationName && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${infoPt.x}px,${infoPt.y - 26}px)`,
              pointerEvents: 'all',
            }}
            className={`nodrag nopan ${onMoveInfo ? 'cursor-move' : 'cursor-pointer'}`}
            onPointerDown={(e) => startAlongDrag(e, (t) => setLiveInfoT(t), onMoveInfo)}
            onClick={handleSelectClick}
            title="ドラッグで矢印に沿って移動 / クリックで選択"
          >
            <span
              className={`inline-flex items-center gap-0.5 text-[10px] text-emerald-700 bg-emerald-50 border rounded px-1 shadow-sm ${
                selected ? 'border-emerald-400' : 'border-emerald-200'
              }`}
            >
              <FileText className="w-2.5 h-2.5" />
              {data.informationCategoryLabel && (
                <span className="text-emerald-600/80">[{data.informationCategoryLabel}]</span>
              )}
              <span className="max-w-[80px] truncate">{data.informationName}</span>
              {(data.informationAttachmentCount ?? 0) > 0 && <span>📎{data.informationAttachmentCount}</span>}
            </span>
          </div>
        )}
        {/* データ項目ラベル: パス上 labelT の位置。ドラッグでパスに沿って移動、クリックで選択、Wクリックで編集。 */}
        <div
          style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelPt.x}px,${labelPt.y}px)`, pointerEvents: 'all' }}
          className={`nodrag nopan ${onMoveLabel ? 'cursor-move' : ''}`}
          onPointerDown={(e) => { if (!editing) startAlongDrag(e, (t) => setLiveLabelT(t), onMoveLabel); }}
        >
          {editing ? (
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { setValue((label as string) || ''); setEditing(false); }
              }}
              className="w-28 h-6 text-xs text-center border border-gray-300 rounded bg-white"
            />
          ) : (
            <div
              onClick={handleSelectClick}
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-white border rounded shadow-sm hover:bg-blue-50 ${
                selected ? 'border-blue-500' : 'border-gray-300'
              }`}
              title="ドラッグで移動 / クリックで選択 / ダブルクリックでデータ項目を編集"
            >
              <span className="max-w-[140px] truncate text-gray-800">{(label as string) || '（データ項目）'}</span>
            </div>
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
              stroke={BLUE}
              strokeWidth={2}
              strokeDasharray="5 4"
            />
            <circle cx={dragPos.x} cy={dragPos.y} r={5} fill={BLUE} />
          </svg>,
          document.body,
        )}
    </>
  );
}

const edgeTypes = { dataflow: DataFlowEdge };

// ===========================================
// メイン
// ===========================================

const KIND_TO_TYPE: Record<DfdNodeKind, string> = {
  FUNCTION: 'function',
  EXTERNAL_ENTITY: 'external',
  DATA_STORE: 'datastore',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function DfdCanvasInner(props: DfdCanvasProps) {
  const { diagram } = props;
  const { fitView, screenToFlowPosition } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // 操作モード（選択 / 移動）。SwimlaneCanvas と同じトグル。
  //   - 'select': 左ドラッグで範囲選択・ノード移動。中/右ドラッグで画面パン。Space 押しながら左ドラッグでもパン。
  //   - 'move'  : 左ドラッグで画面パン。
  // 付箋/メモの注釈・ノードの既存ドラッグ・接続は SelectionMode.Partial と panOnDrag=[1,2] で両立する。
  const [interactMode, setInteractMode] = useState<'select' | 'move'>('select');
  // 全画面トグル（fixed inset-0 z-50 オーバーレイ）。Esc で解除。
  const [isFullscreen, setIsFullscreen] = useState(false);
  // オブジェクト追加ピッカー（既存オブジェクト選択 or 新規名入力）。
  const [dataStorePickerOpen, setDataStorePickerOpen] = useState(false);
  const [newDataStoreName, setNewDataStoreName] = useState('');

  // Esc で全画面解除。
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // 選択中のオブジェクト（ノード）/ 矢印（エッジ）を Backspace・Delete で削除。
  // ReactFlow 既定の deleteKeyCode はローカル状態だけ消えて永続化されない（desync）ため
  // 無効化し（下の deleteKeyCode={null}）、ここで onDeleteNode/onDeleteFlow を呼んで永続削除する。
  // テキスト入力中（input/textarea/contentEditable）は誤爆しないよう無視する。
  const { onDeleteNode, onDeleteFlow } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (selectedNodeId && onDeleteNode) {
        e.preventDefault();
        void onDeleteNode(selectedNodeId);
        setSelectedNodeId(null);
      } else if (selectedEdgeId && onDeleteFlow) {
        e.preventDefault();
        void onDeleteFlow(selectedEdgeId);
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId, selectedEdgeId, onDeleteNode, onDeleteFlow]);

  // 全画面切替の前後でビューを合わせ直す（拡大/縮小どちらでも fitView）。
  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 120);
    return () => clearTimeout(t);
  }, [isFullscreen, fitView]);

  // 情報種別の追加先プロジェクト（明示 prop 優先 / 無ければルートの projectId）。
  const routeParams = useParams();
  const projectId = props.projectId ?? (routeParams?.projectId as string | undefined) ?? '';

  // 情報種別はローカルに保持（InformationTypePicker の onCreated で即時追加）。
  // props.informationTypes が更新（再取得）されたら同期する。
  const [informationTypes, setInformationTypes] = useState<InformationType[]>(props.informationTypes ?? []);
  useEffect(() => {
    setInformationTypes(props.informationTypes ?? []);
  }, [props.informationTypes]);

  // FUNCTION の採番を反映（既存 number は保持）
  const numberedNodes = useMemo(() => assignFunctionNumbers(diagram.nodes, 1), [diagram.nodes]);

  const informationTypeById = useMemo(
    () => new Map(informationTypes.map((it) => [it.id, it] as const)),
    [informationTypes],
  );

  // オブジェクト（共通マスタ）。DATA_STORE のバッジ表示・紐づけセレクタに使う。
  const dataObjects = props.dataObjects ?? [];
  const dataObjectById = useMemo(
    () => new Map(dataObjects.map((o) => [o.id, o] as const)),
    [dataObjects],
  );

  // システム境界（FUNCTION/DATA_STORE を囲む破線楕円, 背景）
  const boundaryNode = useMemo<Node | null>(() => {
    const inside = numberedNodes.filter((n) => n.kind === 'FUNCTION' || n.kind === 'DATA_STORE');
    if (inside.length === 0) return null;
    const minX = Math.min(...inside.map((n) => n.positionX));
    const minY = Math.min(...inside.map((n) => n.positionY));
    const maxX = Math.max(...inside.map((n) => n.positionX + NODE_W));
    const maxY = Math.max(...inside.map((n) => n.positionY + NODE_H));
    const pad = 60;
    return {
      id: 'dfd-boundary',
      type: 'boundary',
      position: { x: minX - pad, y: minY - pad },
      data: { label: 'システム境界' },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: 0,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      // 背景レイヤ（システム境界）はクリックを奪わない（下層のエッジ線を選択できるように）。
      // SwimlaneCanvas のレーン背景バグ修正（commit ca040e4）と同じ対処。
      style: { width: maxX - minX + pad * 2, height: maxY - minY + pad * 2, pointerEvents: 'none' },
    } as Node;
  }, [numberedNodes]);

  // React Flow ノード
  const rfNodes: Node[] = useMemo(() => {
    const content: Node[] = numberedNodes.map((n) => ({
      id: n.id,
      type: KIND_TO_TYPE[n.kind],
      position: { x: n.positionX, y: n.positionY },
      data: {
        kind: n.kind,
        label: n.label,
        number: n.number,
        hasRefFlow: !!n.refFlowId,
        dataObjectName: n.dataObjectId ? (dataObjectById.get(n.dataObjectId)?.name ?? null) : null,
        // オブジェクトバッジ → オブジェクトマップへのリンク（projectId 不明時は無効）。
        objectMapHref: projectId ? `/dashboard/projects/${projectId}/object-map` : null,
        // DATA_STORE はノード内ダブルクリックで改名（＝オブジェクトマスタの rename）
        onRename:
          n.kind === 'DATA_STORE' && props.onUpdateNode
            ? (label: string) => void props.onUpdateNode?.(n.id, { label })
            : undefined,
      } as DfdNodeData,
      width: NODE_W,
      height: NODE_H,
      style: { width: NODE_W, height: NODE_H },
      draggable: true,
      zIndex: 1,
    } as Node));
    return boundaryNode ? [boundaryNode, ...content] : content;
  }, [numberedNodes, boundaryNode, dataObjectById, projectId, props.onUpdateNode]);

  // 注釈ノード（付箋・メモ）。diagram.nodes とは別系統で append する。
  // id は注釈の uuid をそのまま使う（DFDノード id とは UUID 空間が別なので衝突しない）。
  // zIndex を高めにしてノード/エッジの上に重ねる。再生成・整形の影響は受けない。
  const annotationRfNodes: Node[] = useMemo(
    () =>
      (props.annotations ?? []).map((a) => {
        // 保存済みリサイズ値があればその寸法で描画、無ければ既定サイズ。
        const w = typeof a.width === 'number' && a.width > 0 ? a.width : ANNOTATION_W;
        const h = typeof a.height === 'number' && a.height > 0 ? a.height : ANNOTATION_MIN_H;
        return {
          id: a.id,
          type: 'annotation',
          position: { x: a.positionX, y: a.positionY },
          data: {
            kind: a.kind,
            text: a.text,
            color: a.color,
            onUpdateText: (id: string, text: string) => props.onUpdateAnnotation?.(id, { text }),
            onUpdateColor: (id: string, color: string) => props.onUpdateAnnotation?.(id, { color }),
            onDelete: (id: string) => props.onDeleteAnnotation?.(id),
            onResizeEnd: props.onUpdateAnnotation
              ? (id: string, size: { width: number; height: number }) =>
                  props.onUpdateAnnotation?.(id, { width: size.width, height: size.height })
              : undefined,
          } as DfdAnnotationNodeData,
          width: w,
          height: h,
          style: { width: w, height: h },
          draggable: true,
          selectable: true,
          connectable: false,
          zIndex: 5,
        } as Node;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.annotations, props.onUpdateAnnotation, props.onDeleteAnnotation],
  );

  const allRfNodes = useMemo(
    () => [...rfNodes, ...annotationRfNodes],
    [rfNodes, annotationRfNodes],
  );

  const [dragNodes, setDragNodes, onNodesChange] = useNodesState(allRfNodes);
  useEffect(() => {
    setDragNodes(allRfNodes);
  }, [allRfNodes, setDragNodes]);

  const rfEdges: Edge[] = useMemo(
    () =>
      diagram.flows.map((f) => {
        const it = f.informationTypeId ? informationTypeById.get(f.informationTypeId) : undefined;
        return {
          id: f.id,
          source: f.sourceNodeId,
          target: f.targetNodeId,
          // 保存された接続側（辺）を描画に反映する。未保存(null/undefined)なら
          // React Flow が向き既定（Loose）でハンドルを自動選択する。
          sourceHandle: f.sourceHandle ?? undefined,
          targetHandle: f.targetHandle ?? undefined,
          label: f.dataItem,
          type: 'dataflow',
          selected: f.id === selectedEdgeId,
          // 端点ドラッグで付け替え可能にする（onReconnect が発火する）。
          reconnectable: !!props.onReconnectFlow,
          markerEnd: { type: MarkerType.ArrowClosed, color: f.id === selectedEdgeId ? BLUE : SLATE, width: 18, height: 18 },
          data: {
            informationName: f.informationTypeId ? (it?.name ?? '情報') : null,
            informationCategoryLabel: it ? INFORMATION_CATEGORY_LABELS[it.category] : null,
            informationAttachmentCount: it?.attachmentCount ?? 0,
            onLabelUpdate: (id: string, label: string) => props.onUpdateFlow?.(id, { dataItem: label }),
            // 線以外（ラベル/チップ）をクリックしても選択できるように。
            onSelect: (eid: string) => { setSelectedEdgeId(eid); setSelectedNodeId(null); },
            // 線の形状・ラベル/チップのパス上位置。
            pathStyle: f.pathStyle ?? null,
            labelT: f.labelT ?? null,
            infoT: f.infoT ?? null,
            // ラベル/チップをパスに沿って移動 → 割合 t を保存。
            onMoveLabel: props.onUpdateFlow
              ? (flowId: string, t: number) => props.onUpdateFlow?.(flowId, { labelT: t })
              : undefined,
            onMoveInfo: props.onUpdateFlow
              ? (flowId: string, t: number) => props.onUpdateFlow?.(flowId, { infoT: t })
              : undefined,
            // 先端ドラッグでの付け替え（ドロップ先ノードへ target を変更）。
            onReconnectTarget: props.onReconnectFlow
              ? (flowId: string, newTargetNodeId: string) => {
                  const cur = diagram.flows.find((x) => x.id === flowId);
                  if (!cur || newTargetNodeId === cur.sourceNodeId) return;
                  void props.onReconnectFlow?.(flowId, {
                    sourceNodeId: cur.sourceNodeId,
                    targetNodeId: newTargetNodeId,
                    sourceHandle: cur.sourceHandle ?? null,
                    targetHandle: cur.targetHandle ?? null,
                  });
                }
              : undefined,
            // 先端を何もない所へドロップ → 矢印を削除。
            onDeleteSelf: props.onDeleteFlow
              ? (flowId: string) => {
                  void props.onDeleteFlow?.(flowId);
                  if (selectedEdgeId === flowId) setSelectedEdgeId(null);
                }
              : undefined,
          },
        };
      }),
    [diagram.flows, selectedEdgeId, informationTypeById, props],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitView, diagram.id]);

  // ドラッグを開始したノードを記録（向きの正規化に使う）。
  const connectStartNodeRef = useRef<string | null>(null);
  const onConnectStart = useCallback(
    (_e: unknown, params: OnConnectStartParams) => {
      connectStartNodeRef.current = params.nodeId ?? null;
    },
    [],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const start = connectStartNodeRef.current;
      connectStartNodeRef.current = null;
      if (!c.source || !c.target || c.source === c.target) return;
      let source = c.source;
      let target = c.target;
      let sourceHandle = c.sourceHandle ?? null;
      let targetHandle = c.targetHandle ?? null;
      // 矢印は「ドラッグを始めたノード → ドロップしたノード」に固定する。
      // ConnectionMode.Loose では各辺に source/target ハンドルが重なっており、
      // React Flow が向きを逆に割り当てることがあるため、開始ノードを起点に正規化する。
      if (start && start === c.target) {
        source = c.target;
        target = c.source;
        sourceHandle = c.targetHandle ?? null;
        targetHandle = c.sourceHandle ?? null;
      }
      // ドラッグで使った辺（ハンドル）を保存する。
      void props.onAddFlow?.({
        sourceNodeId: source,
        targetNodeId: target,
        dataItem: '情報',
        sourceHandle,
        targetHandle,
      });
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
      void props.onReconnectFlow?.(oldEdge.id, {
        sourceNodeId: newConnection.source,
        targetNodeId: newConnection.target,
        sourceHandle: newConnection.sourceHandle ?? null,
        targetHandle: newConnection.targetHandle ?? null,
      });
    },
    [props],
  );

  // ドラッグ停止 → 左上座標を保存
  const handleNodeDragStop = useCallback(
    (_evt: unknown, node: Node) => {
      if (node.type === 'boundary') return;
      // 注釈ノード（付箋・メモ）は別系統。位置だけ DfdAnnotation API へ保存する。
      if (node.type === 'annotation') {
        void props.onUpdateAnnotation?.(node.id, {
          positionX: node.position.x,
          positionY: node.position.y,
        });
        return;
      }
      void props.onSavePositions?.([
        { id: node.id, positionX: node.position.x, positionY: node.position.y },
      ]);
    },
    [props],
  );

  // PNG 出力（帳票全体を画像化）
  const handleExportPng = useCallback(() => {
    const root = wrapperRef.current;
    if (!root) return;
    toPng(root, {
      backgroundColor: '#ffffff',
      cacheBust: true,
      pixelRatio: 2,
      filter: (el) => {
        if (!(el instanceof HTMLElement)) return true;
        return !(
          el.classList?.contains('react-flow__minimap') ||
          el.classList?.contains('react-flow__controls')
        );
      },
    })
      .then((dataUrl) => {
        const a = document.createElement('a');
        a.download = (diagram.title || 'dfd') + '.png';
        a.href = dataUrl;
        a.click();
      })
      .catch(() => {
        /* 画像化失敗は致命ではない */
      });
  }, [diagram.title]);

  const handleAddExternal = useCallback(() => {
    void props.onAddNode?.({ kind: 'EXTERNAL_ENTITY', label: '外部実体', positionX: 40, positionY: 40 });
  }, [props]);

  // オブジェクト追加: 既存オブジェクト選択（label=オブジェクト名・dataObjectId 送信）。
  const handleAddDataStoreFromObject = useCallback(
    (objectId: string) => {
      const obj = (props.dataObjects ?? []).find((o) => o.id === objectId);
      if (!obj) return;
      void props.onAddNode?.({
        kind: 'DATA_STORE',
        label: obj.name,
        dataObjectId: obj.id,
        positionX: 40,
        positionY: 160,
      });
      setDataStorePickerOpen(false);
    },
    [props],
  );

  // オブジェクト追加: 新規名入力（backend が同名オブジェクトを get-or-create して自動リンク）。
  const handleAddDataStoreByName = useCallback(() => {
    const name = newDataStoreName.trim();
    if (!name) return;
    void props.onAddNode?.({ kind: 'DATA_STORE', label: name, positionX: 40, positionY: 160 });
    setNewDataStoreName('');
    setDataStorePickerOpen(false);
  }, [newDataStoreName, props]);

  // --- 注釈（付箋・メモ）を新規追加 ---
  // 初期位置は現在表示中のビュー中央付近（screenToFlowPosition でラッパー中心を flow 座標へ）。
  // 取得できなければ固定オフセットにフォールバック。複数追加で重ならないよう少しずつずらす。
  const handleAddAnnotation = useCallback(
    (kind: DfdAnnotationKind) => {
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
          cx = p.x - ANNOTATION_W / 2;
          cy = p.y - ANNOTATION_MIN_H / 2;
        } catch {
          /* viewport 未確定時は固定オフセット */
        }
      }
      const jitter = (props.annotations?.length ?? 0) % 6;
      void props.onAddAnnotation?.(kind, {
        positionX: cx + jitter * 16,
        positionY: cy + jitter * 16,
      });
    },
    [screenToFlowPosition, props],
  );

  const selectedNode = useMemo(
    () => numberedNodes.find((n) => n.id === selectedNodeId) ?? null,
    [numberedNodes, selectedNodeId],
  );

  const selectedFlow = useMemo(
    () => diagram.flows.find((f) => f.id === selectedEdgeId) ?? null,
    [diagram.flows, selectedEdgeId],
  );

  // 選択中エッジの情報種別に紐づく具体帳票（クリックでDL）
  const [edgeAttachments, setEdgeAttachments] = useState<InformationTypeAttachment[]>([]);
  useEffect(() => {
    const itId = selectedFlow?.informationTypeId;
    if (!itId) {
      setEdgeAttachments([]);
      return;
    }
    let cancelled = false;
    void informationTypeApi
      .listAttachments(itId)
      .then((list) => {
        if (!cancelled) setEdgeAttachments(list);
      })
      .catch(() => {
        if (!cancelled) setEdgeAttachments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFlow?.informationTypeId]);

  return (
    <div
      ref={wrapperRef}
      className={`relative bg-white ${isFullscreen ? 'fixed inset-0 z-50 w-screen h-screen' : 'w-full h-full'}`}
    >
      {/* 帳票ヘッダ */}
      <div className="border-b-2 px-4 py-2 flex items-center justify-between gap-4" style={{ borderColor: NAVY }}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-bold tracking-widest px-1.5 py-0.5 rounded" style={{ backgroundColor: NAVY, color: '#fff' }}>
            DFD
          </span>
          <h2 className="text-sm font-bold truncate" style={{ color: NAVY }}>
            {diagram.title || 'データフロー図'}
          </h2>
        </div>
        <dl className="hidden md:grid grid-cols-5 gap-x-3 gap-y-0.5 text-[10px] text-gray-600 shrink-0">
          <div className="flex flex-col"><dt className="text-gray-400">文書番号</dt><dd className="font-medium">{diagram.docId || '—'}</dd></div>
          <div className="flex flex-col"><dt className="text-gray-400">作成日付</dt><dd className="font-medium">{fmtDate(diagram.updatedAt)}</dd></div>
          <div className="flex flex-col"><dt className="text-gray-400">更新日付</dt><dd className="font-medium">{fmtDate(diagram.updatedAt)}</dd></div>
          <div className="flex flex-col"><dt className="text-gray-400">作成者</dt><dd className="font-medium">{diagram.authorName || '—'}</dd></div>
          <div className="flex flex-col"><dt className="text-gray-400">承認者</dt><dd className="font-medium">{diagram.approverName || '—'}</dd></div>
        </dl>
      </div>

      {/* キャンバス */}
      <div className="relative w-full" style={{ height: 'calc(100% - 76px)' }}>
        <ReactFlow
          nodes={dragNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onConnect={onConnect}
          onConnectStart={onConnectStart}
          onReconnect={onReconnect}
          onNodesChange={onNodesChange}
          deleteKeyCode={null}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          connectionMode={ConnectionMode.Loose}
          minZoom={0.2}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          // 2本指スクロール=パン（移動）。ズームはピンチ（zoomOnPinch 既定true）と +/- コントロールで。
          panOnScroll
          zoomOnScroll={false}
          // 操作モード:
          //   選択モード … 左ドラッグ=範囲選択（＋ノード移動）/ 中・右ドラッグ=パン / Space+左ドラッグ=パン
          //   移動モード … 左ドラッグ=パン
          // SelectionMode.Partial で注釈（付箋/メモ）も含めた範囲選択がノード/接続のドラッグと両立する。
          selectionOnDrag={interactMode === 'select'}
          panOnDrag={interactMode === 'move' ? true : [1, 2]}
          panActivationKeyCode={'Space'}
          selectionMode={SelectionMode.Partial}
          proOptions={{ hideAttribution: true }}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={() => { setSelectedEdgeId(null); setSelectedNodeId(null); }}
          onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
          onNodeClick={(_, node) => {
            if (node.type === 'boundary') return;
            // 注釈（付箋・メモ）は専用UI（インライン編集/✕/リサイズ）で完結。編集パネルは出さない。
            if (node.type === 'annotation') { setSelectedNodeId(null); setSelectedEdgeId(null); return; }
            setSelectedNodeId(node.id); setSelectedEdgeId(null);
          }}
          onNodeDoubleClick={(_, node) => {
            const src = numberedNodes.find((n) => n.id === node.id);
            if (src?.kind === 'FUNCTION' && src.refFlowId && props.onFunctionOpen) {
              props.onFunctionOpen(src.refFlowId);
            }
          }}
          className="bg-gray-50"
        >
          <Background color="#e2e8f0" gap={22} />
          <Controls className="bg-white border border-gray-200 rounded-lg shadow-sm" />
          <MiniMap
            className="bg-white border border-gray-200 rounded-lg shadow-sm"
            nodeColor={(n) => {
              if (n.type === 'function') return '#93c5fd';
              if (n.type === 'datastore') return '#6ee7b7';
              if (n.type === 'external') return '#cbd5e1';
              return 'transparent';
            }}
            maskColor="rgba(0,0,0,0.04)"
          />

          {/* ツールバー（右上） */}
          <Panel position="top-right" className="bg-white border border-gray-200 rounded-lg shadow-sm p-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* 操作モード（選択 / 移動）のトグル。SwimlaneCanvas と同挙動。 */}
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
              <Button variant="outline" size="sm" onClick={handleAddExternal} disabled={!props.onAddNode} className="text-gray-700" title="外部実体（四角）を追加">
                <Square className="w-4 h-4 mr-1" />外部実体
              </Button>
              {/* オブジェクト追加: 既存オブジェクトから選択 or 新規名入力。
                  新規名は backend が同名オブジェクト（共通マスタ）を get-or-create して自動リンクする。 */}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDataStorePickerOpen((v) => !v)}
                  disabled={!props.onAddNode}
                  className="text-gray-700"
                  title="オブジェクトを追加。既存オブジェクトから選ぶか、新しい名前で作成"
                >
                  <Database className="w-4 h-4 mr-1" />オブジェクト
                </Button>
                {dataStorePickerOpen && (
                  <>
                    {/* 背景クリックでピッカーを閉じる透明オーバーレイ */}
                    <div className="fixed inset-0 z-30" onClick={() => setDataStorePickerOpen(false)} />
                    <div className="absolute right-0 top-full z-40 mt-1 w-72 space-y-2 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                      {dataObjects.length > 0 && (
                        <div>
                          <label className="block text-[10px] text-gray-400 mb-0.5">既存のオブジェクトから選択</label>
                          {/* 非制御 Select（パネルは開閉ごとに再マウントされるため毎回プレースホルダに戻る） */}
                          <Select onValueChange={handleAddDataStoreFromObject}>
                            <SelectTrigger className="h-8 w-full bg-white border-gray-300 text-gray-900 text-sm">
                              <SelectValue placeholder="オブジェクトを選ぶ…" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              {dataObjects.map((obj) => (
                                <SelectItem key={obj.id} value={obj.id}>
                                  {obj.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <div>
                        <label className="block text-[10px] text-gray-400 mb-0.5">新しい名前で追加</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            value={newDataStoreName}
                            onChange={(e) => setNewDataStoreName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleAddDataStoreByName();
                              if (e.key === 'Escape') setDataStorePickerOpen(false);
                            }}
                            placeholder="例: 受注台帳"
                            className="h-8 min-w-0 flex-1 rounded border border-gray-300 px-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <Button size="sm" onClick={handleAddDataStoreByName} disabled={!newDataStoreName.trim()}>
                            <Plus className="w-4 h-4 mr-0.5" />追加
                          </Button>
                        </div>
                        <p className="mt-1 text-[10px] text-gray-400">
                          同名のオブジェクト（共通マスタ）を自動作成・紐づけします。
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
              {/* 注釈（付箋・メモ）。diagram.nodes/flows とは別系統で永続化（再生成の影響なし）。 */}
              {props.onAddAnnotation && (
                <>
                  <span className="mx-0.5 h-5 w-px bg-gray-200" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddAnnotation('STICKY')}
                    className="text-gray-700"
                    title="付箋（黄色のメモ）を追加"
                  >
                    <StickyNote className="w-4 h-4 mr-1" />付箋
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddAnnotation('COMMENT')}
                    className="text-gray-700"
                    title="メモ（白い吹き出し）を追加"
                  >
                    <MessageSquarePlus className="w-4 h-4 mr-1" />メモ
                  </Button>
                  <span className="mx-0.5 h-5 w-px bg-gray-200" />
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => props.onRegenerate?.()} disabled={!props.onRegenerate} className="text-gray-700" title="業務フローからFUNCTIONを再生成（手動追加・位置は保持）">
                <RotateCw className="w-4 h-4 mr-1" />再生成
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPng} className="text-gray-700" title="この図をPNG画像で保存">
                <Download className="w-4 h-4 mr-1" />PNG出力
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsFullscreen((v) => !v)}
                className="text-gray-700"
                title={isFullscreen ? '全画面を終了（Esc）' : '全画面表示'}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4 mr-1" /> : <Maximize2 className="w-4 h-4 mr-1" />}
                {isFullscreen ? '縮小' : '全画面'}
              </Button>
            </div>
          </Panel>

          {/* 凡例（左下） */}
          <Panel position="bottom-left" className="bg-white/95 border border-gray-200 rounded-lg shadow-sm p-2">
            <div className="flex flex-col gap-1 text-[11px] text-gray-600">
              <div className="flex items-center gap-1.5">
                <Circle className="w-3.5 h-3.5" style={{ color: NAVY }} />
                <span>処理（プロセス）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Square className="w-3.5 h-3.5" style={{ color: SLATE }} />
                <span>外部実体（源泉/吸収）</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5" style={{ color: EMERALD }} />
                <span>オブジェクト</span>
              </div>
            </div>
          </Panel>
        </ReactFlow>

        {/* 選択ノードの簡易編集 + 削除 */}
        {selectedNode && (
          <div className="absolute top-3 left-3 z-20 bg-white border border-gray-200 rounded-lg shadow-md p-3 w-64 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-500">
                {selectedNode.kind === 'FUNCTION' ? '処理' : selectedNode.kind === 'EXTERNAL_ENTITY' ? '外部実体' : 'オブジェクト'}
              </span>
              <button
                type="button"
                onClick={() => { void props.onDeleteNode?.(selectedNode.id); setSelectedNodeId(null); }}
                disabled={!props.onDeleteNode}
                className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-700 disabled:opacity-40"
                title="このノードを削除"
              >
                <Trash2 className="w-3.5 h-3.5" />削除
              </button>
            </div>
            {/* DATA_STORE はノード＝オブジェクトなので名前入力は出さない
                （改名はノードのダブルクリックで＝マスタ rename） */}
            {selectedNode.kind !== 'DATA_STORE' && (
              <input
                defaultValue={selectedNode.label}
                key={selectedNode.id + selectedNode.label}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== selectedNode.label) void props.onUpdateNode?.(selectedNode.id, { label: v });
                }}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
            )}
            {/* DATA_STORE: ノード＝オブジェクト（共通マスタ）。コントロールはこの select 一つ。
                選び替え＝別オブジェクトへの差し替え（backend がノード名も同期する）。 */}
            {selectedNode.kind === 'DATA_STORE' && props.dataObjects && (
              <div>
                <Select
                  value={selectedNode.dataObjectId ?? ''}
                  onValueChange={(value) =>
                    void props.onUpdateNode?.(selectedNode.id, { dataObjectId: value })
                  }
                  disabled={!props.onUpdateNode}
                >
                  <SelectTrigger className="h-8 w-full bg-white border-gray-300 text-gray-900 text-sm">
                    <SelectValue placeholder="オブジェクトを選択" />
                  </SelectTrigger>
                  <SelectContent className="bg-white">
                    {dataObjects.map((obj) => (
                      <SelectItem key={obj.id} value={obj.id}>
                        {obj.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] text-gray-400">
                  名前はノードをダブルクリックで変更（関係性マップ/ER図のマスタにも反映）
                </p>
                {projectId && (
                  <Link
                    href={`/dashboard/projects/${projectId}/object-map`}
                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"
                  >
                    <Boxes className="w-3 h-3" />
                    オブジェクト関係性マップで見る
                  </Link>
                )}
              </div>
            )}
            {selectedNode.kind === 'FUNCTION' && selectedNode.refFlowId && props.onFunctionOpen && (
              <button
                type="button"
                onClick={() => props.onFunctionOpen?.(selectedNode.refFlowId!)}
                className="w-full text-[11px] text-blue-600 hover:underline text-left"
              >
                このフローを開く（ドリルダウン）
              </button>
            )}
          </div>
        )}

        {/* 選択エッジの編集（情報種別の参照 + 削除） */}
        {selectedFlow && (
          <div className="absolute top-3 left-3 z-20 bg-white border border-gray-200 rounded-lg shadow-md p-3 w-64 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-500">データフロー</span>
              <button
                type="button"
                onClick={() => { void props.onDeleteFlow?.(selectedFlow.id); setSelectedEdgeId(null); }}
                disabled={!props.onDeleteFlow}
                className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-700 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />削除
              </button>
            </div>
            <div className="text-[12px] text-gray-700 truncate" title={selectedFlow.dataItem}>
              {selectedFlow.dataItem || '（データ項目）'}
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">線の形</label>
              <div className="inline-flex rounded border border-gray-300 overflow-hidden">
                {([
                  { value: 'smoothstep', label: '角ばり' },
                  { value: 'bezier', label: '曲線' },
                  { value: 'straight', label: '直線' },
                ] as const).map((opt, i) => {
                  const cur = selectedFlow.pathStyle ?? 'smoothstep';
                  const active = cur === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={!props.onUpdateFlow}
                      onClick={() => void props.onUpdateFlow?.(selectedFlow.id, { pathStyle: opt.value })}
                      className={`px-2.5 py-1 text-[11px] ${i > 0 ? 'border-l border-gray-300' : ''} ${
                        active ? 'bg-blue-500 text-white' : 'bg-white text-gray-600 hover:bg-blue-50'
                      } disabled:opacity-50`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-gray-400 mb-0.5">情報種別</label>
              {/* 共通の InformationTypePicker（選択＋その場で新規追加）。 */}
              <InformationTypePicker
                projectId={projectId}
                informationTypes={informationTypes}
                value={selectedFlow.informationTypeId ?? null}
                onChange={(id) => void props.onUpdateFlow?.(selectedFlow.id, { informationTypeId: id })}
                onCreated={(created) => setInformationTypes((prev) => [...prev, created])}
                disabled={!props.onUpdateFlow}
                triggerClassName="h-8 w-full bg-white border-gray-300 text-gray-900 text-sm"
              />
            </div>
            {selectedFlow.informationTypeId && (
              edgeAttachments.length > 0 ? (
                <ul className="space-y-1">
                  {edgeAttachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-1.5 text-[11px]">
                      <FileText className="w-3 h-3 shrink-0 text-emerald-600" />
                      <span className="flex-1 truncate text-gray-700" title={a.filename}>{a.filename}</span>
                      <a
                        href={informationTypeApi.fileUrl(a.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center text-blue-600 hover:underline"
                        title="ダウンロード / 表示"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-gray-400">具体帳票はありません。</p>
              )
            )}
          </div>
        )}
      </div>

      {/* 帳票フッタ */}
      <div className="border-t-2 px-4 py-1 flex items-center justify-between text-[10px] text-gray-400" style={{ borderColor: NAVY }}>
        <span>処理 {numberedNodes.filter((n) => n.kind === 'FUNCTION').length} ／ 外部実体 {numberedNodes.filter((n) => n.kind === 'EXTERNAL_ENTITY').length} ／ オブジェクト {numberedNodes.filter((n) => n.kind === 'DATA_STORE').length} ／ データフロー {diagram.flows.length}</span>
        <span>ノードはドラッグで配置（位置は保存されます）｜ 4辺のハンドルから接続でデータフロー追加 ｜ 矢印の端点をドラッグでノードへ付け替え／何もない所で削除 ｜ ラベル・情報チップはドラッグで矢印に沿って移動 ｜ 矢印をWクリックでデータ項目編集 ｜ 付箋・メモはドラッグで移動／選択でリサイズ・✕削除</span>
      </div>
    </div>
  );
}

export function DfdCanvas(props: DfdCanvasProps) {
  return (
    <ReactFlowProvider>
      <DfdCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
