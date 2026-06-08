import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export interface CreateReportCalendarProps {
  projectId: string;
  stakeholderId?: string | null;
  reportTo?: string | null;
  meetingId?: string | null;
  reportContent?: string | null;
  frequency?: string | null;
  dayTime?: string | null;
  format?: string | null;
  medium?: string | null;
  drafter?: string | null;
  approver?: string | null;
  templateRef?: string | null;
  note?: string | null;
  order?: number;
}

export interface ReconstructReportCalendarProps {
  id: string;
  projectId: string;
  stakeholderId: string | null;
  reportTo: string | null;
  meetingId: string | null;
  reportContent: string | null;
  frequency: string | null;
  dayTime: string | null;
  format: string | null;
  medium: string | null;
  drafter: string | null;
  approver: string | null;
  templateRef: string | null;
  note: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateReportCalendarProps {
  stakeholderId?: string | null;
  reportTo?: string | null;
  meetingId?: string | null;
  reportContent?: string | null;
  frequency?: string | null;
  dayTime?: string | null;
  format?: string | null;
  medium?: string | null;
  drafter?: string | null;
  approver?: string | null;
  templateRef?: string | null;
  note?: string | null;
  order?: number;
}

/**
 * 報告・連絡カレンダーエンティティ
 * 誰に何をいつ報告するかを定例化する
 */
export class ReportCalendar extends BaseEntity {
  private readonly _projectId: string;
  private _stakeholderId: string | null;
  private _reportTo: string | null;
  private _meetingId: string | null;
  private _reportContent: string | null;
  private _frequency: string | null;
  private _dayTime: string | null;
  private _format: string | null;
  private _medium: string | null;
  private _drafter: string | null;
  private _approver: string | null;
  private _templateRef: string | null;
  private _note: string | null;
  private _order: number;

  private constructor(
    id: string,
    projectId: string,
    stakeholderId: string | null,
    reportTo: string | null,
    meetingId: string | null,
    reportContent: string | null,
    frequency: string | null,
    dayTime: string | null,
    format: string | null,
    medium: string | null,
    drafter: string | null,
    approver: string | null,
    templateRef: string | null,
    note: string | null,
    order: number,
    createdAt: Date,
    updatedAt: Date,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._stakeholderId = stakeholderId;
    this._reportTo = reportTo;
    this._meetingId = meetingId;
    this._reportContent = reportContent;
    this._frequency = frequency;
    this._dayTime = dayTime;
    this._format = format;
    this._medium = medium;
    this._drafter = drafter;
    this._approver = approver;
    this._templateRef = templateRef;
    this._note = note;
    this._order = order;
  }

  /**
   * 新規作成
   */
  static create(props: CreateReportCalendarProps, id: string): ReportCalendar {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }

    const now = new Date();
    return new ReportCalendar(
      id,
      props.projectId,
      props.stakeholderId?.trim() || null,
      props.reportTo?.trim() || null,
      props.meetingId?.trim() || null,
      props.reportContent?.trim() || null,
      props.frequency?.trim() || null,
      props.dayTime?.trim() || null,
      props.format?.trim() || null,
      props.medium?.trim() || null,
      props.drafter?.trim() || null,
      props.approver?.trim() || null,
      props.templateRef?.trim() || null,
      props.note?.trim() || null,
      props.order ?? 0,
      now,
      now,
    );
  }

  /**
   * DBからの再構築
   */
  static reconstruct(props: ReconstructReportCalendarProps): ReportCalendar {
    return new ReportCalendar(
      props.id,
      props.projectId,
      props.stakeholderId,
      props.reportTo,
      props.meetingId,
      props.reportContent,
      props.frequency,
      props.dayTime,
      props.format,
      props.medium,
      props.drafter,
      props.approver,
      props.templateRef,
      props.note,
      props.order,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateReportCalendarProps): void {
    if (props.stakeholderId !== undefined) {
      this._stakeholderId = props.stakeholderId?.trim() || null;
    }
    if (props.reportTo !== undefined) {
      this._reportTo = props.reportTo?.trim() || null;
    }
    if (props.meetingId !== undefined) {
      this._meetingId = props.meetingId?.trim() || null;
    }
    if (props.reportContent !== undefined) {
      this._reportContent = props.reportContent?.trim() || null;
    }
    if (props.frequency !== undefined) {
      this._frequency = props.frequency?.trim() || null;
    }
    if (props.dayTime !== undefined) {
      this._dayTime = props.dayTime?.trim() || null;
    }
    if (props.format !== undefined) {
      this._format = props.format?.trim() || null;
    }
    if (props.medium !== undefined) {
      this._medium = props.medium?.trim() || null;
    }
    if (props.drafter !== undefined) {
      this._drafter = props.drafter?.trim() || null;
    }
    if (props.approver !== undefined) {
      this._approver = props.approver?.trim() || null;
    }
    if (props.templateRef !== undefined) {
      this._templateRef = props.templateRef?.trim() || null;
    }
    if (props.note !== undefined) {
      this._note = props.note?.trim() || null;
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

  get stakeholderId(): string | null {
    return this._stakeholderId;
  }

  get reportTo(): string | null {
    return this._reportTo;
  }

  get meetingId(): string | null {
    return this._meetingId;
  }

  get reportContent(): string | null {
    return this._reportContent;
  }

  get frequency(): string | null {
    return this._frequency;
  }

  get dayTime(): string | null {
    return this._dayTime;
  }

  get format(): string | null {
    return this._format;
  }

  get medium(): string | null {
    return this._medium;
  }

  get drafter(): string | null {
    return this._drafter;
  }

  get approver(): string | null {
    return this._approver;
  }

  get templateRef(): string | null {
    return this._templateRef;
  }

  get note(): string | null {
    return this._note;
  }

  get order(): number {
    return this._order;
  }
}
