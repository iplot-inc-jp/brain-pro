import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

/** KPIの区分: 業務KPI / AI精度KPI */
export type KpiCategoryValue = 'BUSINESS' | 'AI_QUALITY';
/** 望ましい方向: 増やす / 減らす / 維持 */
export type KpiDirectionValue = 'INCREASE' | 'DECREASE' | 'MAINTAIN';
/** 測定頻度 */
export type KpiFrequencyValue = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
/** ステータス: 下書き / 運用中 / アーカイブ */
export type KpiStatusValue = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export const KPI_CATEGORIES: readonly KpiCategoryValue[] = ['BUSINESS', 'AI_QUALITY'];
export const KPI_DIRECTIONS: readonly KpiDirectionValue[] = ['INCREASE', 'DECREASE', 'MAINTAIN'];
export const KPI_FREQUENCIES: readonly KpiFrequencyValue[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY'];
export const KPI_STATUSES: readonly KpiStatusValue[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];

/** SMART採点（0〜5）の検証 */
function validateSmartScore(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 5) {
    throw new ValidationError(`${label} は 0〜5 の整数で指定してください`);
  }
  return value;
}

export interface CreateKpiProps {
  projectId: string;
  name: string;
  category?: KpiCategoryValue;
  flowId?: string | null;
  asisFlowId?: string | null;
  tobeFlowId?: string | null;
  systemId?: string | null;
  description?: string | null;
  definition?: string | null;
  unit?: string | null;
  baselineValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  direction?: KpiDirectionValue;
  frequency?: KpiFrequencyValue;
  measurementMethod?: string | null;
  ownerRoleId?: string | null;
  smartSpecific?: number | null;
  smartMeasurable?: number | null;
  smartAchievable?: number | null;
  smartRelevant?: number | null;
  smartTimeBound?: number | null;
  smartComment?: string | null;
  aiGenerated?: boolean;
  status?: KpiStatusValue;
  order?: number;
}

export interface ReconstructKpiProps {
  id: string;
  projectId: string;
  category: KpiCategoryValue;
  flowId: string | null;
  asisFlowId: string | null;
  tobeFlowId: string | null;
  systemId: string | null;
  name: string;
  description: string | null;
  definition: string | null;
  unit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
  direction: KpiDirectionValue;
  frequency: KpiFrequencyValue;
  measurementMethod: string | null;
  ownerRoleId: string | null;
  smartSpecific: number | null;
  smartMeasurable: number | null;
  smartAchievable: number | null;
  smartRelevant: number | null;
  smartTimeBound: number | null;
  smartComment: string | null;
  aiGenerated: boolean;
  status: KpiStatusValue;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * KPI（業務KPI / AI精度KPI）。
 * 業務フロー・システム・情報種別（測定対象のINPUT/OUTPUT）に紐づく測定指標。
 * AI生成（GenerateKpis）の場合は aiGenerated=true・status=DRAFT で保存される。
 */
export class Kpi extends BaseEntity {
  private readonly _projectId: string;
  private _category: KpiCategoryValue;
  private _flowId: string | null;
  private _asisFlowId: string | null;
  private _tobeFlowId: string | null;
  private _systemId: string | null;
  private _name: string;
  private _description: string | null;
  private _definition: string | null;
  private _unit: string | null;
  private _baselineValue: number | null;
  private _targetValue: number | null;
  private _currentValue: number | null;
  private _direction: KpiDirectionValue;
  private _frequency: KpiFrequencyValue;
  private _measurementMethod: string | null;
  private _ownerRoleId: string | null;
  private _smartSpecific: number | null;
  private _smartMeasurable: number | null;
  private _smartAchievable: number | null;
  private _smartRelevant: number | null;
  private _smartTimeBound: number | null;
  private _smartComment: string | null;
  private _aiGenerated: boolean;
  private _status: KpiStatusValue;
  private _order: number;

  private constructor(props: ReconstructKpiProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._projectId = props.projectId;
    this._category = props.category;
    this._flowId = props.flowId;
    this._asisFlowId = props.asisFlowId;
    this._tobeFlowId = props.tobeFlowId;
    this._systemId = props.systemId;
    this._name = props.name;
    this._description = props.description;
    this._definition = props.definition;
    this._unit = props.unit;
    this._baselineValue = props.baselineValue;
    this._targetValue = props.targetValue;
    this._currentValue = props.currentValue;
    this._direction = props.direction;
    this._frequency = props.frequency;
    this._measurementMethod = props.measurementMethod;
    this._ownerRoleId = props.ownerRoleId;
    this._smartSpecific = props.smartSpecific;
    this._smartMeasurable = props.smartMeasurable;
    this._smartAchievable = props.smartAchievable;
    this._smartRelevant = props.smartRelevant;
    this._smartTimeBound = props.smartTimeBound;
    this._smartComment = props.smartComment;
    this._aiGenerated = props.aiGenerated;
    this._status = props.status;
    this._order = props.order;
  }

  static create(props: CreateKpiProps, id: string): Kpi {
    if (!props.projectId) throw new ValidationError('Project ID is required');
    const name = props.name?.trim();
    if (!name) throw new ValidationError('KPI名は必須です');
    const now = new Date();
    return new Kpi({
      id,
      projectId: props.projectId,
      category: props.category ?? 'BUSINESS',
      flowId: props.flowId ?? null,
      asisFlowId: props.asisFlowId ?? null,
      tobeFlowId: props.tobeFlowId ?? null,
      systemId: props.systemId ?? null,
      name,
      description: props.description ?? null,
      definition: props.definition ?? null,
      unit: props.unit ?? null,
      baselineValue: props.baselineValue ?? null,
      targetValue: props.targetValue ?? null,
      currentValue: props.currentValue ?? null,
      direction: props.direction ?? 'INCREASE',
      frequency: props.frequency ?? 'MONTHLY',
      measurementMethod: props.measurementMethod ?? null,
      ownerRoleId: props.ownerRoleId ?? null,
      smartSpecific: validateSmartScore(props.smartSpecific ?? null, 'smartSpecific'),
      smartMeasurable: validateSmartScore(props.smartMeasurable ?? null, 'smartMeasurable'),
      smartAchievable: validateSmartScore(props.smartAchievable ?? null, 'smartAchievable'),
      smartRelevant: validateSmartScore(props.smartRelevant ?? null, 'smartRelevant'),
      smartTimeBound: validateSmartScore(props.smartTimeBound ?? null, 'smartTimeBound'),
      smartComment: props.smartComment ?? null,
      aiGenerated: props.aiGenerated ?? false,
      status: props.status ?? 'DRAFT',
      order: props.order ?? 0,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstruct(props: ReconstructKpiProps): Kpi {
    return new Kpi(props);
  }

  updateName(name: string): void {
    const trimmed = name?.trim();
    if (!trimmed) throw new ValidationError('KPI名は必須です');
    this._name = trimmed;
    this.touch();
  }

  updateCategory(category: KpiCategoryValue): void {
    this._category = category;
    this.touch();
  }

  updateFlowId(flowId: string | null): void {
    this._flowId = flowId ?? null;
    this.touch();
  }

  updateAsisFlowId(flowId: string | null): void {
    this._asisFlowId = flowId ?? null;
    this.touch();
  }

  updateTobeFlowId(flowId: string | null): void {
    this._tobeFlowId = flowId ?? null;
    this.touch();
  }

  updateSystemId(systemId: string | null): void {
    this._systemId = systemId ?? null;
    this.touch();
  }

  updateDescription(description: string | null): void {
    this._description = description ?? null;
    this.touch();
  }

  updateDefinition(definition: string | null): void {
    this._definition = definition ?? null;
    this.touch();
  }

  updateUnit(unit: string | null): void {
    this._unit = unit ?? null;
    this.touch();
  }

  updateBaselineValue(value: number | null): void {
    this._baselineValue = value ?? null;
    this.touch();
  }

  updateTargetValue(value: number | null): void {
    this._targetValue = value ?? null;
    this.touch();
  }

  updateCurrentValue(value: number | null): void {
    this._currentValue = value ?? null;
    this.touch();
  }

  updateDirection(direction: KpiDirectionValue): void {
    this._direction = direction;
    this.touch();
  }

  updateFrequency(frequency: KpiFrequencyValue): void {
    this._frequency = frequency;
    this.touch();
  }

  updateMeasurementMethod(method: string | null): void {
    this._measurementMethod = method ?? null;
    this.touch();
  }

  updateOwnerRoleId(roleId: string | null): void {
    this._ownerRoleId = roleId ?? null;
    this.touch();
  }

  updateSmartScores(scores: {
    smartSpecific?: number | null;
    smartMeasurable?: number | null;
    smartAchievable?: number | null;
    smartRelevant?: number | null;
    smartTimeBound?: number | null;
  }): void {
    if (scores.smartSpecific !== undefined) {
      this._smartSpecific = validateSmartScore(scores.smartSpecific, 'smartSpecific');
    }
    if (scores.smartMeasurable !== undefined) {
      this._smartMeasurable = validateSmartScore(scores.smartMeasurable, 'smartMeasurable');
    }
    if (scores.smartAchievable !== undefined) {
      this._smartAchievable = validateSmartScore(scores.smartAchievable, 'smartAchievable');
    }
    if (scores.smartRelevant !== undefined) {
      this._smartRelevant = validateSmartScore(scores.smartRelevant, 'smartRelevant');
    }
    if (scores.smartTimeBound !== undefined) {
      this._smartTimeBound = validateSmartScore(scores.smartTimeBound, 'smartTimeBound');
    }
    this.touch();
  }

  updateSmartComment(comment: string | null): void {
    this._smartComment = comment ?? null;
    this.touch();
  }

  updateStatus(status: KpiStatusValue): void {
    this._status = status;
    this.touch();
  }

  updateOrder(order: number): void {
    this._order = order;
    this.touch();
  }

  get projectId(): string { return this._projectId; }
  get category(): KpiCategoryValue { return this._category; }
  get flowId(): string | null { return this._flowId; }
  get asisFlowId(): string | null { return this._asisFlowId; }
  get tobeFlowId(): string | null { return this._tobeFlowId; }
  get systemId(): string | null { return this._systemId; }
  get name(): string { return this._name; }
  get description(): string | null { return this._description; }
  get definition(): string | null { return this._definition; }
  get unit(): string | null { return this._unit; }
  get baselineValue(): number | null { return this._baselineValue; }
  get targetValue(): number | null { return this._targetValue; }
  get currentValue(): number | null { return this._currentValue; }
  get direction(): KpiDirectionValue { return this._direction; }
  get frequency(): KpiFrequencyValue { return this._frequency; }
  get measurementMethod(): string | null { return this._measurementMethod; }
  get ownerRoleId(): string | null { return this._ownerRoleId; }
  get smartSpecific(): number | null { return this._smartSpecific; }
  get smartMeasurable(): number | null { return this._smartMeasurable; }
  get smartAchievable(): number | null { return this._smartAchievable; }
  get smartRelevant(): number | null { return this._smartRelevant; }
  get smartTimeBound(): number | null { return this._smartTimeBound; }
  get smartComment(): string | null { return this._smartComment; }
  get aiGenerated(): boolean { return this._aiGenerated; }
  get status(): KpiStatusValue { return this._status; }
  get order(): number { return this._order; }
}
