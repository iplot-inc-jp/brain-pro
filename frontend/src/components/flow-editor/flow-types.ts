/**
 * 業務フロー描画の共有型。
 * （旧 BPMNFlowViewer から独立させ、新しい SwimlaneCanvas が参照する）
 */

export type Role = {
  id: string;
  name: string;
  color: string;
  type?: string;
  order?: number;
  laneHeight?: number;
};

/** ノード単位のクロスフロー入出力リンクの向き。 */
export type FlowLinkDirection = 'INPUT' | 'OUTPUT';

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
  order?: number;
  roleId?: string;
  role?: Role;
  hasChildFlow?: boolean;
  childFlowId?: string;
  childFlow?: { id: string; name: string };
  /** このノードを起点とするクロスフロー入出力リンク（GET フロー詳細に含まれる）。 */
  links?: FlowNodeLink[];
  /** ノードに紐づく補足情報（処理時間・INPUT・OUTPUT・補足など）。 */
  metadata?: Record<string, unknown>;
};

/** 連携先フロー選択用の軽量フロー情報（project/:id/all のレスポンス）。 */
export type FlowSummary = {
  id: string;
  name: string;
  parentId?: string | null;
  depth?: number;
  kind?: 'ASIS' | 'TOBE';
};

export type FlowDataEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  condition?: string;
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
