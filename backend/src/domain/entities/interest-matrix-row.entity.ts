import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateInterestMatrixRowProps {
  projectId: string;
  phase?: string | null;
  duration?: string | null;
  mainMeetings?: string | null;
  fieldStaff?: string | null;
  clientPm?: string | null;
  executive?: string | null;
  order?: number;
}

export interface ReconstructInterestMatrixRowProps {
  id: string;
  projectId: string;
  phase: string | null;
  duration: string | null;
  mainMeetings: string | null;
  fieldStaff: string | null;
  clientPm: string | null;
  executive: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateInterestMatrixRowProps {
  phase?: string | null;
  duration?: string | null;
  mainMeetings?: string | null;
  fieldStaff?: string | null;
  clientPm?: string | null;
  executive?: string | null;
  order?: number;
}

/**
 * 関心ごとマトリクス行エンティティ
 * フェーズ×ロールで各関係者の関心ごとを整理する（1フェーズ1行）
 */
export class InterestMatrixRow extends BaseEntity {
  private readonly _projectId: string;
  private _phase: string | null;
  private _duration: string | null;
  private _mainMeetings: string | null;
  private _fieldStaff: string | null;
  private _clientPm: string | null;
  private _executive: string | null;
  private _order: number;

  private constructor(
    id: string,
    projectId: string,
    phase: string | null,
    duration: string | null,
    mainMeetings: string | null,
    fieldStaff: string | null,
    clientPm: string | null,
    executive: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._phase = phase;
    this._duration = duration;
    this._mainMeetings = mainMeetings;
    this._fieldStaff = fieldStaff;
    this._clientPm = clientPm;
    this._executive = executive;
    this._order = order;
  }

  /**
   * 新規作成
   */
  static create(
    props: CreateInterestMatrixRowProps,
    id: string,
  ): InterestMatrixRow {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const now = new Date();
    return new InterestMatrixRow(
      id,
      props.projectId,
      props.phase?.trim() || null,
      props.duration?.trim() || null,
      props.mainMeetings?.trim() || null,
      props.fieldStaff?.trim() || null,
      props.clientPm?.trim() || null,
      props.executive?.trim() || null,
      props.order ?? 0,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(
    props: ReconstructInterestMatrixRowProps,
  ): InterestMatrixRow {
    return new InterestMatrixRow(
      props.id,
      props.projectId,
      props.phase,
      props.duration,
      props.mainMeetings,
      props.fieldStaff,
      props.clientPm,
      props.executive,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateInterestMatrixRowProps): void {
    if (props.phase !== undefined) {
      this._phase = props.phase?.trim() || null;
    }
    if (props.duration !== undefined) {
      this._duration = props.duration?.trim() || null;
    }
    if (props.mainMeetings !== undefined) {
      this._mainMeetings = props.mainMeetings?.trim() || null;
    }
    if (props.fieldStaff !== undefined) {
      this._fieldStaff = props.fieldStaff?.trim() || null;
    }
    if (props.clientPm !== undefined) {
      this._clientPm = props.clientPm?.trim() || null;
    }
    if (props.executive !== undefined) {
      this._executive = props.executive?.trim() || null;
    }
    if (props.order !== undefined) {
      this._order = props.order;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get phase(): string | null {
    return this._phase;
  }

  get duration(): string | null {
    return this._duration;
  }

  get mainMeetings(): string | null {
    return this._mainMeetings;
  }

  get fieldStaff(): string | null {
    return this._fieldStaff;
  }

  get clientPm(): string | null {
    return this._clientPm;
  }

  get executive(): string | null {
    return this._executive;
  }

  get order(): number {
    return this._order;
  }
}
