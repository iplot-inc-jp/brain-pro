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
 *   - ツールバー: 外部実体追加 / データストア追加 / 再生成 / PNG出力(toPng)。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Plus,
  Trash2,
  Download,
  RotateCw,
  Square,
  Database,
  Circle,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  assignFunctionNumbers,
  informationTypeApi,
  INFORMATION_CATEGORY_LABELS,
  type DfdDiagram,
  type DfdNode as DfdNodeModel,
  type DfdFlow as DfdFlowModel,
  type DfdNodeKind,
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
}

// ===========================================
// ノードの見た目（3種）
// ===========================================

type DfdNodeData = {
  kind: DfdNodeKind;
  label: string;
  number: string | null;
  hasRefFlow: boolean;
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

/** DATA_STORE = 開いた四角「=」（上下に線, emerald）。 */
function DataStoreNode({ data, selected }: { data: DfdNodeData; selected?: boolean }) {
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
    >
      <SideHandles color="#34d399" />
      <div className="font-medium text-[13px] leading-tight line-clamp-2">{data.label}</div>
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

const nodeTypes = {
  function: FunctionNode,
  external: ExternalNode,
  datastore: DataStoreNode,
  boundary: BoundaryNode,
};

// ===========================================
// エッジ（データフロー矢印 + dataItem + 帳票チップ）
// ===========================================

function DataFlowEdge({
  id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, markerEnd, selected, data,
}: EdgeProps & {
  data?: {
    informationName?: string | null;
    informationCategoryLabel?: string | null;
    informationAttachmentCount?: number;
    onLabelUpdate?: (id: string, label: string) => void;
  };
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((label as string) || '');
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
        style={{ strokeWidth: selected ? 3 : 2, stroke: selected ? BLUE : SLATE }}
      />
      <EdgeLabelRenderer>
        <div
          style={{ position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
          className="nodrag nopan"
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
              onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-white border rounded shadow-sm cursor-pointer hover:bg-blue-50 ${
                selected ? 'border-blue-500' : 'border-gray-300'
              }`}
              title="ダブルクリックでデータ項目を編集"
            >
              <span className="max-w-[140px] truncate text-gray-800">{(label as string) || '（データ項目）'}</span>
              {data?.informationName && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1"
                  title={data.informationName}
                >
                  <FileText className="w-2.5 h-2.5" />
                  {data.informationCategoryLabel && (
                    <span className="text-emerald-600/80">[{data.informationCategoryLabel}]</span>
                  )}
                  <span className="max-w-[80px] truncate">{data.informationName}</span>
                  {(data.informationAttachmentCount ?? 0) > 0 && <span>📎{data.informationAttachmentCount}</span>}
                </span>
              )}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
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
  const { fitView } = useReactFlow();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // FUNCTION の採番を反映（既存 number は保持）
  const numberedNodes = useMemo(() => assignFunctionNumbers(diagram.nodes, 1), [diagram.nodes]);

  const informationTypeById = useMemo(
    () => new Map((props.informationTypes ?? []).map((it) => [it.id, it] as const)),
    [props.informationTypes],
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
      zIndex: 0,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
      style: { width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 },
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
      } as DfdNodeData,
      width: NODE_W,
      height: NODE_H,
      style: { width: NODE_W, height: NODE_H },
      draggable: true,
      zIndex: 1,
    } as Node));
    return boundaryNode ? [boundaryNode, ...content] : content;
  }, [numberedNodes, boundaryNode]);

  const [dragNodes, setDragNodes, onNodesChange] = useNodesState(rfNodes);
  useEffect(() => {
    setDragNodes(rfNodes);
  }, [rfNodes, setDragNodes]);

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
          markerEnd: { type: MarkerType.ArrowClosed, color: SLATE, width: 18, height: 18 },
          data: {
            informationName: f.informationTypeId ? (it?.name ?? '情報') : null,
            informationCategoryLabel: it ? INFORMATION_CATEGORY_LABELS[it.category] : null,
            informationAttachmentCount: it?.attachmentCount ?? 0,
            onLabelUpdate: (id: string, label: string) => props.onUpdateFlow?.(id, { dataItem: label }),
          },
        };
      }),
    [diagram.flows, selectedEdgeId, informationTypeById, props],
  );

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [fitView, diagram.id]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source && c.target && c.source !== c.target) {
        // ドラッグで使った辺（ハンドル）を保存する。
        void props.onAddFlow?.({
          sourceNodeId: c.source,
          targetNodeId: c.target,
          dataItem: '情報',
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

  const handleAddDataStore = useCallback(() => {
    void props.onAddNode?.({ kind: 'DATA_STORE', label: 'データストア', positionX: 40, positionY: 160 });
  }, [props]);

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
    <div ref={wrapperRef} className="relative w-full h-full bg-white">
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
          onReconnect={onReconnect}
          onNodesChange={onNodesChange}
          nodesDraggable
          nodesConnectable
          elementsSelectable
          connectionMode={ConnectionMode.Loose}
          minZoom={0.2}
          maxZoom={2}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          proOptions={{ hideAttribution: true }}
          onNodeDragStop={handleNodeDragStop}
          onPaneClick={() => { setSelectedEdgeId(null); setSelectedNodeId(null); }}
          onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null); }}
          onNodeClick={(_, node) => { if (node.type !== 'boundary') { setSelectedNodeId(node.id); setSelectedEdgeId(null); } }}
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
              <Button variant="outline" size="sm" onClick={handleAddExternal} disabled={!props.onAddNode} className="text-gray-700" title="外部実体（四角）を追加">
                <Square className="w-4 h-4 mr-1" />外部実体
              </Button>
              <Button variant="outline" size="sm" onClick={handleAddDataStore} disabled={!props.onAddNode} className="text-gray-700" title="データストア（開いた四角）を追加">
                <Database className="w-4 h-4 mr-1" />データストア
              </Button>
              <Button variant="outline" size="sm" onClick={() => props.onRegenerate?.()} disabled={!props.onRegenerate} className="text-gray-700" title="業務フローからFUNCTIONを再生成（手動追加・位置は保持）">
                <RotateCw className="w-4 h-4 mr-1" />再生成
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPng} className="text-gray-700" title="この図をPNG画像で保存">
                <Download className="w-4 h-4 mr-1" />PNG出力
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
                <span>データストア</span>
              </div>
            </div>
          </Panel>
        </ReactFlow>

        {/* 選択ノードの簡易編集 + 削除 */}
        {selectedNode && (
          <div className="absolute top-3 left-3 z-20 bg-white border border-gray-200 rounded-lg shadow-md p-3 w-64 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-gray-500">
                {selectedNode.kind === 'FUNCTION' ? '処理' : selectedNode.kind === 'EXTERNAL_ENTITY' ? '外部実体' : 'データストア'}
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
            <input
              defaultValue={selectedNode.label}
              key={selectedNode.id + selectedNode.label}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== selectedNode.label) void props.onUpdateNode?.(selectedNode.id, { label: v });
              }}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
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
              <label className="block text-[10px] text-gray-400 mb-0.5">情報種別</label>
              <select
                value={selectedFlow.informationTypeId ?? ''}
                onChange={(e) => {
                  const v = e.target.value || null;
                  void props.onUpdateFlow?.(selectedFlow.id, { informationTypeId: v });
                }}
                disabled={!props.onUpdateFlow}
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
              >
                <option value="">（なし）</option>
                {(props.informationTypes ?? []).map((it) => (
                  <option key={it.id} value={it.id}>
                    [{INFORMATION_CATEGORY_LABELS[it.category]}] {it.name}
                  </option>
                ))}
              </select>
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
        <span>処理 {numberedNodes.filter((n) => n.kind === 'FUNCTION').length} ／ 外部実体 {numberedNodes.filter((n) => n.kind === 'EXTERNAL_ENTITY').length} ／ データストア {numberedNodes.filter((n) => n.kind === 'DATA_STORE').length} ／ データフロー {diagram.flows.length}</span>
        <span>ノードはドラッグで配置（位置は保存されます）｜ 4辺のハンドルから接続でデータフロー追加 ｜ 矢印の端点をドラッグで付け替え ｜ 矢印をWクリックでデータ項目編集</span>
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
