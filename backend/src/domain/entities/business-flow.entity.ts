import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors/domain.error';

export type FlowKindValue = 'ASIS' | 'TOBE';
export type FlowConfidenceValue = 'HYPOTHESIS' | 'CONFIRMED';

export class BusinessFlow extends BaseEntity {
  private _projectId: string;
  private _name: string;
  private _description: string | null;
  private _version: number;
  private _kind: FlowKindValue;
  private _confidence: FlowConfidenceValue;
  private _subProjectId: string | null;
  private _folderId: string | null;
  private _parentId: string | null;
  private _depth: number;
  private _laneHeights: Record<string, number>;

  constructor(props: {
    id: string;
    projectId: string;
    name: string;
    description?: string | null;
    version?: number;
    kind?: FlowKindValue;
    confidence?: FlowConfidenceValue;
    subProjectId?: string | null;
    folderId?: string | null;
    parentId?: string | null;
    depth?: number;
    laneHeights?: Record<string, number> | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    const now = new Date();
    super(props.id, props.createdAt ?? now, props.updatedAt ?? now);
    this._projectId = props.projectId;
    this._name = props.name;
    this._description = props.description ?? null;
    this._version = props.version ?? 1;
    this._kind = props.kind ?? 'ASIS';
    this._confidence = props.confidence ?? 'HYPOTHESIS';
    this._subProjectId = props.subProjectId ?? null;
    this._folderId = props.folderId ?? null;
    this._parentId = props.parentId ?? null;
    this._depth = props.depth ?? 0;
    this._laneHeights = props.laneHeights ?? {};
  }

  get projectId(): string {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get description(): string | null {
    return this._description;
  }

  get version(): number {
    return this._version;
  }

  get kind(): FlowKindValue {
    return this._kind;
  }

  get confidence(): FlowConfidenceValue {
    return this._confidence;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }

  get folderId(): string | null {
    return this._folderId;
  }

  get parentId(): string | null {
    return this._parentId;
  }

  get depth(): number {
    return this._depth;
  }

  /** ロール別レーン高さの手動オーバーライド（{ [roleId]: height }）。 */
  get laneHeights(): Record<string, number> {
    return this._laneHeights;
  }

  get isRootFlow(): boolean {
    return this._parentId === null;
  }

  get isChildFlow(): boolean {
    return this._parentId !== null;
  }

  updateName(name: string): void {
    if (!name || name.length === 0) {
      throw new ValidationError('Business flow name is required');
    }
    this._name = name;
  }

  updateDescription(description: string | null): void {
    this._description = description;
  }

  incrementVersion(): void {
    this._version += 1;
  }

  setParent(parentId: string | null, depth: number): void {
    this._parentId = parentId;
    this._depth = depth;
  }

  setKind(kind: FlowKindValue): void {
    this._kind = kind;
  }

  setConfidence(confidence: FlowConfidenceValue): void {
    this._confidence = confidence;
  }

  setSubProject(subProjectId: string | null): void {
    this._subProjectId = subProjectId;
  }

  setFolder(folderId: string | null): void {
    this._folderId = folderId;
  }

  /** Ph.1 仮説 → Ph.2 確定 への昇格 */
  promoteToConfirmed(): void {
    this._confidence = 'CONFIRMED';
  }

  static create(props: {
    id: string;
    projectId: string;
    name: string;
    description?: string | null;
    kind?: FlowKindValue;
    confidence?: FlowConfidenceValue;
    subProjectId?: string | null;
    folderId?: string | null;
    parentId?: string | null;
    depth?: number;
  }): BusinessFlow {
    if (!props.name || props.name.length === 0) {
      throw new ValidationError('Business flow name is required');
    }
    return new BusinessFlow({
      ...props,
      version: 1,
      depth: props.depth ?? (props.parentId ? 1 : 0),
    });
  }

  static createChildFlow(props: {
    id: string;
    projectId: string;
    name: string;
    description?: string | null;
    parentId: string;
    parentDepth: number;
  }): BusinessFlow {
    return new BusinessFlow({
      id: props.id,
      projectId: props.projectId,
      name: props.name,
      description: props.description,
      version: 1,
      parentId: props.parentId,
      depth: props.parentDepth + 1,
    });
  }
}

