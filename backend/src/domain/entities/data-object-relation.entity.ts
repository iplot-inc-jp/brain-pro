import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type RelationCardinalityValue = 'ONE_TO_ONE' | 'ONE_TO_MANY' | 'MANY_TO_MANY';

/** 線形: 'straight'（null=既定の直線） | 'bezier'（曲線） */
export type RelationPathStyleValue = 'straight' | 'bezier';

/** 接続辺: 'top'|'right'|'bottom'|'left'、null=自動（カード中心間の交点アンカー） */
export type RelationHandleValue = 'top' | 'right' | 'bottom' | 'left';

export interface CreateDataObjectRelationProps {
  projectId: string;
  sourceObjectId: string;
  targetObjectId: string;
  cardinality?: RelationCardinalityValue;
  label?: string | null;
  description?: string | null;
  pathStyle?: RelationPathStyleValue | null;
  sourceHandle?: RelationHandleValue | null;
  targetHandle?: RelationHandleValue | null;
}

export interface ReconstructDataObjectRelationProps {
  id: string;
  projectId: string;
  sourceObjectId: string;
  targetObjectId: string;
  cardinality: RelationCardinalityValue;
  label: string | null;
  description: string | null;
  pathStyle: RelationPathStyleValue | null;
  sourceHandle: RelationHandleValue | null;
  targetHandle: RelationHandleValue | null;
  createdAt: Date;
  updatedAt: Date;
}

/** オブジェクト関係性マップの関係線（データオブジェクト間のリレーション） */
export class DataObjectRelation extends BaseEntity {
  private readonly _projectId: string;
  private _sourceObjectId: string;
  private _targetObjectId: string;
  private _cardinality: RelationCardinalityValue;
  private _label: string | null;
  private _description: string | null;
  private _pathStyle: RelationPathStyleValue | null;
  private _sourceHandle: RelationHandleValue | null;
  private _targetHandle: RelationHandleValue | null;

  private constructor(
    id: string,
    projectId: string,
    sourceObjectId: string,
    targetObjectId: string,
    cardinality: RelationCardinalityValue,
    label: string | null,
    description: string | null,
    pathStyle: RelationPathStyleValue | null,
    sourceHandle: RelationHandleValue | null,
    targetHandle: RelationHandleValue | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._sourceObjectId = sourceObjectId;
    this._targetObjectId = targetObjectId;
    this._cardinality = cardinality;
    this._label = label;
    this._description = description;
    this._pathStyle = pathStyle;
    this._sourceHandle = sourceHandle;
    this._targetHandle = targetHandle;
  }

  private static assertEndpoints(sourceObjectId: string, targetObjectId: string): void {
    if (!sourceObjectId) throw new ValidationError('Source object ID is required');
    if (!targetObjectId) throw new ValidationError('Target object ID is required');
    if (sourceObjectId === targetObjectId) {
      throw new ValidationError('Source and target objects must be different');
    }
  }

  static create(props: CreateDataObjectRelationProps, id: string): DataObjectRelation {
    if (!props.projectId) throw new ValidationError('Project ID is required');
    DataObjectRelation.assertEndpoints(props.sourceObjectId, props.targetObjectId);
    const now = new Date();
    return new DataObjectRelation(
      id,
      props.projectId,
      props.sourceObjectId,
      props.targetObjectId,
      props.cardinality ?? 'ONE_TO_MANY',
      props.label ?? null,
      props.description ?? null,
      props.pathStyle ?? null,
      props.sourceHandle ?? null,
      props.targetHandle ?? null,
      now,
      now,
    );
  }

  static reconstruct(props: ReconstructDataObjectRelationProps): DataObjectRelation {
    return new DataObjectRelation(
      props.id,
      props.projectId,
      props.sourceObjectId,
      props.targetObjectId,
      props.cardinality,
      props.label,
      props.description,
      props.pathStyle,
      props.sourceHandle,
      props.targetHandle,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** 端点の付け替え（source=target は拒否） */
  updateEndpoints(sourceObjectId: string, targetObjectId: string): void {
    DataObjectRelation.assertEndpoints(sourceObjectId, targetObjectId);
    this._sourceObjectId = sourceObjectId;
    this._targetObjectId = targetObjectId;
    this.touch();
  }

  updateCardinality(cardinality: RelationCardinalityValue): void {
    this._cardinality = cardinality;
    this.touch();
  }

  updateLabel(label: string | null): void {
    this._label = label ?? null;
    this.touch();
  }

  updateDescription(description: string | null): void {
    this._description = description ?? null;
    this.touch();
  }

  /** 線形の変更（null=既定の直線へ戻す） */
  updatePathStyle(pathStyle: RelationPathStyleValue | null): void {
    this._pathStyle = pathStyle ?? null;
    this.touch();
  }

  /** 接続辺の変更（null=自動アンカーへ戻す） */
  updateHandles(
    sourceHandle: RelationHandleValue | null,
    targetHandle: RelationHandleValue | null,
  ): void {
    this._sourceHandle = sourceHandle ?? null;
    this._targetHandle = targetHandle ?? null;
    this.touch();
  }

  get projectId(): string { return this._projectId; }
  get sourceObjectId(): string { return this._sourceObjectId; }
  get targetObjectId(): string { return this._targetObjectId; }
  get cardinality(): RelationCardinalityValue { return this._cardinality; }
  get label(): string | null { return this._label; }
  get description(): string | null { return this._description; }
  get pathStyle(): RelationPathStyleValue | null { return this._pathStyle; }
  get sourceHandle(): RelationHandleValue | null { return this._sourceHandle; }
  get targetHandle(): RelationHandleValue | null { return this._targetHandle; }
}
