import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors/domain.error';

export type FlowNodeType =
  | 'START'
  | 'END'
  | 'PROCESS'
  | 'DECISION'
  | 'SYSTEM_INTEGRATION'
  | 'MANUAL_OPERATION'
  | 'DATA_STORE';

export class FlowNode extends BaseEntity {
  private _flowId: string;
  private _type: FlowNodeType;
  private _label: string;
  private _description: string | null;
  private _positionX: number;
  private _positionY: number;
  private _roleId: string | null;
  private _childFlowId: string | null;
  private _processingTime: string | null;
  private _handledCount: string | null;
  private _supplement: string | null;
  private _metadata: Record<string, unknown>;

  constructor(props: {
    id: string;
    flowId: string;
    type?: FlowNodeType;
    label: string;
    description?: string | null;
    positionX: number;
    positionY: number;
    roleId?: string | null;
    childFlowId?: string | null;
    processingTime?: string | null;
    handledCount?: string | null;
    supplement?: string | null;
    metadata?: Record<string, unknown>;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    const now = new Date();
    super(props.id, props.createdAt ?? now, props.updatedAt ?? now);
    this._flowId = props.flowId;
    this._type = props.type ?? 'PROCESS';
    this._label = props.label;
    this._description = props.description ?? null;
    this._positionX = props.positionX;
    this._positionY = props.positionY;
    this._roleId = props.roleId ?? null;
    this._childFlowId = props.childFlowId ?? null;
    this._processingTime = props.processingTime ?? null;
    this._handledCount = props.handledCount ?? null;
    this._supplement = props.supplement ?? null;
    this._metadata = props.metadata ?? {};
  }

  get flowId(): string {
    return this._flowId;
  }

  get type(): FlowNodeType {
    return this._type;
  }

  get label(): string {
    return this._label;
  }

  get description(): string | null {
    return this._description;
  }

  get positionX(): number {
    return this._positionX;
  }

  get positionY(): number {
    return this._positionY;
  }

  get roleId(): string | null {
    return this._roleId;
  }

  get childFlowId(): string | null {
    return this._childFlowId;
  }

  get processingTime(): string | null {
    return this._processingTime;
  }

  get handledCount(): string | null {
    return this._handledCount;
  }

  get supplement(): string | null {
    return this._supplement;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get hasChildFlow(): boolean {
    return this._childFlowId !== null;
  }

  get isBusinessBlock(): boolean {
    return this._type === 'PROCESS' || this._type === 'DECISION';
  }

  updateLabel(label: string): void {
    if (!label || label.length === 0) {
      throw new ValidationError('Node label is required');
    }
    this._label = label;
  }

  updateDescription(description: string | null): void {
    this._description = description;
  }

  updatePosition(x: number, y: number): void {
    this._positionX = x;
    this._positionY = y;
  }

  updateType(type: FlowNodeType): void {
    this._type = type;
  }

  assignRole(roleId: string | null): void {
    this._roleId = roleId;
  }

  linkChildFlow(childFlowId: string): void {
    if (!this.isBusinessBlock) {
      throw new ValidationError('Only PROCESS or DECISION nodes can have child flows');
    }
    this._childFlowId = childFlowId;
  }

  unlinkChildFlow(): void {
    this._childFlowId = null;
  }

  updateMetadata(metadata: Record<string, unknown>): void {
    this._metadata = metadata;
  }

  updateProcessingTime(processingTime: string | null): void {
    this._processingTime = processingTime;
  }

  updateHandledCount(handledCount: string | null): void {
    this._handledCount = handledCount;
  }

  updateSupplement(supplement: string | null): void {
    this._supplement = supplement;
  }

  static create(props: {
    id: string;
    flowId: string;
    type?: FlowNodeType;
    label: string;
    description?: string | null;
    positionX: number;
    positionY: number;
    roleId?: string | null;
    processingTime?: string | null;
    handledCount?: string | null;
    supplement?: string | null;
  }): FlowNode {
    if (!props.label || props.label.length === 0) {
      throw new ValidationError('Node label is required');
    }
    return new FlowNode(props);
  }
}

