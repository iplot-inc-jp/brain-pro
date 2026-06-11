import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateRiskProps {
  projectId: string;
  code?: string | null;
  type?: string | null;
  event?: string | null;
  causeCategory?: string | null;
  probability?: string | null;
  impact?: string | null;
  priority?: string | null;
  countermeasure?: string | null;
  needsMtg?: string | null;
  mtgDate?: string | null;
  deadline?: string | null;
  owner?: string | null;
  status?: string | null;
  note?: string | null;
  order?: number;
  // --- PMBOK準拠の追加項目（全て optional・後方互換） ---
  categoryId?: string | null;
  subProjectId?: string | null;
  ownerStakeholderId?: string | null;
  reviewMeetingId?: string | null;
  probabilityScore?: number | null;
  impactScore?: number | null;
  riskType?: string | null;
  strategy?: string | null;
  responsePlan?: string | null;
  contingencyPlan?: string | null;
  trigger?: string | null;
  lifecycle?: string | null;
}

export interface ReconstructRiskProps {
  id: string;
  projectId: string;
  code: string | null;
  type: string | null;
  event: string | null;
  causeCategory: string | null;
  probability: string | null;
  impact: string | null;
  priority: string | null;
  countermeasure: string | null;
  needsMtg: string | null;
  mtgDate: string | null;
  deadline: string | null;
  owner: string | null;
  status: string | null;
  note: string | null;
  order: number;
  categoryId: string | null;
  subProjectId: string | null;
  ownerStakeholderId: string | null;
  reviewMeetingId: string | null;
  probabilityScore: number | null;
  impactScore: number | null;
  riskType: string | null;
  strategy: string | null;
  responsePlan: string | null;
  contingencyPlan: string | null;
  trigger: string | null;
  lifecycle: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateRiskProps {
  code?: string | null;
  type?: string | null;
  event?: string | null;
  causeCategory?: string | null;
  probability?: string | null;
  impact?: string | null;
  priority?: string | null;
  countermeasure?: string | null;
  needsMtg?: string | null;
  mtgDate?: string | null;
  deadline?: string | null;
  owner?: string | null;
  status?: string | null;
  note?: string | null;
  order?: number;
  categoryId?: string | null;
  subProjectId?: string | null;
  ownerStakeholderId?: string | null;
  reviewMeetingId?: string | null;
  probabilityScore?: number | null;
  impactScore?: number | null;
  riskType?: string | null;
  strategy?: string | null;
  responsePlan?: string | null;
  contingencyPlan?: string | null;
  trigger?: string | null;
  lifecycle?: string | null;
}

/** エンティティ内部状態（コンストラクタ引数の肥大化を避けるため props 形式） */
interface RiskState {
  projectId: string;
  code: string | null;
  type: string | null;
  event: string | null;
  causeCategory: string | null;
  probability: string | null;
  impact: string | null;
  priority: string | null;
  countermeasure: string | null;
  needsMtg: string | null;
  mtgDate: string | null;
  deadline: string | null;
  owner: string | null;
  status: string | null;
  note: string | null;
  order: number;
  categoryId: string | null;
  subProjectId: string | null;
  ownerStakeholderId: string | null;
  reviewMeetingId: string | null;
  probabilityScore: number | null;
  impactScore: number | null;
  riskType: string | null;
  strategy: string | null;
  responsePlan: string | null;
  contingencyPlan: string | null;
  trigger: string | null;
  lifecycle: string | null;
}

/**
 * リスク・ボトルネックエンティティ（PMBOK準拠）
 * プロジェクトのリスク・ボトルネックを発生確率・影響度・優先度で管理する。
 * PMBOK 追加項目（RBSカテゴリ・リスクオーナー・1-5スコア・対応戦略・ライフサイクル等）は
 * 全て optional で、未指定なら従来どおりの挙動となる（後方互換）。
 */
export class Risk extends BaseEntity {
  private readonly _state: RiskState;

  private constructor(
    id: string,
    state: RiskState,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._state = state;
  }

  /** 1-5 の整数スコアを検証（null/undefined は許容） */
  private static normalizeScore(
    value: number | null | undefined,
    field: string,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new ValidationError(
        `${field} must be an integer between 1 and 5`,
      );
    }
    return value;
  }

  /**
   * 新規リスク作成
   */
  static create(props: CreateRiskProps, id: string): Risk {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const now = new Date();
    return new Risk(
      id,
      {
        projectId: props.projectId,
        code: props.code?.trim() || null,
        type: props.type?.trim() || null,
        event: props.event?.trim() || null,
        causeCategory: props.causeCategory?.trim() || null,
        probability: props.probability?.trim() || null,
        impact: props.impact?.trim() || null,
        priority: props.priority?.trim() || null,
        countermeasure: props.countermeasure?.trim() || null,
        needsMtg: props.needsMtg?.trim() || null,
        mtgDate: props.mtgDate?.trim() || null,
        deadline: props.deadline?.trim() || null,
        owner: props.owner?.trim() || null,
        status: props.status?.trim() || null,
        note: props.note?.trim() || null,
        order: props.order ?? 0,
        categoryId: props.categoryId ?? null,
        subProjectId: props.subProjectId ?? null,
        ownerStakeholderId: props.ownerStakeholderId ?? null,
        reviewMeetingId: props.reviewMeetingId ?? null,
        probabilityScore: Risk.normalizeScore(
          props.probabilityScore,
          'Probability score',
        ),
        impactScore: Risk.normalizeScore(props.impactScore, 'Impact score'),
        riskType: props.riskType?.trim() || null,
        strategy: props.strategy?.trim() || null,
        responsePlan: props.responsePlan?.trim() || null,
        contingencyPlan: props.contingencyPlan?.trim() || null,
        trigger: props.trigger?.trim() || null,
        lifecycle: props.lifecycle?.trim() || null,
      },
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructRiskProps): Risk {
    return new Risk(
      props.id,
      {
        projectId: props.projectId,
        code: props.code,
        type: props.type,
        event: props.event,
        causeCategory: props.causeCategory,
        probability: props.probability,
        impact: props.impact,
        priority: props.priority,
        countermeasure: props.countermeasure,
        needsMtg: props.needsMtg,
        mtgDate: props.mtgDate,
        deadline: props.deadline,
        owner: props.owner,
        status: props.status,
        note: props.note,
        order: props.order,
        categoryId: props.categoryId,
        subProjectId: props.subProjectId,
        ownerStakeholderId: props.ownerStakeholderId,
        reviewMeetingId: props.reviewMeetingId,
        probabilityScore: props.probabilityScore,
        impactScore: props.impactScore,
        riskType: props.riskType,
        strategy: props.strategy,
        responsePlan: props.responsePlan,
        contingencyPlan: props.contingencyPlan,
        trigger: props.trigger,
        lifecycle: props.lifecycle,
      },
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateRiskProps): void {
    if (props.code !== undefined) {
      this._state.code = props.code?.trim() || null;
    }
    if (props.type !== undefined) {
      this._state.type = props.type?.trim() || null;
    }
    if (props.event !== undefined) {
      this._state.event = props.event?.trim() || null;
    }
    if (props.causeCategory !== undefined) {
      this._state.causeCategory = props.causeCategory?.trim() || null;
    }
    if (props.probability !== undefined) {
      this._state.probability = props.probability?.trim() || null;
    }
    if (props.impact !== undefined) {
      this._state.impact = props.impact?.trim() || null;
    }
    if (props.priority !== undefined) {
      this._state.priority = props.priority?.trim() || null;
    }
    if (props.countermeasure !== undefined) {
      this._state.countermeasure = props.countermeasure?.trim() || null;
    }
    if (props.needsMtg !== undefined) {
      this._state.needsMtg = props.needsMtg?.trim() || null;
    }
    if (props.mtgDate !== undefined) {
      this._state.mtgDate = props.mtgDate?.trim() || null;
    }
    if (props.deadline !== undefined) {
      this._state.deadline = props.deadline?.trim() || null;
    }
    if (props.owner !== undefined) {
      this._state.owner = props.owner?.trim() || null;
    }
    if (props.status !== undefined) {
      this._state.status = props.status?.trim() || null;
    }
    if (props.note !== undefined) {
      this._state.note = props.note?.trim() || null;
    }
    if (props.order !== undefined) {
      this._state.order = props.order;
    }
    if (props.categoryId !== undefined) {
      this._state.categoryId = props.categoryId ?? null;
    }
    if (props.subProjectId !== undefined) {
      this._state.subProjectId = props.subProjectId ?? null;
    }
    if (props.ownerStakeholderId !== undefined) {
      this._state.ownerStakeholderId = props.ownerStakeholderId ?? null;
    }
    if (props.reviewMeetingId !== undefined) {
      this._state.reviewMeetingId = props.reviewMeetingId ?? null;
    }
    if (props.probabilityScore !== undefined) {
      this._state.probabilityScore = Risk.normalizeScore(
        props.probabilityScore,
        'Probability score',
      );
    }
    if (props.impactScore !== undefined) {
      this._state.impactScore = Risk.normalizeScore(
        props.impactScore,
        'Impact score',
      );
    }
    if (props.riskType !== undefined) {
      this._state.riskType = props.riskType?.trim() || null;
    }
    if (props.strategy !== undefined) {
      this._state.strategy = props.strategy?.trim() || null;
    }
    if (props.responsePlan !== undefined) {
      this._state.responsePlan = props.responsePlan?.trim() || null;
    }
    if (props.contingencyPlan !== undefined) {
      this._state.contingencyPlan = props.contingencyPlan?.trim() || null;
    }
    if (props.trigger !== undefined) {
      this._state.trigger = props.trigger?.trim() || null;
    }
    if (props.lifecycle !== undefined) {
      this._state.lifecycle = props.lifecycle?.trim() || null;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._state.projectId;
  }

  get code(): string | null {
    return this._state.code;
  }

  get type(): string | null {
    return this._state.type;
  }

  get event(): string | null {
    return this._state.event;
  }

  get causeCategory(): string | null {
    return this._state.causeCategory;
  }

  get probability(): string | null {
    return this._state.probability;
  }

  get impact(): string | null {
    return this._state.impact;
  }

  get priority(): string | null {
    return this._state.priority;
  }

  get countermeasure(): string | null {
    return this._state.countermeasure;
  }

  get needsMtg(): string | null {
    return this._state.needsMtg;
  }

  get mtgDate(): string | null {
    return this._state.mtgDate;
  }

  get deadline(): string | null {
    return this._state.deadline;
  }

  get owner(): string | null {
    return this._state.owner;
  }

  get status(): string | null {
    return this._state.status;
  }

  get note(): string | null {
    return this._state.note;
  }

  get order(): number {
    return this._state.order;
  }

  get categoryId(): string | null {
    return this._state.categoryId;
  }

  get subProjectId(): string | null {
    return this._state.subProjectId;
  }

  get ownerStakeholderId(): string | null {
    return this._state.ownerStakeholderId;
  }

  get reviewMeetingId(): string | null {
    return this._state.reviewMeetingId;
  }

  get probabilityScore(): number | null {
    return this._state.probabilityScore;
  }

  get impactScore(): number | null {
    return this._state.impactScore;
  }

  get riskType(): string | null {
    return this._state.riskType;
  }

  get strategy(): string | null {
    return this._state.strategy;
  }

  get responsePlan(): string | null {
    return this._state.responsePlan;
  }

  get contingencyPlan(): string | null {
    return this._state.contingencyPlan;
  }

  get trigger(): string | null {
    return this._state.trigger;
  }

  get lifecycle(): string | null {
    return this._state.lifecycle;
  }
}
