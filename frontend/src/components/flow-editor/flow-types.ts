/**
 * 業務フロー描画の共有型。
 * （旧 BPMNFlowViewer から独立させ、新しい SwimlaneCanvas が参照する）
 */

export type Role = {
  id: string;
  name: string;
  color: string;
  type?: string;
  /** type==='SYSTEM' のとき参照するシステム（System マスタ）の id。 */
  systemId?: string | null;
  order?: number;
  laneHeight?: number;
};

/** ノード単位のクロスフロー入出力リンクの向き。 */
export type FlowLinkDirection = 'INPUT' | 'OUTPUT';

/**
 * ノードに紐づく情報種別（InformationType マスタ）の入出力リンク。
 * GET business-flows/:id のノードに `informationLinks` として含まれる。
 * direction で INPUT / OUTPUT を区別する。
 */
export type NodeInformationLink = {
  id: string;
  nodeId: string;
  informationTypeId: string;
  direction: FlowLinkDirection;
  order: number;
  informationType?: {
    id: string;
    name: string;
    category: string;
  } | null;
};

/** ノードに紐づくクロスフロー入出力リンク。 */
export type FlowNodeLink = {
  id: string;
  nodeId: string;
  direction: FlowLinkDirection;
  targetFlowId: string;
  targetFlowName?: string | null;
  targetNodeId?: string | null;
  targetNodeLabel?: string | null;
  label?: string | null;
  order?: number;
};

export type FlowDataNode = {
  id: string;
  type: string;
  label: string;
  description?: string;
  positionX: number;
  positionY: number;
  /** ノードの描画幅（手動リサイズの永続化）。未設定なら既定 NODE_W。 */
  width?: number | null;
  /** ノードの描画高さ（手動リサイズの永続化）。未設定なら既定 NODE_H。 */
  height?: number | null;
  order?: number;
  roleId?: string;
  role?: Role;
  hasChildFlow?: boolean;
  childFlowId?: string;
  childFlow?: { id: string; name: string };
  /** このノードを起点とするクロスフロー入出力リンク（GET フロー詳細に含まれる）。 */
  links?: FlowNodeLink[];
  /** このノードの INPUT/OUTPUT を情報種別マスタから選んだリンク（GET フロー詳細に含まれる）。 */
  informationLinks?: NodeInformationLink[];
  /** 処理時間（実カラム。旧 metadata.duration）。 */
  processingTime?: string | null;
  /** 今回の対応数（実カラム。旧 metadata.handledCount）。 */
  handledCount?: string | null;
  /** 補足（実カラム。旧 metadata.notes）。 */
  supplement?: string | null;
  /** ノードに紐づく補足情報（旧データの後方互換用）。 */
  metadata?: Record<string, unknown>;
};

/** 連携先フロー選択用の軽量フロー情報（project/:id/all のレスポンス）。 */
export type FlowSummary = {
  id: string;
  name: string;
  parentId?: string | null;
  depth?: number;
  kind?: 'ASIS' | 'TOBE';
  /** TOBEフローが対応する ASIS フローID（project/:id/all の toResponse が返す）。 */
  asisFlowId?: string | null;
};

/**
 * 矢印（エッジ）に紐づくAPIエンドポイント（FlowEdgeApiLink）。
 * GET business-flows/:id のエッジに `apiLinks` として含まれる。
 * PUT /flow-edges/:id/api-links（updateEdgeApiLinks）で全置換できる。
 */
export type FlowEdgeApiLink = {
  id: string;
  apiEndpointId: string;
  method: string;
  path: string;
  summary?: string | null;
};

export type FlowDataEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: string;
  /** 接続元ハンドルの辺（'top'|'right'|'bottom'|'left'）。再ルーティング/側固定用。 */
  sourceHandle?: string | null;
  /** 接続先ハンドルの辺（'top'|'right'|'bottom'|'left'）。 */
  targetHandle?: string | null;
  /** この矢印が運ぶ情報種別（source の OUTPUT → target の INPUT）。 */
  informationTypeId?: string | null;
  /** informationTypeId に対応する情報種別の埋め込み（GET フロー詳細に含まれる）。 */
  informationType?: {
    id: string;
    name: string;
    category: string;
  } | null;
  /** 線の形状: 'smoothstep'(角ばり,既定) | 'bezier'(曲線) | 'straight'(直線)。 */
  pathStyle?: string | null;
  /** ラベル文字のパス上位置（0〜1 の割合。未設定=0.5 中央）。 */
  labelT?: number | null;
  /** 運ぶ情報チップのパス上位置（0〜1 の割合。未設定=0.5 中央）。 */
  infoT?: number | null;
  /** この矢印に紐づくAPIエンドポイント（GET フロー詳細に含まれる）。 */
  apiLinks?: FlowEdgeApiLink[];
};

export type FlowData = {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  depth: number;
  /** ASIS | TOBE（新規。未指定は ASIS 扱い） */
  kind?: 'ASIS' | 'TOBE';
  /** HYPOTHESIS | CONFIRMED（Ph.1仮説→Ph.2確定） */
  confidence?: 'HYPOTHESIS' | 'CONFIRMED';
  /** ロール別スイムレーン高さの手動オーバーライド（{ [roleId]: height }）。 */
  laneHeights?: Record<string, number>;
  nodes: FlowDataNode[];
  edges: FlowDataEdge[];
  breadcrumbs: Array<{ id: string; name: string }>;
};

export type FlowNodeData = {
  label: string;
  description?: string;
  type: string;
  roleId?: string;
  roleName?: string;
  roleColor?: string;
  hasChildFlow?: boolean;
  childFlowId?: string;
  childFlowName?: string;
};

/**
 * フロー図に貼る注釈（付箋・コメント）。
 * flowData.nodes/edges とは別系統で扱い、整形/縦横転置/Undo-Redo の対象には含めない。
 * GET/POST/PATCH/DELETE /business-flows/:flowId/annotations[/:id] のレスポンスに対応。
 */
export type FlowAnnotation = {
  id: string;
  /**
   * STICKY=付箋（黄色）, COMMENT=コメント（白＋吹き出し風）, ICON=アイコン注釈（透明背景）,
   * SCOPE=スコープ囲み（業務領域を点線/背景色つき矩形で囲う）。
   */
  kind: 'STICKY' | 'COMMENT' | 'ICON' | 'SCOPE';
  text: string;
  positionX: number;
  positionY: number;
  /** 付箋/コメント/アイコンの描画幅（手動リサイズの永続化）。未設定なら既定サイズ。 */
  width?: number | null;
  /** 付箋/コメント/アイコンの描画高さ（手動リサイズの永続化）。未設定なら既定サイズ。 */
  height?: number | null;
  color?: string | null;
  /** kind==='ICON' のとき表示する lucide アイコン名（ICON_MAP のキー）。 */
  icon?: string | null;
  /** kind==='SCOPE' のときの枠線スタイル（'dashed' | 'solid'）。未設定は dashed 扱い。 */
  borderStyle?: 'dashed' | 'solid' | null;
  /** kind==='SCOPE' のときの背景塗りの不透明度（0〜1）。未設定は薄め既定。 */
  fillOpacity?: number | null;
  order: number;
};
