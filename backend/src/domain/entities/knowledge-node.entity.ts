import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';
import { normalizeLabel } from '../value-objects/normalize-label.vo';

export type KnowledgeNodeTypeValue = 'TAG' | 'ENTITY';

export interface CreateKnowledgeNodeProps {
  projectId: string;
  type: KnowledgeNodeTypeValue;
  entityKind?: string | null;
  label: string;
  normalizedLabel: string;
  description?: string | null;
  color?: string | null;
  mentionCount?: number;
  positionX?: number | null;
  positionY?: number | null;
}

export interface ReconstructKnowledgeNodeProps {
  id: string;
  projectId: string;
  type: KnowledgeNodeTypeValue;
  entityKind: string | null;
  label: string;
  normalizedLabel: string;
  description: string | null;
  color: string | null;
  mentionCount: number;
  positionX: number | null;
  positionY: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateKnowledgeNodeProps {
  label?: string;
  description?: string | null;
  color?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  entityKind?: string | null;
  type?: KnowledgeNodeTypeValue;
}

/**
 * ナレッジノード（タグ / 実体）エンティティ。文書横断で名寄せマージされる。
 */
export class KnowledgeNode extends BaseEntity {
  private readonly _projectId: string;
  private _type: KnowledgeNodeTypeValue;
  private _entityKind: string | null;
  private _label: string;
  private _normalizedLabel: string;
  private _description: string | null;
  private _color: string | null;
  private _mentionCount: number;
  private _positionX: number | null;
  private _positionY: number | null;

  private constructor(props: ReconstructKnowledgeNodeProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._projectId = props.projectId;
    this._type = props.type;
    this._entityKind = props.entityKind;
    this._label = props.label;
    this._normalizedLabel = props.normalizedLabel;
    this._description = props.description;
    this._color = props.color;
    this._mentionCount = props.mentionCount;
    this._positionX = props.positionX;
    this._positionY = props.positionY;
  }

  static create(props: CreateKnowledgeNodeProps, id: string): KnowledgeNode {
    if (!props.projectId) throw new ValidationError('Project ID is required');
    if (!props.label || !props.label.trim()) {
      throw new ValidationError('Node label is required');
    }
    if (!props.normalizedLabel) {
      throw new ValidationError('Normalized label is required');
    }
    const now = new Date();
    return new KnowledgeNode({
      id,
      projectId: props.projectId,
      type: props.type,
      entityKind: props.entityKind ?? null,
      label: props.label.trim(),
      normalizedLabel: props.normalizedLabel,
      description: props.description ?? null,
      color: props.color ?? null,
      mentionCount: props.mentionCount ?? 0,
      positionX: props.positionX ?? null,
      positionY: props.positionY ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstruct(props: ReconstructKnowledgeNodeProps): KnowledgeNode {
    return new KnowledgeNode(props);
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateKnowledgeNodeProps): void {
    if (props.label !== undefined && props.label.trim()) {
      this._label = props.label.trim();
      // 改名時は名寄せキー（normalizedLabel）も再計算する。
      // これを怠ると、改名後ノードが元の正規化キーのまま残り、別表記のマージ先と食い違う。
      this._normalizedLabel = normalizeLabel(this._label);
    }
    if (props.description !== undefined) {
      this._description = props.description?.trim() || null;
    }
    if (props.color !== undefined) this._color = props.color ?? null;
    if (props.positionX !== undefined) this._positionX = props.positionX;
    if (props.positionY !== undefined) this._positionY = props.positionY;
    if (props.entityKind !== undefined) {
      this._entityKind = props.entityKind?.trim() || null;
    }
    // type 変更時は normalizedLabel 再計算は不要（@@unique の衝突は永続層で検知）。
    if (props.type !== undefined) this._type = props.type;
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }
  get type(): KnowledgeNodeTypeValue {
    return this._type;
  }
  get entityKind(): string | null {
    return this._entityKind;
  }
  get label(): string {
    return this._label;
  }
  get normalizedLabel(): string {
    return this._normalizedLabel;
  }
  get description(): string | null {
    return this._description;
  }
  get color(): string | null {
    return this._color;
  }
  get mentionCount(): number {
    return this._mentionCount;
  }
  get positionX(): number | null {
    return this._positionX;
  }
  get positionY(): number | null {
    return this._positionY;
  }
}
