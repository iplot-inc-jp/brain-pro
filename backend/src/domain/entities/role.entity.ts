import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type RoleType = 'HUMAN' | 'SYSTEM' | 'OTHER';

export interface CreateRoleProps {
  projectId: string;
  name: string;
  type: RoleType;
  description?: string | null;
  color?: string | null;
  responsibility?: string | null;
  decisionScope?: string | null;
  kpi?: string | null;
  // 所属システム / サブ領域（共通マスタ基盤。任意）
  systemId?: string | null;
  subProjectId?: string | null;
}

export interface ReconstructRoleProps {
  id: string;
  projectId: string;
  name: string;
  type: RoleType;
  description: string | null;
  color: string | null;
  order?: number;
  laneHeight?: number;
  responsibility?: string | null;
  decisionScope?: string | null;
  kpi?: string | null;
  // 所属システム / サブ領域（共通マスタ基盤。任意）
  systemId?: string | null;
  subProjectId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ロールエンティティ
 * 業務フローの担当者（人/システム/その他）
 */
export class Role extends BaseEntity {
  private readonly _projectId: string;
  private _name: string;
  private _type: RoleType;
  private _description: string | null;
  private _color: string | null;
  private _order: number;
  private _laneHeight: number;
  private _responsibility: string | null;
  private _decisionScope: string | null;
  private _kpi: string | null;
  // 所属システム / サブ領域（共通マスタ基盤。任意）
  private _systemId: string | null;
  private _subProjectId: string | null;

  private constructor(
    id: string,
    projectId: string,
    name: string,
    type: RoleType,
    description: string | null,
    color: string | null,
    order: number,
    laneHeight: number,
    responsibility: string | null,
    decisionScope: string | null,
    kpi: string | null,
    systemId: string | null,
    subProjectId: string | null,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._name = name;
    this._type = type;
    this._description = description;
    this._color = color;
    this._order = order;
    this._laneHeight = laneHeight;
    this._responsibility = responsibility;
    this._decisionScope = decisionScope;
    this._kpi = kpi;
    this._systemId = systemId;
    this._subProjectId = subProjectId;
  }

  /**
   * 新規ロール作成
   */
  static create(props: CreateRoleProps, id: string): Role {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const name = props.name?.trim();
    if (!name || name.length < 1) {
      throw new ValidationError('Role name is required');
    }
    if (name.length > 50) {
      throw new ValidationError('Role name must be at most 50 characters');
    }

    if (!['HUMAN', 'SYSTEM', 'OTHER'].includes(props.type)) {
      throw new ValidationError('Invalid role type');
    }

    const color = props.color ? Role.validateColor(props.color) : null;

    const now = new Date();
    return new Role(
      id,
      props.projectId,
      name,
      props.type,
      props.description?.trim() || null,
      color,
      0, // default order
      120, // default laneHeight
      props.responsibility?.trim() || null,
      props.decisionScope?.trim() || null,
      props.kpi?.trim() || null,
      props.systemId ?? null,
      props.subProjectId ?? null,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructRoleProps): Role {
    return new Role(
      props.id,
      props.projectId,
      props.name,
      props.type,
      props.description,
      props.color,
      props.order ?? 0,
      props.laneHeight ?? 120,
      props.responsibility ?? null,
      props.decisionScope ?? null,
      props.kpi ?? null,
      props.systemId ?? null,
      props.subProjectId ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  private static validateColor(color: string): string {
    const hexColorRegex = /^#[0-9A-Fa-f]{6}$/;
    if (!hexColorRegex.test(color)) {
      throw new ValidationError('Color must be a valid hex color (e.g., #3B82F6)');
    }
    return color.toUpperCase();
  }

  changeName(name: string): void {
    const trimmed = name?.trim();
    if (!trimmed || trimmed.length < 1) {
      throw new ValidationError('Role name is required');
    }
    if (trimmed.length > 50) {
      throw new ValidationError('Role name must be at most 50 characters');
    }
    this._name = trimmed;
    this.touch();
  }

  changeType(type: RoleType): void {
    if (!['HUMAN', 'SYSTEM', 'OTHER'].includes(type)) {
      throw new ValidationError('Invalid role type');
    }
    this._type = type;
    this.touch();
  }

  changeDescription(description: string | null): void {
    this._description = description?.trim() || null;
    this.touch();
  }

  changeColor(color: string | null): void {
    this._color = color ? Role.validateColor(color) : null;
    this.touch();
  }

  changeResponsibility(responsibility: string | null): void {
    this._responsibility = responsibility?.trim() || null;
    this.touch();
  }

  changeDecisionScope(decisionScope: string | null): void {
    this._decisionScope = decisionScope?.trim() || null;
    this.touch();
  }

  changeKpi(kpi: string | null): void {
    this._kpi = kpi?.trim() || null;
    this.touch();
  }

  // 所属システムを設定/解除（共通マスタ基盤。任意）
  changeSystemId(systemId: string | null): void {
    this._systemId = systemId ?? null;
    this.touch();
  }

  // 所属サブ領域を設定/解除（共通マスタ基盤。任意）
  changeSubProjectId(subProjectId: string | null): void {
    this._subProjectId = subProjectId ?? null;
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get type(): RoleType {
    return this._type;
  }

  get description(): string | null {
    return this._description;
  }

  get color(): string | null {
    return this._color;
  }

  get responsibility(): string | null {
    return this._responsibility;
  }

  get decisionScope(): string | null {
    return this._decisionScope;
  }

  get kpi(): string | null {
    return this._kpi;
  }

  get systemId(): string | null {
    return this._systemId;
  }

  get subProjectId(): string | null {
    return this._subProjectId;
  }

  get order(): number {
    return this._order;
  }

  get laneHeight(): number {
    return this._laneHeight;
  }

  /**
   * ロールが人間かどうか
   */
  isHuman(): boolean {
    return this._type === 'HUMAN';
  }

  /**
   * ロールがシステムかどうか
   */
  isSystem(): boolean {
    return this._type === 'SYSTEM';
  }

  /**
   * 並び順を変更
   */
  changeOrder(order: number): void {
    this._order = order;
    this.touch();
  }

  /**
   * レーン高さを変更
   */
  changeLaneHeight(height: number): void {
    if (height < 60 || height > 500) {
      throw new ValidationError('Lane height must be between 60 and 500');
    }
    this._laneHeight = height;
    this.touch();
  }
}

