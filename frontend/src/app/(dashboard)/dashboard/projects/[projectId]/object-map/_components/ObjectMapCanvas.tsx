'use client';

/**
 * ObjectMapCanvas — オブジェクト関係性マップ用の軽量SVGキャンバス。
 *
 * React Flow を使わず、viewBox 変換（translate+scale）だけで
 * ズーム（ホイール）/ パン（背景ドラッグ）/ ノードドラッグを実装する。
 *  - オブジェクト = 角丸カード（色帯＋名前＋テーブル数/DFDバッジ）。foreignObject で描画。
 *  - リレーション = 3次ベジェ曲線（既定。pathStyle=null/'bezier'）または直線（pathStyle='straight'）。
 *    両端に 1/N 表記、中央に 1:1/1:多/多:多 チップ＋ラベル。
 *    カーディナリティごとに線色を変える（1:1=青, 1:多=緑, 多:多=橙）。
 *    端点は自動（カード境界との交点）または上下左右の辺中点（sourceHandle/targetHandle）。
 *  - エッジ追加 = 2通り:
 *    (a) カード hover で4辺中点に出る丸ノブを pointerdown→ドラッグ→別カード（またはそのノブ）で
 *        pointerup（業務フローと同じUX。空白ドロップ/ESCで中断、ドラッグなしのノブclickは何もしない）。
 *    (b) 「2クリック接続」モード（ガントの依存編集と同じUX。ESCで中断）。
 *        接続モード中はノブclickでその辺をアンカーに指定できる。
 *  - エッジクリック → その場に編集ポップ（カーディナリティ/線形/始点辺・終点辺/ラベル/削除）。
 *  - 付箋（STICKY）/メモ（COMMENT）= foreignObject の注釈。ドラッグ移動・ダブルクリックで編集・hoverで削除。
 *  - ノードドラッグ終了 → onObjectMoved（親がデバウンスして SaveObjectPositions）。
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
  Plus,
  Import,
  Spline,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Loader2,
  Trash2,
  X,
  StickyNote,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  RELATION_CARDINALITY_OPTIONS,
  type DataObjectAnnotationDto,
  type DataObjectAnnotationKind,
  type DataObjectDto,
  type ObjectRelationDto,
  type RelationCardinality,
} from '@/lib/data-objects';
import {
  CARD_W,
  CARD_H,
  CARDINALITY_STYLES,
  objectColor,
} from './object-map-shared';

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

interface Point {
  x: number;
  y: number;
}

/** カード中心 (cx,cy) から (tx,ty) へ向かう直線とカード境界の交点（エッジの端点） */
function rectAnchor(cx: number, cy: number, tx: number, ty: number): Point {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = dx === 0 ? Number.POSITIVE_INFINITY : CARD_W / 2 / Math.abs(dx);
  const sy = dy === 0 ? Number.POSITIVE_INFINITY : CARD_H / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

/** エッジ端点のアンカー辺（上下左右）。null は自動（rectAnchor） */
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type SideHandle = (typeof SIDES)[number];

/** 辺ごとの「外向き法線」単位ベクトル（ベジェ制御点の伸ばし方向） */
const SIDE_NORMALS: Record<SideHandle, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** カード左上原点から見た各辺中点（接続ノブの位置と共用） */
const SIDE_MIDPOINTS: Record<SideHandle, Point> = {
  top: { x: CARD_W / 2, y: 0 },
  right: { x: CARD_W, y: CARD_H / 2 },
  bottom: { x: CARD_W / 2, y: CARD_H },
  left: { x: 0, y: CARD_H / 2 },
};

/** カード左上 (x,y) の指定辺の中点（上下左右アンカーのエッジ端点） */
function sideAnchor(x: number, y: number, side: SideHandle): Point {
  const m = SIDE_MIDPOINTS[side];
  return { x: x + m.x, y: y + m.y };
}

/** API の string|null を SideHandle に絞り込む（不正値は自動扱い） */
function asSide(v: string | null | undefined): SideHandle | null {
  return SIDES.includes(v as SideHandle) ? (v as SideHandle) : null;
}

/** エッジ編集ポップの始点辺/終点辺セレクタ（''=自動アンカー） */
const HANDLE_OPTIONS: ReadonlyArray<{ value: '' | SideHandle; label: string }> = [
  { value: '', label: '自動' },
  { value: 'top', label: '上' },
  { value: 'right', label: '右' },
  { value: 'bottom', label: '下' },
  { value: 'left', label: '左' },
];

/** 付箋/メモの既定サイズ（width/height 未設定時） */
const ANNOT_W = 170;
const ANNOT_H = 100;

/** ノブドラッグ接続の進行状態（ノブ pointerdown→ドラッグ→別カードで pointerup） */
interface LinkDragState {
  sourceId: string;
  sourceHandle: SideHandle;
  /** プレビュー線の先端（ワールド座標） */
  cursor: Point;
  /** ドロップ先候補（side=null はカード本体=自動アンカー） */
  target: { id: string; side: SideHandle | null } | null;
  /** pointermove したか（ドラッグなしのノブclickでは何も作らない） */
  moved: boolean;
}

/** ノブドラッグ中、辺中点ノブへのスナップ判定半径（ワールド座標） */
const KNOB_SNAP_RADIUS = 14;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface ObjectMapCanvasProps {
  objects: DataObjectDto[];
  relations: ObjectRelationDto[];
  /** 付箋/メモ（接続モード・オブジェクト選択の対象外） */
  annotations: DataObjectAnnotationDto[];
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  /** ノードドラッグ終了時（親側で楽観更新＋デバウンス保存する） */
  onObjectMoved: (id: string, x: number, y: number) => void;
  /** sourceHandle/targetHandle は辺ノブで指定された場合のみ非null（null=自動アンカー） */
  onCreateRelation: (
    sourceObjectId: string,
    targetObjectId: string,
    sourceHandle?: string | null,
    targetHandle?: string | null,
  ) => void | Promise<void>;
  onUpdateRelation: (
    id: string,
    patch: {
      cardinality?: RelationCardinality;
      label?: string | null;
      pathStyle?: string | null;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    },
  ) => void | Promise<void>;
  onDeleteRelation: (id: string) => void | Promise<void>;
  onAddObject: () => void;
  onImportFromDfd: () => void;
  importing: boolean;
  /** 付箋/メモの作成（位置はキャンバスが現在のビュー中心付近で決める） */
  onAddAnnotation: (kind: DataObjectAnnotationKind, x: number, y: number) => void | Promise<void>;
  /** 付箋/メモのドラッグ終了時（親側で楽観更新＋デバウンス保存する） */
  onAnnotationMoved: (id: string, x: number, y: number) => void;
  onUpdateAnnotationText: (id: string, text: string) => void | Promise<void>;
  onDeleteAnnotation: (id: string) => void | Promise<void>;
}

export function ObjectMapCanvas({
  objects,
  relations,
  annotations,
  selectedObjectId,
  onSelectObject,
  onObjectMoved,
  onCreateRelation,
  onUpdateRelation,
  onDeleteRelation,
  onAddObject,
  onImportFromDfd,
  importing,
  onAddAnnotation,
  onAnnotationMoved,
  onUpdateAnnotationText,
  onDeleteAnnotation,
}: ObjectMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [view, setView] = useState<ViewTransform>({ x: 40, y: 40, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // ドラッグ中のノード位置の一時上書き（pointerup で onObjectMoved に確定）
  const [dragPos, setDragPos] = useState<Record<string, Point>>({});
  const dragRef = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  // ドラッグ直後に発火する click で選択がトグルされるのを防ぐ
  const suppressClickRef = useRef(false);
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);

  // 2クリック接続モード（connectSourceHandle = 接続元で選んだ辺。null=自動）
  const [connectMode, setConnectMode] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [connectSourceHandle, setConnectSourceHandle] = useState<SideHandle | null>(null);
  const [cursorWorld, setCursorWorld] = useState<Point | null>(null);
  // 接続ノブの hover（r拡大・色強調用）
  const [hoverKnob, setHoverKnob] = useState<{ objId: string; side: SideHandle } | null>(null);
  // カード hover（接続モード外でも辺ノブを出す）
  const [hoverObjectId, setHoverObjectId] = useState<string | null>(null);

  // ノブドラッグ接続（接続モード不要。ノブ pointerdown→ドラッグ→別カードで pointerup）
  const [linkDrag, setLinkDrag] = useState<LinkDragState | null>(null);
  const linkDragRef = useRef<LinkDragState | null>(null);
  // アンマウント時に window リスナを確実に外す（リーク防止）
  const linkDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => linkDragCleanupRef.current?.(), []);

  // エッジ編集ポップ（コンテナ相対のスクリーン座標）
  const [edgeEdit, setEdgeEdit] = useState<{ id: string; x: number; y: number } | null>(null);
  const [edgeLabelDraft, setEdgeLabelDraft] = useState('');

  // 付箋/メモのインライン編集・hover（✕ボタン表示用）
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState('');
  const [hoveredAnnotationId, setHoveredAnnotationId] = useState<string | null>(null);

  const objectById = useMemo(() => new Map(objects.map((o) => [o.id, o] as const)), [objects]);
  const editingRelation = edgeEdit ? relations.find((r) => r.id === edgeEdit.id) ?? null : null;

  const posOf = useCallback(
    (o: DataObjectDto): Point => dragPos[o.id] ?? { x: o.positionX, y: o.positionY },
    [dragPos],
  );

  // 付箋/メモもカードと同じ dragPos でドラッグ中位置を上書き（id はユニーク）
  const posOfAnnotation = useCallback(
    (a: DataObjectAnnotationDto): Point => dragPos[a.id] ?? { x: a.positionX, y: a.positionY },
    [dragPos],
  );

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const el = svgRef.current;
    const v = viewRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  }, []);

  // ===== ズーム（ホイール。React の onWheel は passive のため native で登録） =====
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), 0.25, 2.5);
        const wx = (px - v.x) / v.k;
        const wy = (py - v.y) / v.k;
        return { k, x: px - wx * k, y: py - wy * k };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = rect.width / 2;
    const py = rect.height / 2;
    setView((v) => {
      const k = clamp(v.k * factor, 0.25, 2.5);
      const wx = (px - v.x) / v.k;
      const wy = (py - v.y) / v.k;
      return { k, x: px - wx * k, y: py - wy * k };
    });
  }, []);

  // ===== 全体表示（fit） =====
  const fitView = useCallback(() => {
    const el = svgRef.current;
    if (!el || objects.length === 0) return;
    const rect = el.getBoundingClientRect();
    const xs = objects.map((o) => o.positionX);
    const ys = objects.map((o) => o.positionY);
    const minX = Math.min(...xs) - 60;
    const minY = Math.min(...ys) - 60;
    const maxX = Math.max(...xs) + CARD_W + 60;
    const maxY = Math.max(...ys) + CARD_H + 60;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const k = clamp(Math.min(rect.width / w, rect.height / h), 0.25, 1.25);
    setView({
      k,
      x: (rect.width - w * k) / 2 - minX * k,
      y: (rect.height - h * k) / 2 - minY * k,
    });
  }, [objects]);

  const didInitialFit = useRef(false);
  useEffect(() => {
    if (!didInitialFit.current && objects.length > 0) {
      didInitialFit.current = true;
      fitView();
    }
  }, [objects, fitView]);

  // ===== ESC で接続/編集を中断 =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setConnectSourceId(null);
      setConnectSourceHandle(null);
      setConnectMode(false);
      setEdgeEdit(null);
      setEditingAnnotationId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ===== ノードドラッグ =====
  const handleNodePointerDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, obj: DataObjectDto) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      suppressClickRef.current = false;
      if (connectMode) return; // 接続モード中はドラッグせずクリック扱い
      const world = screenToWorld(e.clientX, e.clientY);
      const p = { x: obj.positionX, y: obj.positionY };
      dragRef.current = { id: obj.id, dx: world.x - p.x, dy: world.y - p.y, moved: false };

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const w = screenToWorld(ev.clientX, ev.clientY);
        d.moved = true;
        setDragPos({ [d.id]: { x: Math.round(w.x - d.dx), y: Math.round(w.y - d.dy) } });
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = dragRef.current;
        dragRef.current = null;
        if (!d) return;
        if (d.moved) {
          suppressClickRef.current = true;
          const w = screenToWorld(ev.clientX, ev.clientY);
          onObjectMoved(d.id, Math.round(w.x - d.dx), Math.round(w.y - d.dy));
        }
        setDragPos({});
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [connectMode, screenToWorld, onObjectMoved],
  );

  const handleNodeClick = useCallback(
    (e: ReactMouseEvent<SVGGElement>, obj: DataObjectDto) => {
      e.stopPropagation();
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (connectMode) {
        if (!connectSourceId) {
          // カード本体クリック = 自動アンカー（null）で接続元に
          setConnectSourceId(obj.id);
          setConnectSourceHandle(null);
        } else if (connectSourceId === obj.id) {
          setConnectSourceId(null);
          setConnectSourceHandle(null);
        } else {
          void onCreateRelation(connectSourceId, obj.id, connectSourceHandle, null);
          setConnectSourceId(null);
          setConnectSourceHandle(null);
        }
        return;
      }
      setEdgeEdit(null);
      onSelectObject(obj.id === selectedObjectId ? null : obj.id);
    },
    [connectMode, connectSourceId, connectSourceHandle, onCreateRelation, onSelectObject, selectedObjectId],
  );

  // ===== 接続ノブ（カード4辺の中点）クリック = その辺をアンカーに指定して接続 =====
  const handleKnobClick = useCallback(
    (e: ReactMouseEvent<SVGCircleElement>, obj: DataObjectDto, side: SideHandle) => {
      e.stopPropagation();
      if (!connectMode) return;
      if (!connectSourceId) {
        setConnectSourceId(obj.id);
        setConnectSourceHandle(side);
      } else if (connectSourceId === obj.id) {
        // 同じカード内のノブ = 接続元の辺を選び直し
        setConnectSourceHandle(side);
      } else {
        void onCreateRelation(connectSourceId, obj.id, connectSourceHandle, side);
        setConnectSourceId(null);
        setConnectSourceHandle(null);
      }
    },
    [connectMode, connectSourceId, connectSourceHandle, onCreateRelation],
  );

  // ===== ノブドラッグ接続: ドロップ先判定（ワールド座標。辺ノブ優先 → カード矩形） =====
  const hitTestDropTarget = useCallback(
    (w: Point, excludeId: string): { id: string; side: SideHandle | null } | null => {
      // 辺中点ノブへのスナップを優先（targetHandle=その辺）
      for (const o of objects) {
        if (o.id === excludeId) continue;
        const p = posOf(o);
        for (const side of SIDES) {
          const m = SIDE_MIDPOINTS[side];
          if (Math.hypot(w.x - (p.x + m.x), w.y - (p.y + m.y)) <= KNOB_SNAP_RADIUS) {
            return { id: o.id, side };
          }
        }
      }
      // カード本体（targetHandle=null=自動アンカー）
      for (const o of objects) {
        if (o.id === excludeId) continue;
        const p = posOf(o);
        if (w.x >= p.x && w.x <= p.x + CARD_W && w.y >= p.y && w.y <= p.y + CARD_H) {
          return { id: o.id, side: null };
        }
      }
      return null;
    },
    [objects, posOf],
  );

  // ===== ノブ pointerdown → ドラッグでプレビュー線 → 別カード上で pointerup = 関係線作成 =====
  // カードドラッグ/背景パンには伝播させない。空白ドロップ・ESC・ドラッグなしの up はキャンセル。
  const handleKnobPointerDown = useCallback(
    (e: ReactPointerEvent<SVGCircleElement>, obj: DataObjectDto, side: SideHandle) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (connectMode) return; // 接続モード中は既存の2クリック接続（ノブclick）に任せる
      // 既存ドラッグが残っていれば先に破棄（2本目の指での再入時にリスナを残留させない）
      linkDragCleanupRef.current?.();
      const pointerId = e.pointerId;
      const init: LinkDragState = {
        sourceId: obj.id,
        sourceHandle: side,
        cursor: screenToWorld(e.clientX, e.clientY),
        target: null,
        moved: false,
      };
      linkDragRef.current = init;
      setLinkDrag(init);

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return; // 別ポインタ（2本目の指等）は無視
        const d = linkDragRef.current;
        if (!d) return;
        const w = screenToWorld(ev.clientX, ev.clientY);
        const next: LinkDragState = {
          ...d,
          cursor: w,
          target: hitTestDropTarget(w, d.sourceId),
          moved: true,
        };
        linkDragRef.current = next;
        setLinkDrag(next);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        linkDragCleanupRef.current = null;
        linkDragRef.current = null;
        setLinkDrag(null);
      };
      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return; // 別ポインタの up では確定しない
        const d = linkDragRef.current;
        cleanup();
        if (!d?.moved) return; // ドラッグせず up = 何もしない（誤作成防止）
        if (d.target && d.target.id !== d.sourceId) {
          void onCreateRelation(d.sourceId, d.target.id, d.sourceHandle, d.target.side);
        }
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup(); // システム割り込み等で中断 = 作成しない・リスナを残さない
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') cleanup(); // ESC で中断（pointerup しても作成されない）
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('keydown', onKey);
      linkDragCleanupRef.current = cleanup;
    },
    [connectMode, screenToWorld, hitTestDropTarget, onCreateRelation],
  );

  // ===== 付箋/メモのドラッグ（カードと同じポインタ系。接続・選択の対象外） =====
  const handleAnnotationPointerDown = useCallback(
    (e: ReactPointerEvent<SVGGElement>, a: DataObjectAnnotationDto) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (editingAnnotationId === a.id) return; // テキスト編集中はドラッグしない
      const world = screenToWorld(e.clientX, e.clientY);
      dragRef.current = { id: a.id, dx: world.x - a.positionX, dy: world.y - a.positionY, moved: false };

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const w = screenToWorld(ev.clientX, ev.clientY);
        d.moved = true;
        setDragPos({ [d.id]: { x: Math.round(w.x - d.dx), y: Math.round(w.y - d.dy) } });
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = dragRef.current;
        dragRef.current = null;
        if (!d) return;
        if (d.moved) {
          const w = screenToWorld(ev.clientX, ev.clientY);
          onAnnotationMoved(d.id, Math.round(w.x - d.dx), Math.round(w.y - d.dy));
        }
        setDragPos({});
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [editingAnnotationId, screenToWorld, onAnnotationMoved],
  );

  // ===== 付箋/メモのインライン編集（ダブルクリック開始 → blur で保存） =====
  const startEditAnnotation = useCallback((a: DataObjectAnnotationDto) => {
    setAnnotationDraft(a.text);
    setEditingAnnotationId(a.id);
  }, []);

  const commitAnnotationText = useCallback(() => {
    if (!editingAnnotationId) return;
    const target = annotations.find((a) => a.id === editingAnnotationId);
    setEditingAnnotationId(null);
    if (!target) return;
    if (annotationDraft === target.text) return;
    void onUpdateAnnotationText(target.id, annotationDraft);
  }, [editingAnnotationId, annotations, annotationDraft, onUpdateAnnotationText]);

  // 付箋/メモの新規作成位置 = 現在のビュー中心付近（連続追加は少しずつずらす）
  const addAnnotationAtCenter = useCallback(
    (kind: DataObjectAnnotationKind) => {
      const el = svgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const c = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const jitter = (annotations.length % 4) * 16;
      void onAddAnnotation(kind, Math.round(c.x - ANNOT_W / 2 + jitter), Math.round(c.y - ANNOT_H / 2 + jitter));
    },
    [annotations.length, screenToWorld, onAddAnnotation],
  );

  // ===== 背景パン / 背景クリックで選択解除 =====
  const handleBackgroundPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.button !== 0) return;
      const v = viewRef.current;
      panRef.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };

      const onMove = (ev: PointerEvent) => {
        const p = panRef.current;
        if (!p) return;
        const dx = ev.clientX - p.sx;
        const dy = ev.clientY - p.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) p.moved = true;
        setView((prev) => ({ ...prev, x: p.vx + dx, y: p.vy + dy }));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const p = panRef.current;
        panRef.current = null;
        if (p && !p.moved) {
          // クリック（パンなし）→ 選択解除・接続元解除・編集ポップ/注釈編集を閉じる
          onSelectObject(null);
          setConnectSourceId(null);
          setConnectSourceHandle(null);
          setEdgeEdit(null);
          setEditingAnnotationId(null);
        }
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [onSelectObject],
  );

  // 接続モード中のプレビュー線用にカーソルのワールド座標を追跡
  const handleSvgPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (!connectMode || !connectSourceId) return;
      setCursorWorld(screenToWorld(e.clientX, e.clientY));
    },
    [connectMode, connectSourceId, screenToWorld],
  );

  // ===== エッジクリック → 編集ポップ =====
  const handleEdgeClick = useCallback(
    (e: ReactMouseEvent<SVGPathElement>, rel: ObjectRelationDto) => {
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = clamp(e.clientX - rect.left, 130, rect.width - 130);
      const y = clamp(e.clientY - rect.top, 10, rect.height - 290);
      setEdgeLabelDraft(rel.label ?? '');
      setEdgeEdit({ id: rel.id, x, y });
    },
    [],
  );

  const commitEdgeLabel = useCallback(() => {
    if (!editingRelation) return;
    const v = edgeLabelDraft.trim();
    if (v === (editingRelation.label ?? '')) return;
    void onUpdateRelation(editingRelation.id, { label: v === '' ? null : v });
  }, [editingRelation, edgeLabelDraft, onUpdateRelation]);

  // ===== エッジ描画情報（pathStyle/辺アンカー対応。同一ペア間の複数線は垂直方向にオフセット） =====
  const edgeGeometries = useMemo(() => {
    const groups = new Map<string, ObjectRelationDto[]>();
    for (const r of relations) {
      const key = [r.sourceObjectId, r.targetObjectId].sort().join('|');
      const arr = groups.get(key);
      if (arr) arr.push(r);
      else groups.set(key, [r]);
    }
    const result: Array<{
      rel: ObjectRelationDto;
      /** 直線 or 3次ベジェの <path> d */
      path: string;
      /** 中央チップ/ラベル位置（ベジェは t=0.5 の点） */
      mid: Point;
      srcMark: Point;
      tgtMark: Point;
      arrowTip: Point;
      arrowL: Point;
      arrowR: Point;
    }> = [];
    for (const group of Array.from(groups.values())) {
      group.forEach((rel, i) => {
        const src = objectById.get(rel.sourceObjectId);
        const tgt = objectById.get(rel.targetObjectId);
        if (!src || !tgt || src.id === tgt.id) return;
        const sp = posOf(src);
        const tp = posOf(tgt);
        const scx = sp.x + CARD_W / 2;
        const scy = sp.y + CARD_H / 2;
        const tcx = tp.x + CARD_W / 2;
        const tcy = tp.y + CARD_H / 2;
        const len = Math.hypot(tcx - scx, tcy - scy) || 1;
        const centerPerp = { x: -(tcy - scy) / len, y: (tcx - scx) / len };
        // 同一ペア間の複数エッジは中心線を垂直方向にずらす（自動アンカー時のみ効く）
        const offset = (i - (group.length - 1) / 2) * 22;
        const sh = asSide(rel.sourceHandle);
        const th = asSide(rel.targetHandle);
        // 端点: 辺指定があればその辺の中点、なければカード境界との交点（自動）
        const a = sh
          ? sideAnchor(sp.x, sp.y, sh)
          : rectAnchor(scx, scy, tcx + centerPerp.x * offset, tcy + centerPerp.y * offset);
        const b = th
          ? sideAnchor(tp.x, tp.y, th)
          : rectAnchor(tcx, tcy, scx + centerPerp.x * offset, scy + centerPerp.y * offset);
        const abLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const abDir = { x: (b.x - a.x) / abLen, y: (b.y - a.y) / abLen };

        let path: string;
        let mid: Point;
        let srcMark: Point;
        let tgtMark: Point;
        let arrowDir: Point; // target 端点での進行方向（矢じりの向き）
        if (rel.pathStyle !== 'straight') {
          // 3次ベジェ（既定: null / 'bezier'）。制御点は各端点から「接続辺の外向き法線」（自動アンカー時は端点間方向）へ dist*0.4
          const ext = Math.max(abLen, 40) * 0.4;
          const ns = sh ? SIDE_NORMALS[sh] : abDir;
          const nt = th ? SIDE_NORMALS[th] : { x: -abDir.x, y: -abDir.y };
          const c1 = { x: a.x + ns.x * ext, y: a.y + ns.y * ext };
          const c2 = { x: b.x + nt.x * ext, y: b.y + nt.y * ext };
          path = `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
          // 中央チップ = t=0.5 の点 (P0 + 3P1 + 3P2 + P3) / 8
          mid = {
            x: (a.x + 3 * c1.x + 3 * c2.x + b.x) / 8,
            y: (a.y + 3 * c1.y + 3 * c2.y + b.y) / 8,
          };
          // 1/N 表記は端点から制御点方向へ ~16px（垂直方向に 11px 浮かせる）
          srcMark = { x: a.x + ns.x * 16 - ns.y * 11, y: a.y + ns.y * 16 + ns.x * 11 };
          tgtMark = { x: b.x + nt.x * 16 - nt.y * 11, y: b.y + nt.y * 16 + nt.x * 11 };
          arrowDir = { x: -nt.x, y: -nt.y };
        } else {
          // 直線（pathStyle='straight' のときのみ）
          path = `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
          mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const abPerp = { x: -abDir.y, y: abDir.x };
          srcMark = { x: a.x + abDir.x * 18 + abPerp.x * 11, y: a.y + abDir.y * 18 + abPerp.y * 11 };
          tgtMark = { x: b.x - abDir.x * 18 + abPerp.x * 11, y: b.y - abDir.y * 18 + abPerp.y * 11 };
          arrowDir = abDir;
        }
        const arrowPerp = { x: -arrowDir.y, y: arrowDir.x };
        result.push({
          rel,
          path,
          mid,
          srcMark,
          tgtMark,
          arrowTip: b,
          arrowL: {
            x: b.x - arrowDir.x * 10 + arrowPerp.x * 5,
            y: b.y - arrowDir.y * 10 + arrowPerp.y * 5,
          },
          arrowR: {
            x: b.x - arrowDir.x * 10 - arrowPerp.x * 5,
            y: b.y - arrowDir.y * 10 - arrowPerp.y * 5,
          },
        });
      });
    }
    return result;
  }, [relations, objectById, posOf]);

  const connectSource = connectSourceId ? objectById.get(connectSourceId) ?? null : null;
  // 接続プレビュー線の始点（辺ノブ指定があればその辺の中点）
  let connectPreviewStart: Point | null = null;
  if (connectSource) {
    const sp = posOf(connectSource);
    connectPreviewStart = connectSourceHandle
      ? sideAnchor(sp.x, sp.y, connectSourceHandle)
      : { x: sp.x + CARD_W / 2, y: sp.y + CARD_H / 2 };
  }

  // ノブドラッグ接続のプレビュー線（既定ベジェと同じ形状・半透明。ドロップ先にはスナップ）
  let linkDragPath: string | null = null;
  if (linkDrag) {
    const src = objectById.get(linkDrag.sourceId);
    if (src) {
      const sp = posOf(src);
      const a = sideAnchor(sp.x, sp.y, linkDrag.sourceHandle);
      const tgtObj = linkDrag.target ? objectById.get(linkDrag.target.id) ?? null : null;
      let b = linkDrag.cursor;
      let tSide: SideHandle | null = null;
      if (tgtObj && linkDrag.target) {
        const tp = posOf(tgtObj);
        tSide = linkDrag.target.side;
        b = tSide
          ? sideAnchor(tp.x, tp.y, tSide)
          : rectAnchor(tp.x + CARD_W / 2, tp.y + CARD_H / 2, a.x, a.y);
      }
      const abLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const abDir = { x: (b.x - a.x) / abLen, y: (b.y - a.y) / abLen };
      const ext = Math.max(abLen, 40) * 0.4;
      const ns = SIDE_NORMALS[linkDrag.sourceHandle];
      const nt = tSide ? SIDE_NORMALS[tSide] : { x: -abDir.x, y: -abDir.y };
      const c1 = { x: a.x + ns.x * ext, y: a.y + ns.y * ext };
      const c2 = { x: b.x + nt.x * ext, y: b.y + nt.y * ext };
      linkDragPath = `M ${a.x} ${a.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.x} ${b.y}`;
    }
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-slate-50">
      {/* ===== SVG キャンバス ===== */}
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: connectMode ? 'crosshair' : panRef.current ? 'grabbing' : 'default' }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleSvgPointerMove}
      >
        {/* ドット方眼（ビュー変換に追随） */}
        <defs>
          <pattern
            id="object-map-dots"
            width={24 * view.k}
            height={24 * view.k}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x},${view.y})`}
          >
            <circle cx={1} cy={1} r={1} fill="#cbd5e1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#object-map-dots)" />

        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* ===== エッジ ===== */}
          {edgeGeometries.map(({ rel, path, mid, srcMark, tgtMark, arrowTip, arrowL, arrowR }) => {
            const style = CARDINALITY_STYLES[rel.cardinality];
            const editing = edgeEdit?.id === rel.id;
            return (
              <g key={rel.id}>
                {/* クリック判定用の太い透明パス */}
                <path
                  d={path}
                  stroke="transparent"
                  strokeWidth={14}
                  fill="none"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => handleEdgeClick(e, rel)}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <path
                  d={path}
                  stroke={style.color}
                  strokeWidth={editing ? 2.5 : 1.5}
                  fill="none"
                  pointerEvents="none"
                />
                <polygon
                  points={`${arrowTip.x},${arrowTip.y} ${arrowL.x},${arrowL.y} ${arrowR.x},${arrowR.y}`}
                  fill={style.color}
                  pointerEvents="none"
                />
                {/* 両端の 1/N 表記 */}
                <text
                  x={srcMark.x}
                  y={srcMark.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill={style.color}
                  stroke="#ffffff"
                  strokeWidth={4}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {style.sourceMark}
                </text>
                <text
                  x={tgtMark.x}
                  y={tgtMark.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fontWeight={700}
                  fill={style.color}
                  stroke="#ffffff"
                  strokeWidth={4}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {style.targetMark}
                </text>
                {/* 中央: ラベル（上）＋カーディナリティチップ（下） */}
                {rel.label && (
                  <text
                    x={mid.x}
                    y={mid.y - 14}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#334155"
                    stroke="#ffffff"
                    strokeWidth={4}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {rel.label}
                  </text>
                )}
                <text
                  x={mid.x}
                  y={mid.y + (rel.label ? 4 : -4)}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight={700}
                  fill={style.color}
                  stroke="#ffffff"
                  strokeWidth={4}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {style.short}
                </text>
              </g>
            );
          })}

          {/* 接続プレビュー線（接続元（辺指定があればその辺の中点） → カーソル） */}
          {connectMode && connectPreviewStart && cursorWorld && (
            <line
              x1={connectPreviewStart.x}
              y1={connectPreviewStart.y}
              x2={cursorWorld.x}
              y2={cursorWorld.y}
              stroke="#2563eb"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          )}

          {/* ノブドラッグ接続のプレビュー線（半透明ベジェ。指先/ドロップ先に追従） */}
          {linkDragPath && (
            <path
              d={linkDragPath}
              stroke="#2563eb"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              opacity={0.55}
              fill="none"
              pointerEvents="none"
            />
          )}

          {/* ===== 付箋/メモ（接続モード・オブジェクト選択の対象外。カードの下層に描画） ===== */}
          {annotations.map((a) => {
            const p = posOfAnnotation(a);
            const w = a.width ?? ANNOT_W;
            const h = a.height ?? ANNOT_H;
            const isSticky = a.kind === 'STICKY';
            const isEditing = editingAnnotationId === a.id;
            const hovered = hoveredAnnotationId === a.id;
            return (
              <g
                key={a.id}
                transform={`translate(${p.x},${p.y})`}
                onPointerDown={(e) => handleAnnotationPointerDown(e, a)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  // 編集中の textarea 内ダブルクリック（単語選択）で draft が保存済みテキストに巻き戻るのを防ぐ
                  if (isEditing) return;
                  startEditAnnotation(a);
                }}
                onPointerEnter={() => setHoveredAnnotationId(a.id)}
                onPointerLeave={() => setHoveredAnnotationId(null)}
                style={{ cursor: isEditing ? 'text' : 'grab' }}
              >
                <foreignObject width={w} height={h} pointerEvents={isEditing ? 'auto' : 'none'}>
                  <div
                    className={
                      isSticky
                        ? 'h-full w-full overflow-hidden rounded-lg border border-amber-200 p-2 shadow-md'
                        : 'h-full w-full overflow-hidden rounded-lg rounded-bl-none border border-gray-300 bg-white p-2 shadow-sm'
                    }
                    style={isSticky ? { background: '#fef3c7' } : undefined}
                  >
                    {isEditing ? (
                      <textarea
                        autoFocus
                        className="h-full w-full resize-none bg-transparent text-[11px] leading-snug text-slate-700 focus:outline-none"
                        value={annotationDraft}
                        onChange={(e) => setAnnotationDraft(e.target.value)}
                        onBlur={commitAnnotationText}
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                    ) : a.text ? (
                      <p className="whitespace-pre-wrap break-words text-[11px] leading-snug text-slate-700">
                        {a.text}
                      </p>
                    ) : (
                      <p className="text-[11px] text-slate-400">ダブルクリックで編集</p>
                    )}
                  </div>
                </foreignObject>
                {/* 非編集時のヒット領域（foreignObject の上に透明 rect） */}
                {!isEditing && <rect width={w} height={h} rx={8} fill="transparent" />}
                {/* hover 時の削除ボタン */}
                {hovered && !isEditing && (
                  <foreignObject x={w - 24} y={4} width={20} height={20}>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-gray-400 shadow hover:text-red-600"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        void onDeleteAnnotation(a.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </foreignObject>
                )}
              </g>
            );
          })}

          {/* ===== オブジェクトカード ===== */}
          {objects.map((o) => {
            const p = posOf(o);
            const color = objectColor(o.color);
            const selected = o.id === selectedObjectId;
            const isConnectSource = o.id === connectSourceId;
            const isLinkSource = linkDrag?.sourceId === o.id;
            const isLinkTarget = linkDrag?.target?.id === o.id;
            return (
              <g
                key={o.id}
                transform={`translate(${p.x},${p.y})`}
                onPointerDown={(e) => handleNodePointerDown(e, o)}
                onClick={(e) => handleNodeClick(e, o)}
                onPointerEnter={() => setHoverObjectId(o.id)}
                onPointerLeave={() => setHoverObjectId(null)}
                style={{ cursor: connectMode ? 'crosshair' : 'grab' }}
              >
                {/* 選択/接続元/ドロップ先候補リング */}
                {(selected || isConnectSource || isLinkTarget) && (
                  <rect
                    x={-5}
                    y={-5}
                    width={CARD_W + 10}
                    height={CARD_H + 10}
                    rx={16}
                    fill="none"
                    stroke={isLinkTarget || isConnectSource ? '#2563eb' : '#3b82f6'}
                    strokeWidth={isLinkTarget ? 2.5 : 2}
                    strokeDasharray={isConnectSource ? '6 4' : undefined}
                  />
                )}
                <foreignObject width={CARD_W} height={CARD_H} pointerEvents="none">
                  <div
                    className="flex h-full flex-col justify-between rounded-xl border bg-white px-3 py-2 shadow-sm"
                    style={{
                      borderColor: selected ? '#3b82f6' : '#e2e8f0',
                      borderLeftColor: color,
                      borderLeftWidth: 5,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="truncate text-[13px] font-semibold text-slate-800">
                        {o.name}
                      </span>
                    </div>
                    {o.description ? (
                      <p className="truncate text-[10px] text-slate-400">{o.description}</p>
                    ) : (
                      <p className="text-[10px] text-slate-300">—</p>
                    )}
                    <div className="flex items-center gap-1">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        テーブル {o.tables.length}
                      </span>
                      {o.dfdNodes.length > 0 && (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          DFD {o.dfdNodes.length}
                        </span>
                      )}
                    </div>
                  </div>
                </foreignObject>
                {/* ヒット領域（foreignObject の上に透明 rect） */}
                <rect width={CARD_W} height={CARD_H} rx={12} fill="transparent" />
                {/* 4辺中点の接続ノブ。
                    接続モード中: click=その辺をアンカーに（カード本体click=自動）。
                    接続モード外: カード hover で表示し、pointerdown→ドラッグで関係線を生やす。 */}
                {(connectMode || hoverObjectId === o.id || isLinkSource || isLinkTarget) &&
                  SIDES.map((side) => {
                    const kp = SIDE_MIDPOINTS[side];
                    const knobHovered = hoverKnob?.objId === o.id && hoverKnob.side === side;
                    const knobActive =
                      (isConnectSource && connectSourceHandle === side) ||
                      (isLinkSource && linkDrag?.sourceHandle === side) ||
                      (isLinkTarget && linkDrag?.target?.side === side);
                    return (
                      <circle
                        key={side}
                        cx={kp.x}
                        cy={kp.y}
                        r={knobHovered || knobActive ? 7 : 5}
                        fill={knobActive ? '#2563eb' : knobHovered ? '#bfdbfe' : '#ffffff'}
                        stroke="#2563eb"
                        strokeWidth={1.5}
                        style={{ cursor: connectMode ? 'pointer' : 'crosshair' }}
                        onPointerDown={(e) => handleKnobPointerDown(e, o, side)}
                        onClick={(e) => handleKnobClick(e, o, side)}
                        onPointerEnter={() => setHoverKnob({ objId: o.id, side })}
                        onPointerLeave={() => setHoverKnob(null)}
                      />
                    );
                  })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* ===== ツールバー（左上） ===== */}
      <div className="absolute left-3 top-3 flex items-center gap-1 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-sm">
        <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-xs" onClick={onAddObject}>
          <Plus className="h-4 w-4" />
          オブジェクト追加
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={onImportFromDfd}
          disabled={importing}
        >
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Import className="h-4 w-4" />
          )}
          DFDのデータストアから取り込み
        </Button>
        <div className="mx-0.5 h-5 w-px bg-gray-200" />
        <Button
          size="sm"
          variant={connectMode ? 'default' : 'ghost'}
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => {
            setConnectMode((m) => !m);
            setConnectSourceId(null);
            setConnectSourceHandle(null);
          }}
        >
          <Spline className="h-4 w-4" />
          関係線を追加
        </Button>
        <div className="mx-0.5 h-5 w-px bg-gray-200" />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addAnnotationAtCenter('STICKY')}
        >
          <StickyNote className="h-4 w-4 text-amber-500" />
          付箋
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => addAnnotationAtCenter('COMMENT')}
        >
          <MessageSquare className="h-4 w-4 text-gray-500" />
          メモ
        </Button>
      </div>

      {/* ===== ズーム操作（右下） ===== */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-gray-200 bg-white/95 p-1 shadow-sm">
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => zoomBy(1 / 1.25)} title="縮小">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-10 text-center text-[11px] tabular-nums text-gray-500">
          {Math.round(view.k * 100)}%
        </span>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => zoomBy(1.25)} title="拡大">
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={fitView} title="全体表示">
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* ===== 凡例（左下） ===== */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded-lg border border-gray-200 bg-white/95 px-2.5 py-1.5 shadow-sm">
        {RELATION_CARDINALITY_OPTIONS.map((opt) => {
          const s = CARDINALITY_STYLES[opt.value];
          return (
            <span key={opt.value} className="inline-flex items-center gap-1 text-[10px] text-gray-600">
              <span className="inline-block h-0.5 w-5 rounded" style={{ background: s.color }} />
              {s.short}（{opt.label}）
            </span>
          );
        })}
      </div>

      {/* ===== 接続モードのヒント ===== */}
      {connectMode && (
        <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700 shadow-sm">
          {connectSourceId
            ? '接続先のオブジェクト（または辺のノブ）をクリック（ESC で中断）'
            : '接続元のオブジェクト（または辺のノブ）をクリック（ESC で中断）'}
        </div>
      )}

      {/* ===== エッジ編集ポップ ===== */}
      {edgeEdit && editingRelation && (
        <div
          className="absolute z-10 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          style={{ left: edgeEdit.x, top: edgeEdit.y, transform: 'translate(-50%, 8px)' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="truncate text-xs font-semibold text-gray-700">
              {objectById.get(editingRelation.sourceObjectId)?.name ?? '?'}
              {' → '}
              {objectById.get(editingRelation.targetObjectId)?.name ?? '?'}
            </p>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600"
              onClick={() => setEdgeEdit(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">
                カーディナリティ
              </label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                value={editingRelation.cardinality}
                onChange={(e) =>
                  void onUpdateRelation(editingRelation.id, {
                    cardinality: e.target.value as RelationCardinality,
                  })
                }
              >
                {RELATION_CARDINALITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}（{CARDINALITY_STYLES[opt.value].short}）
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">線形</label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={editingRelation.pathStyle === 'straight' ? 'outline' : 'default'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => void onUpdateRelation(editingRelation.id, { pathStyle: null })}
                >
                  曲線（既定）
                </Button>
                <Button
                  size="sm"
                  variant={editingRelation.pathStyle === 'straight' ? 'default' : 'outline'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => void onUpdateRelation(editingRelation.id, { pathStyle: 'straight' })}
                >
                  直線
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-medium text-gray-500">始点辺</label>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={asSide(editingRelation.sourceHandle) ?? ''}
                  onChange={(e) =>
                    void onUpdateRelation(editingRelation.id, {
                      sourceHandle: e.target.value === '' ? null : e.target.value,
                    })
                  }
                >
                  {HANDLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[11px] font-medium text-gray-500">終点辺</label>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  value={asSide(editingRelation.targetHandle) ?? ''}
                  onChange={(e) =>
                    void onUpdateRelation(editingRelation.id, {
                      targetHandle: e.target.value === '' ? null : e.target.value,
                    })
                  }
                >
                  {HANDLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">ラベル</label>
              <Input
                className="h-8 text-sm"
                placeholder="例: 1つの注文は複数の明細を持つ"
                value={edgeLabelDraft}
                onChange={(e) => setEdgeLabelDraft(e.target.value)}
                onBlur={commitEdgeLabel}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitEdgeLabel();
                    setEdgeEdit(null);
                  }
                }}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full gap-1.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                if (!window.confirm('この関係線を削除しますか？')) return;
                setEdgeEdit(null);
                void onDeleteRelation(editingRelation.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              関係線を削除
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
