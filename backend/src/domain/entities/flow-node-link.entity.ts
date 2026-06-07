import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

/**
 * リンク方向（Prisma enum FlowLinkDirection と一致）
 * INPUT: 他フローからこのノードへの入力
 * OUTPUT: このノードから他フローへの出力
 */
export type FlowLinkDirectionValue = 'INPUT' | 'OUTPUT';

export interface CreateFlowNodeLinkProps {
  nodeId: string;
  direction: FlowLinkDirectionValue;
  targetFlowId: string;
  targetNodeId?: string | null;
  label?: string | null;
  order?: number;
}

export interface ReconstructFlowNodeLinkProps {
  id: string;
  nodeId: string;
  direction: FlowLinkDirectionValue;
  targetFlowId: string;
  targetNodeId: string | null;
  label: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * クロスフロー入出力リンク
 * あるフローのノードを別フロー（任意で別ノード）へ接続する
 */
export class FlowNodeLink extends BaseEntity {
  private readonly _nodeId: string;
  private _direction: FlowLinkDirectionValue;
  private _targetFlowId: string;
  private _targetNodeId: string | null;
  private _label: string | null;
  private _order: number;

  private constructor(
    id: string,
    nodeId: string,
    direction: FlowLinkDirectionValue,
    targetFlowId: string,
    targetNodeId: string | null,
    label: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._nodeId = nodeId;
    this._direction = direction;
    this._targetFlowId = targetFlowId;
    this._targetNodeId = targetNodeId;
    this._label = label;
    this._order = order;
  }

  /**
   * 新規リンク作成
   */
  static create(props: CreateFlowNodeLinkProps, id: string): FlowNodeLink {
    if (!props.nodeId) {
      throw new ValidationError('Node ID is required');
    }
    if (!props.targetFlowId) {
      throw new ValidationError('Target flow ID is required');
    }
    if (props.direction !== 'INPUT' && props.direction !== 'OUTPUT') {
      throw new ValidationError('Direction must be INPUT or OUTPUT');
    }

    const now = new Date();
    return new FlowNodeLink(
      id,
      props.nodeId,
      props.direction,
      props.targetFlowId,
      props.targetNodeId ?? null,
      props.label?.trim() || null,
      props.order ?? 0,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructFlowNodeLinkProps): FlowNodeLink {
    return new FlowNodeLink(
      props.id,
      props.nodeId,
      props.direction,
      props.targetFlowId,
      props.targetNodeId,
      props.label,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  updateLabel(label: string | null): void {
    this._label = label?.trim() || null;
    this.touch();
  }

  retarget(targetFlowId: string, targetNodeId: string | null): void {
    if (!targetFlowId) {
      throw new ValidationError('Target flow ID is required');
    }
    this._targetFlowId = targetFlowId;
    this._targetNodeId = targetNodeId ?? null;
    this.touch();
  }

  changeDirection(direction: FlowLinkDirectionValue): void {
    if (direction !== 'INPUT' && direction !== 'OUTPUT') {
      throw new ValidationError('Direction must be INPUT or OUTPUT');
    }
    this._direction = direction;
    this.touch();
  }

  // ========== Getter ==========

  get nodeId(): string {
    return this._nodeId;
  }

  get direction(): FlowLinkDirectionValue {
    return this._direction;
  }

  get targetFlowId(): string {
    return this._targetFlowId;
  }

  get targetNodeId(): string | null {
    return this._targetNodeId;
  }

  get label(): string | null {
    return this._label;
  }

  get order(): number {
    return this._order;
  }
}
