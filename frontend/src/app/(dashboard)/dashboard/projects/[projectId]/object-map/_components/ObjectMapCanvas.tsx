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
  Frame,
  Eye,
  EyeOff,
  Wand2,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SubProjectPicker, subProjectPath } from '@/components/ui/sub-project-picker';
import type { SubProjectMaster } from '@/lib/masters';
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
  OBJECT_COLORS,
  objectColor,
} from './object-map-shared';
import type { DiagramElementDto } from '@/lib/diagram-elements';
import { diagramElementApi } from '@/lib/diagram-elements';
import { nodeAttachmentApi } from '@/lib/node-attachments';
import { uploadProjectFile } from '@/lib/upload';
import { firstImageFile } from '@/components/diagram/diagram-drop';

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

/** スコープ囲みの既定サイズ・既定色（作成時） */
const SCOPE_W = 320;
const SCOPE_H = 200;
const SCOPE_MIN_W = 120;
const SCOPE_MIN_H = 80;
const DEFAULT_SCOPE_COLOR = '#6366f1'; // indigo

/** スコープ囲み編集パネルの色選択肢（オブジェクト色パレットを流用） */
const SCOPE_COLORS = OBJECT_COLORS;

/**
 * 「mermaidから生成」ダイアログのサンプル（erDiagram の実用例）。
 * バックエンドの import-mermaid は erDiagram/classDiagram/flowchart を解析する。
 */
const MERMAID_SAMPLE = `erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ ORDER_ITEM : contains
  PRODUCT ||--o{ ORDER_ITEM : "ordered in"
  CUSTOMER {
    string id
    string name
    string email
  }
  ORDER {
    string id
    date orderedAt
  }
  ORDER_ITEM {
    string id
    int quantity
  }
  PRODUCT {
    string id
    string name
    int price
  }`;

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
  /** 付箋/メモ/スコープ囲み（接続モード・オブジェクト選択の対象外） */
  annotations: DataObjectAnnotationDto[];
  /** 領域（SubProject）一覧。スコープ囲みの領域名表示・領域ピッカー用 */
  subProjects: SubProjectMaster[];
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  /** フォーカス要求対象のオブジェクトID（一覧パネルからのジャンプ用） */
  focusObjectId?: string | null;
  /** focusObjectId へビューを中央寄せするトリガ（インクリメントで発火） */
  focusNonce?: number;
  /** ノードドラッグ終了時（親側で楽観更新＋デバウンス保存する） */
  onObjectMoved: (id: string, x: number, y: number) => void;
  /**
   * 囲い move に追従して内包オブジェクトを一緒に動かす際の「位置のみ」確定。
   * 領域編入/はみ出し拡大の再計算を伴わない（囲い側の geometry 変更で別途行われるため）。
   * 省略時は onObjectMoved にフォールバック。
   */
  onObjectMovedSilent?: (id: string, x: number, y: number) => void;
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
  // ===== スコープ囲み（領域） =====
  /** スコープ囲みの作成（位置はビュー中心付近。既定サイズ/色はここで決める） */
  onAddScope: (positionX: number, positionY: number) => void | Promise<void>;
  /** スコープ囲みの移動/リサイズ確定時（楽観更新＋デバウンス保存＋applyScopeLinks は親が担う） */
  onScopeGeometryChanged: (
    id: string,
    geom: { positionX: number; positionY: number; width: number; height: number },
  ) => void;
  /** スコープ囲みのプロパティ更新（領域/色/枠線/表示）。subProjectId 変更時は親が applyScopeLinks する */
  onUpdateScope: (
    id: string,
    patch: {
      subProjectId?: string | null;
      color?: string | null;
      borderStyle?: 'dashed' | 'solid' | null;
      fillOpacity?: number | null;
      visible?: boolean | null;
    },
  ) => void | Promise<void>;
  onDeleteScope: (id: string) => void | Promise<void>;
  // ===== Mermaidから生成 =====
  /** Mermaid 記法から objects/relations を一括生成（生成後に親がグラフ再取得） */
  onImportMermaid: (mermaid: string) => Promise<void>;
  /** 閲覧専用。true のとき編集ツールバーを隠し、ドラッグ・接続・編集系操作を無効化する。 */
  readOnly?: boolean;
  // ===== 画像要素（ImageElement） =====
  /** このキャンバスに配置された画像要素一覧 */
  imageElements?: DiagramElementDto[];
  /** 画像要素ドロップ時の projectId（uploadProjectFile / diagramElementApi.create に使用） */
  projectId?: string;
  /** 画像要素が新規作成されたとき（親が楽観更新） */
  onImageCreated?: (el: DiagramElementDto) => void;
  /** 画像要素の移動/リサイズ確定時（親が楽観更新＋デバウンス保存） */
  onImageGeometryChanged?: (
    id: string,
    patch: { positionX?: number; positionY?: number; width?: number; height?: number },
  ) => void;
}

export function ObjectMapCanvas({
  objects,
  relations,
  annotations,
  subProjects,
  selectedObjectId,
  onSelectObject,
  focusObjectId,
  focusNonce,
  onObjectMoved: onObjectMovedRaw,
  onObjectMovedSilent: onObjectMovedSilentRaw,
  onCreateRelation: onCreateRelationRaw,
  onUpdateRelation: onUpdateRelationRaw,
  onDeleteRelation: onDeleteRelationRaw,
  onAddObject,
  onImportFromDfd,
  importing,
  onAddAnnotation: onAddAnnotationRaw,
  onAnnotationMoved: onAnnotationMovedRaw,
  onUpdateAnnotationText: onUpdateAnnotationTextRaw,
  onDeleteAnnotation: onDeleteAnnotationRaw,
  onAddScope: onAddScopeRaw,
  onScopeGeometryChanged: onScopeGeometryChangedRaw,
  onUpdateScope: onUpdateScopeRaw,
  onDeleteScope: onDeleteScopeRaw,
  onImportMermaid,
  readOnly = false,
  imageElements: imageElementsProp = [],
  projectId,
  onImageCreated,
  onImageGeometryChanged,
}: ObjectMapCanvasProps) {
  // 閲覧専用時は編集系コールバックを no-op に差し替える（ドラッグ確定・接続・編集・削除を無効化）。
  const noop = useCallback(() => {}, []);
  const onObjectMoved = readOnly ? noop : onObjectMovedRaw;
  const onObjectMovedSilent = readOnly ? noop : onObjectMovedSilentRaw ?? onObjectMovedRaw;
  const onCreateRelation = readOnly ? (async () => {}) : onCreateRelationRaw;
  const onUpdateRelation = readOnly ? (async () => {}) : onUpdateRelationRaw;
  const onDeleteRelation = readOnly ? (async () => {}) : onDeleteRelationRaw;
  const onAddAnnotation = readOnly ? (async () => {}) : onAddAnnotationRaw;
  const onAnnotationMoved = readOnly ? noop : onAnnotationMovedRaw;
  const onUpdateAnnotationText = readOnly ? (async () => {}) : onUpdateAnnotationTextRaw;
  const onDeleteAnnotation = readOnly ? (async () => {}) : onDeleteAnnotationRaw;
  const onAddScope = readOnly ? (async () => {}) : onAddScopeRaw;
  const onScopeGeometryChanged = readOnly ? noop : onScopeGeometryChangedRaw;
  const onUpdateScope = readOnly ? (async () => {}) : onUpdateScopeRaw;
  const onDeleteScope = readOnly ? (async () => {}) : onDeleteScopeRaw;

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

  // ===== スコープ囲み =====
  // 選択中のスコープ（編集パネル表示）。
  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  // 囲みの全体表示/非表示トグル（ローカル。各囲みの visible(永続) とは別レイヤ）
  const [scopesShown, setScopesShown] = useState(true);
  // ドラッグ/リサイズ中のスコープ位置・サイズの一時上書き（pointerup で確定）
  const [scopeDraft, setScopeDraft] = useState<
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});
  const scopeDragRef = useRef<
    | {
        id: string;
        mode: 'move' | 'resize';
        startX: number; // pointerdown 時のワールド座標
        startY: number;
        baseX: number; // pointerdown 時の矩形
        baseY: number;
        baseW: number;
        baseH: number;
        moved: boolean;
        // pointermove で更新する確定用の最新矩形（state は非同期なのでここで保持）
        last: { x: number; y: number; w: number; h: number };
      }
    | null
  >(null);
  // 囲い move 時に一緒に動かす内包オブジェクト（pointerdown 時にスナップショット）
  const scopeMembersRef = useRef<Array<{ id: string; baseX: number; baseY: number }>>([]);

  // ===== 画像要素（ImageElement） =====
  // ドロップで追加した画像要素の楽観的ローカル管理（親から受け取った配列にマージして使う）
  const [localImageElements, setLocalImageElements] = useState<DiagramElementDto[]>([]);
  // ドラッグ/リサイズ中の画像要素の一時ジオメトリ
  const [imageDraft, setImageDraft] = useState<
    Record<string, { x: number; y: number; w: number; h: number }>
  >({});
  const imageDragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    baseW: number;
    baseH: number;
    moved: boolean;
    last: { x: number; y: number; w: number; h: number };
  } | null>(null);
  // 選択中の画像要素ID（DataObject選択とは独立して管理）
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  // ドラッグドロップ中のオーバーレイ表示
  const [isDragOver, setIsDragOver] = useState(false);

  // 親から受け取った + ローカル楽観追加をマージした画像要素リスト
  const imageElements = useMemo(() => {
    const localIds = new Set(localImageElements.map((el) => el.id));
    return [
      ...imageElementsProp.filter((el) => !localIds.has(el.id)),
      ...localImageElements,
    ];
  }, [imageElementsProp, localImageElements]);

  // ===== Mermaidから生成ダイアログ =====
  const [showMermaidImport, setShowMermaidImport] = useState(false);
  const [mermaidImportText, setMermaidImportText] = useState('');
  const [mermaidImporting, setMermaidImporting] = useState(false);
  const [mermaidImportError, setMermaidImportError] = useState<string | null>(null);

  // 注釈を「スコープ囲み」と「付箋/メモ」に振り分け（描画レイヤ・操作系が異なる）
  const scopeAnnotations = useMemo(
    () => annotations.filter((a) => a.kind === 'SCOPE'),
    [annotations],
  );
  const noteAnnotations = useMemo(
    () => annotations.filter((a) => a.kind !== 'SCOPE'),
    [annotations],
  );

  const objectById = useMemo(() => new Map(objects.map((o) => [o.id, o] as const)), [objects]);
  const subProjectById = useMemo(
    () => new Map(subProjects.map((s) => [s.id, s] as const)),
    [subProjects],
  );
  const editingRelation = edgeEdit ? relations.find((r) => r.id === edgeEdit.id) ?? null : null;
  const selectedScope = selectedScopeId
    ? scopeAnnotations.find((a) => a.id === selectedScopeId) ?? null
    : null;

  const posOf = useCallback(
    (o: DataObjectDto): Point => dragPos[o.id] ?? { x: o.positionX, y: o.positionY },
    [dragPos],
  );

  // 付箋/メモもカードと同じ dragPos でドラッグ中位置を上書き（id はユニーク）
  const posOfAnnotation = useCallback(
    (a: DataObjectAnnotationDto): Point => dragPos[a.id] ?? { x: a.positionX, y: a.positionY },
    [dragPos],
  );

  // 一覧パネルからのフォーカス要求（focusNonce のインクリメントで発火）。
  // 対象オブジェクトの中心がビューポート中央に来るよう view を平行移動する。
  // 依存は focusNonce のみ（通常のカード選択ではフォーカスしない）。
  useEffect(() => {
    if (focusNonce === undefined || !focusObjectId) return;
    const obj = objectById.get(focusObjectId);
    const svg = svgRef.current;
    if (!obj || !svg) return;
    const rect = svg.getBoundingClientRect();
    const p = posOf(obj);
    const worldCx = p.x + CARD_W / 2;
    const worldCy = p.y + CARD_H / 2;
    setView((v) => ({
      ...v,
      x: Math.round(rect.width / 2 - worldCx * v.k),
      y: Math.round(rect.height / 2 - worldCy * v.k),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const screenToWorld = useCallback((clientX: number, clientY: number): Point => {
    const el = svgRef.current;
    const v = viewRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return { x: (clientX - rect.left - v.x) / v.k, y: (clientY - rect.top - v.y) / v.k };
  }, []);

  // ===== ホイール: ズーム（Ctrl+wheel / Macピンチ）/ パン（2本指スクロール） =====
  // React の onWheel は passive のため native で登録。
  // e.ctrlKey===true（Macのピンチや Ctrl+wheel）はズーム、それ以外（トラックパッド2本指
  // スクロール・通常ホイール）はパン（view を deltaX/deltaY ぶん動かす）。
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // ズーム（カーソル位置を中心に拡縮）
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        setView((v) => {
          const k = clamp(v.k * Math.exp(-e.deltaY * 0.0015), 0.25, 2.5);
          const wx = (px - v.x) / v.k;
          const wy = (py - v.y) / v.k;
          return { k, x: px - wx * k, y: py - wy * k };
        });
      } else {
        // パン（2本指スクロール）。横方向は deltaX、縦方向は deltaY。
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
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
      setSelectedScopeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ===== Backspace / Delete で選択中の矢印（関係）/ 囲い(SCOPE) を削除 =====
  // 編集ウィンドウが canvas からはみ出て削除ボタンを押せない時の代替手段。
  // 優先: 矢印(edgeEdit) → 囲い(selectedScopeId)。テキスト入力中は無視。readOnly 時は no-op。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Backspace' && e.key !== 'Delete') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (edgeEdit) {
        e.preventDefault();
        void onDeleteRelation(edgeEdit.id);
        setEdgeEdit(null);
      } else if (selectedScopeId) {
        e.preventDefault();
        void onDeleteScope(selectedScopeId);
        setSelectedScopeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [edgeEdit, selectedScopeId, onDeleteRelation, onDeleteScope]);

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

  // ===== スコープ囲み =====
  // 描画時の矩形（ドラッグ/リサイズ中は draft で上書き）
  const scopeRect = useCallback(
    (a: DataObjectAnnotationDto): { x: number; y: number; w: number; h: number } => {
      const d = scopeDraft[a.id];
      if (d) return d;
      return {
        x: a.positionX,
        y: a.positionY,
        w: a.width ?? SCOPE_W,
        h: a.height ?? SCOPE_H,
      };
    },
    [scopeDraft],
  );

  // スコープ囲みの新規作成位置 = 現在のビュー中心付近
  const addScopeAtCenter = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const c = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    void onAddScope(Math.round(c.x - SCOPE_W / 2), Math.round(c.y - SCOPE_H / 2));
  }, [screenToWorld, onAddScope]);

  // スコープ囲みのドラッグ移動 / 右下ハンドルでのリサイズ（pointerup で確定→親が保存＋紐付け）
  const handleScopePointerDown = useCallback(
    (e: ReactPointerEvent<SVGElement>, a: DataObjectAnnotationDto, mode: 'move' | 'resize') => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const world = screenToWorld(e.clientX, e.clientY);
      const base = scopeRect(a);
      scopeDragRef.current = {
        id: a.id,
        mode,
        startX: world.x,
        startY: world.y,
        baseX: base.x,
        baseY: base.y,
        baseW: base.w,
        baseH: base.h,
        moved: false,
        last: { x: base.x, y: base.y, w: base.w, h: base.h },
      };
      // ① 囲い move 時：中心が囲み矩形内のオブジェクトを「内包メンバー」としてスナップショットし、
      //    ドラッグ中は囲いと同じ delta で一緒に動かす（resize は動かさない）。
      if (mode === 'move') {
        scopeMembersRef.current = objects
          .map((o) => {
            const p = posOf(o);
            return { id: o.id, baseX: p.x, baseY: p.y, cx: p.x + CARD_W / 2, cy: p.y + CARD_H / 2 };
          })
          .filter(
            (m) =>
              m.cx >= base.x &&
              m.cx <= base.x + base.w &&
              m.cy >= base.y &&
              m.cy <= base.y + base.h,
          )
          .map(({ id, baseX, baseY }) => ({ id, baseX, baseY }));
      } else {
        scopeMembersRef.current = [];
      }
      setSelectedScopeId(a.id);

      const onMove = (ev: PointerEvent) => {
        const d = scopeDragRef.current;
        if (!d) return;
        const w = screenToWorld(ev.clientX, ev.clientY);
        const dx = w.x - d.startX;
        const dy = w.y - d.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
        const next =
          d.mode === 'move'
            ? { x: Math.round(d.baseX + dx), y: Math.round(d.baseY + dy), w: d.baseW, h: d.baseH }
            : {
                x: d.baseX,
                y: d.baseY,
                w: Math.max(SCOPE_MIN_W, Math.round(d.baseW + dx)),
                h: Math.max(SCOPE_MIN_H, Math.round(d.baseH + dy)),
              };
        d.last = next; // 確定用に最新値を ref に保持（state は非同期のため）
        setScopeDraft({ [d.id]: next });
        // 内包メンバーを同じ delta で一緒に移動（move のみ）
        if (d.mode === 'move' && scopeMembersRef.current.length > 0) {
          const memberPos: Record<string, Point> = {};
          for (const m of scopeMembersRef.current) {
            memberPos[m.id] = { x: Math.round(m.baseX + dx), y: Math.round(m.baseY + dy) };
          }
          setDragPos(memberPos);
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = scopeDragRef.current;
        scopeDragRef.current = null;
        const members = scopeMembersRef.current;
        scopeMembersRef.current = [];
        if (!d) return;
        if (d.moved) {
          onScopeGeometryChanged(d.id, {
            positionX: d.last.x,
            positionY: d.last.y,
            width: d.last.w,
            height: d.last.h,
          });
          // 内包メンバーの新位置を確定（囲いと同じ delta）。
          // 位置のみ確定（領域編入/はみ出し拡大の再計算なし）。それは囲い側の
          // geometry 変更（onScopeGeometryChanged→applyScopeLinks）で正しい新位置基準に行われる。
          if (d.mode === 'move' && members.length > 0) {
            const ddx = d.last.x - d.baseX;
            const ddy = d.last.y - d.baseY;
            for (const m of members) {
              onObjectMovedSilent(m.id, Math.round(m.baseX + ddx), Math.round(m.baseY + ddy));
            }
          }
        }
        setScopeDraft({});
        if (members.length > 0) setDragPos({});
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [screenToWorld, scopeRect, onScopeGeometryChanged, objects, posOf, onObjectMovedSilent],
  );

  // ===== 画像要素ドラッグ移動・右下ハンドルリサイズ（scope-box パターンをミラー） =====
  // 最小サイズ制約
  const IMG_MIN_W = 40;
  const IMG_MIN_H = 30;

  const handleImagePointerDown = useCallback(
    (
      e: ReactPointerEvent<SVGGElement | SVGRectElement>,
      el: DiagramElementDto,
      mode: 'move' | 'resize',
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (readOnly) return;
      const world = screenToWorld(e.clientX, e.clientY);
      const baseX = imageDraft[el.id]?.x ?? el.positionX;
      const baseY = imageDraft[el.id]?.y ?? el.positionY;
      const baseW = imageDraft[el.id]?.w ?? (el.width ?? 200);
      const baseH = imageDraft[el.id]?.h ?? (el.height ?? 150);
      imageDragRef.current = {
        id: el.id,
        mode,
        startX: world.x,
        startY: world.y,
        baseX,
        baseY,
        baseW,
        baseH,
        moved: false,
        last: { x: baseX, y: baseY, w: baseW, h: baseH },
      };
      setSelectedImageId(el.id);

      const onMove = (ev: PointerEvent) => {
        const d = imageDragRef.current;
        if (!d) return;
        const w = screenToWorld(ev.clientX, ev.clientY);
        const dx = w.x - d.startX;
        const dy = w.y - d.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
        const next =
          d.mode === 'move'
            ? { x: Math.round(d.baseX + dx), y: Math.round(d.baseY + dy), w: d.baseW, h: d.baseH }
            : {
                x: d.baseX,
                y: d.baseY,
                w: Math.max(IMG_MIN_W, Math.round(d.baseW + dx)),
                h: Math.max(IMG_MIN_H, Math.round(d.baseH + dy)),
              };
        d.last = next;
        setImageDraft({ [d.id]: next });
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const d = imageDragRef.current;
        imageDragRef.current = null;
        if (!d) return;
        if (d.moved) {
          const patch =
            d.mode === 'move'
              ? { positionX: d.last.x, positionY: d.last.y }
              : { width: d.last.w, height: d.last.h };
          onImageGeometryChanged?.(d.id, patch);
        }
        setImageDraft({});
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [readOnly, screenToWorld, imageDraft, onImageGeometryChanged],
  );

  // ===== Mermaidから生成 =====
  const handleMermaidImport = useCallback(async () => {
    if (!mermaidImportText.trim()) return;
    setMermaidImporting(true);
    setMermaidImportError(null);
    try {
      await onImportMermaid(mermaidImportText);
      setShowMermaidImport(false);
      setMermaidImportText('');
    } catch (err) {
      setMermaidImportError(err instanceof Error ? err.message : 'Mermaidからの生成に失敗しました');
    } finally {
      setMermaidImporting(false);
    }
  }, [mermaidImportText, onImportMermaid]);

  // ===== 画像ドロップ =====
  const handleSvgDragOver = useCallback((e: React.DragEvent<SVGSVGElement>) => {
    const files = Array.from(e.dataTransfer.files);
    // ドラッグ中は files が空のことが多い（type で代替判定）
    const types = Array.from(e.dataTransfer.types);
    if (readOnly) return;
    if (types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, [readOnly]);

  const handleSvgDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleSvgDrop = useCallback(
    async (e: React.DragEvent<SVGSVGElement>) => {
      e.preventDefault();
      setIsDragOver(false);
      if (readOnly || !projectId) return;
      const file = firstImageFile(Array.from(e.dataTransfer.files));
      if (!file) return;
      const world = screenToWorld(e.clientX, e.clientY);
      try {
        const att = await uploadProjectFile(projectId, file);
        const created = await diagramElementApi.create(projectId, {
          diagramKind: 'OBJECT_MAP',
          diagramId: projectId,
          type: 'IMAGE',
          attachmentId: att.id,
          positionX: Math.round(world.x - 100),
          positionY: Math.round(world.y - 75),
          width: 200,
          height: 150,
        });
        setLocalImageElements((prev) => [...prev, created]);
        onImageCreated?.(created);
        setSelectedImageId(created.id);
      } catch {
        // ドロップ失敗は静かに無視（ユーザーが気付かないのでコンソールは残す）
        console.error('Image drop failed');
      }
    },
    [readOnly, projectId, screenToWorld, onImageCreated],
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
          // クリック（パンなし）→ 選択解除・接続元解除・編集ポップ/注釈編集・スコープ選択・画像選択を閉じる
          onSelectObject(null);
          setConnectSourceId(null);
          setConnectSourceHandle(null);
          setEdgeEdit(null);
          setEditingAnnotationId(null);
          setSelectedScopeId(null);
          setSelectedImageId(null);
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
      {/* ドラッグオーバー時のインジケータ */}
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-400 bg-blue-50/40">
          <p className="rounded-md bg-white/90 px-4 py-2 text-sm font-medium text-blue-600 shadow">
            ここに画像をドロップ
          </p>
        </div>
      )}
      {/* ===== SVG キャンバス ===== */}
      <svg
        ref={svgRef}
        className="h-full w-full touch-none select-none"
        style={{ cursor: connectMode ? 'crosshair' : panRef.current ? 'grabbing' : 'default' }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleSvgPointerMove}
        onDragOver={handleSvgDragOver}
        onDragLeave={handleSvgDragLeave}
        onDrop={(e) => { void handleSvgDrop(e); }}
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
          {/* ===== スコープ囲み（最背面。低z。ドラッグ移動・右下ハンドルでリサイズ） =====
              囲みはオブジェクト選択/接続/関係線の対象にしない（専用ハンドルのみ反応）。 */}
          {scopesShown &&
            scopeAnnotations.map((a) => {
              if (a.visible === false) return null; // 個別非表示
              const r = scopeRect(a);
              const color = a.color && a.color.trim() !== '' ? a.color : DEFAULT_SCOPE_COLOR;
              const dashed = a.borderStyle !== 'solid'; // 未設定/dashed は点線
              const fillOpacity = a.fillOpacity ?? 0.08;
              const sp = a.subProjectId ? subProjectById.get(a.subProjectId) ?? null : null;
              const areaLabel = sp ? sp.name : '領域未設定';
              const selected = selectedScopeId === a.id;
              return (
                <g key={a.id}>
                  {/* 矩形本体（塗り＋枠）。本体ドラッグで移動 */}
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    rx={10}
                    fill={color}
                    fillOpacity={fillOpacity}
                    stroke={color}
                    strokeWidth={selected ? 2 : 1.5}
                    strokeDasharray={dashed ? '8 5' : undefined}
                    style={{ cursor: 'move' }}
                    onPointerDown={(e) => handleScopePointerDown(e, a, 'move')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedScopeId(a.id);
                    }}
                  />
                  {/* 左上の領域名ラベル */}
                  <foreignObject x={r.x + 6} y={r.y + 6} width={Math.max(40, r.w - 12)} height={22}>
                    <div className="pointer-events-none flex">
                      <span
                        className="inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-semibold text-white shadow-sm"
                        style={{ background: color }}
                      >
                        <Frame className="h-3 w-3 shrink-0" />
                        <span className="truncate">{areaLabel}</span>
                      </span>
                    </div>
                  </foreignObject>
                  {/* 右下リサイズハンドル */}
                  <rect
                    x={r.x + r.w - 9}
                    y={r.y + r.h - 9}
                    width={14}
                    height={14}
                    rx={3}
                    fill="#ffffff"
                    stroke={color}
                    strokeWidth={1.5}
                    style={{ cursor: 'nwse-resize' }}
                    onPointerDown={(e) => handleScopePointerDown(e, a, 'resize')}
                    onClick={(e) => e.stopPropagation()}
                  />
                </g>
              );
            })}

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

          {/* ===== 画像要素（付箋/メモの下・スコープ囲みの上。DataObject操作とは独立したレイヤ） ===== */}
          {imageElements.map((el) => {
            const draft = imageDraft[el.id];
            const x = draft?.x ?? el.positionX;
            const y = draft?.y ?? el.positionY;
            const w = draft?.w ?? (el.width ?? 200);
            const h = draft?.h ?? (el.height ?? 150);
            const isSelected = selectedImageId === el.id;
            return (
              <g
                key={el.id}
                transform={`translate(${x},${y})`}
                style={{ cursor: readOnly ? 'default' : 'grab' }}
                onPointerDown={(e) => handleImagePointerDown(e, el, 'move')}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedImageId(el.id);
                  // DataObject の選択は解除しない（画像クリックは独立）
                }}
              >
                {el.attachmentId && (
                  <image
                    href={nodeAttachmentApi.fileUrl(el.attachmentId)}
                    width={w}
                    height={h}
                    preserveAspectRatio="xMidYMid meet"
                    style={{ pointerEvents: 'none' }}
                  />
                )}
                {/* 透明ヒット領域（<image> のポインタイベントを確実に捕捉） */}
                <rect width={w} height={h} fill="transparent" />
                {/* 選択リング */}
                {isSelected && (
                  <>
                    <rect
                      x={-4}
                      y={-4}
                      width={w + 8}
                      height={h + 8}
                      rx={6}
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      pointerEvents="none"
                    />
                    {/* 右下リサイズハンドル（scope-box 同様） */}
                    {!readOnly && (
                      <rect
                        x={w - 9}
                        y={h - 9}
                        width={14}
                        height={14}
                        rx={3}
                        fill="#ffffff"
                        stroke="#3b82f6"
                        strokeWidth={1.5}
                        style={{ cursor: 'nwse-resize' }}
                        onPointerDown={(e) => handleImagePointerDown(e, el, 'resize')}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </>
                )}
              </g>
            );
          })}

          {/* ===== 付箋/メモ（接続モード・オブジェクト選択の対象外。カードの下層に描画） ===== */}
          {noteAnnotations.map((a) => {
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
        {!readOnly && (
          <>
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
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={addScopeAtCenter}
              title="領域（業務範囲）を囲む矩形を追加します"
            >
              <Frame className="h-4 w-4 text-indigo-500" />
              スコープ
            </Button>
            <div className="mx-0.5 h-5 w-px bg-gray-200" />
          </>
        )}
        <Button
          size="sm"
          variant={scopesShown ? 'ghost' : 'default'}
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => setScopesShown((s) => !s)}
          title="スコープ囲みの表示/非表示を切り替えます"
        >
          {scopesShown ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          囲み{scopesShown ? '表示' : '非表示'}
        </Button>
        {!readOnly && (
          <>
            <div className="mx-0.5 h-5 w-px bg-gray-200" />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => {
                setMermaidImportError(null);
                setShowMermaidImport(true);
              }}
              title="Mermaid記法からオブジェクトと関係を一括生成します"
            >
              <Wand2 className="h-4 w-4 text-violet-500" />
              mermaidから生成
            </Button>
          </>
        )}
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

      {/* ===== スコープ囲み編集パネル（右上。囲み選択時） ===== */}
      {selectedScope && (
        <div
          className="absolute right-3 top-3 z-10 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <Frame className="h-3.5 w-3.5 text-indigo-500" />
              スコープ囲み
            </p>
            <button
              type="button"
              className="text-gray-400 hover:text-gray-600"
              onClick={() => setSelectedScopeId(null)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            {/* 領域（SubProject） */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">領域</label>
              <SubProjectPicker
                subProjects={subProjects}
                value={selectedScope.subProjectId ?? ''}
                onChange={(v) =>
                  void onUpdateScope(selectedScope.id, { subProjectId: v === '' ? null : v })
                }
                placeholder="領域を選択（未設定）"
                className="w-full"
              />
              {selectedScope.subProjectId ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  この囲みの内側にあるオブジェクトを「
                  {subProjectPath(selectedScope.subProjectId, subProjects)}」に自動で紐付けます。
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-amber-600">
                  領域を選ぶと、囲みの内側のオブジェクトを自動でその領域に紐付けます。
                </p>
              )}
            </div>

            {/* 色 */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">色</label>
              <div className="flex flex-wrap items-center gap-1.5">
                {SCOPE_COLORS.map((c) => {
                  const cur =
                    selectedScope.color && selectedScope.color.trim() !== ''
                      ? selectedScope.color
                      : DEFAULT_SCOPE_COLOR;
                  return (
                    <button
                      key={c}
                      type="button"
                      className="h-5 w-5 rounded-full border-2 transition-transform hover:scale-110"
                      style={{ background: c, borderColor: c === cur ? '#0f172a' : 'transparent' }}
                      title={c}
                      onClick={() => void onUpdateScope(selectedScope.id, { color: c })}
                    />
                  );
                })}
              </div>
            </div>

            {/* 枠線 */}
            <div>
              <label className="mb-1 block text-[11px] font-medium text-gray-500">枠線</label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={(selectedScope.borderStyle ?? 'dashed') === 'dashed' ? 'default' : 'outline'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => void onUpdateScope(selectedScope.id, { borderStyle: 'dashed' })}
                >
                  点線
                </Button>
                <Button
                  size="sm"
                  variant={selectedScope.borderStyle === 'solid' ? 'default' : 'outline'}
                  className="h-7 flex-1 text-xs"
                  onClick={() => void onUpdateScope(selectedScope.id, { borderStyle: 'solid' })}
                >
                  実線
                </Button>
              </div>
            </div>

            {/* 表示/非表示トグル（永続） */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-500">この囲みを表示</span>
              <Button
                size="sm"
                variant={selectedScope.visible === false ? 'outline' : 'default'}
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() =>
                  void onUpdateScope(selectedScope.id, {
                    visible: selectedScope.visible === false ? true : false,
                  })
                }
              >
                {selectedScope.visible === false ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" />
                    非表示
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" />
                    表示
                  </>
                )}
              </Button>
            </div>

            {/* 削除 */}
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full gap-1.5 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => {
                if (!window.confirm('このスコープ囲みを削除しますか？')) return;
                setSelectedScopeId(null);
                void onDeleteScope(selectedScope.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              囲みを削除
            </Button>
          </div>
        </div>
      )}

      {/* ===== mermaidから生成ダイアログ ===== */}
      <Dialog
        open={showMermaidImport}
        onOpenChange={(open) => {
          if (!open && !mermaidImporting) setShowMermaidImport(false);
        }}
      >
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader>
            <DialogTitle className="text-gray-900">mermaidから生成</DialogTitle>
            <DialogDescription className="text-gray-500">
              Mermaid記法（erDiagram / classDiagram / flowchart）を貼り付けると、オブジェクトと関係線を解析してこのマップへ一括追加します。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={mermaidImportText}
            onChange={(e) => setMermaidImportText(e.target.value)}
            placeholder={'erDiagram\n  CUSTOMER ||--o{ ORDER : places'}
            rows={12}
            className="min-h-[240px] font-mono text-xs text-gray-800"
            disabled={mermaidImporting}
          />
          {mermaidImportError && (
            <div className="flex items-start gap-2 text-sm text-red-600">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{mermaidImportError}</span>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setMermaidImportText(MERMAID_SAMPLE)}
              disabled={mermaidImporting}
              className="mr-auto text-gray-600"
              title="サンプルで上書きします"
            >
              サンプルを表示
            </Button>
            <Button
              variant="outline"
              onClick={() => setShowMermaidImport(false)}
              disabled={mermaidImporting}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => void handleMermaidImport()}
              disabled={mermaidImporting || !mermaidImportText.trim()}
            >
              {mermaidImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
