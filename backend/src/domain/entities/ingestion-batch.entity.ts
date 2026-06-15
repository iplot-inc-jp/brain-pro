import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type IngestionBatchStatusValue =
  | 'PENDING'
  | 'EXPANDING'
  | 'RUNNING'
  | 'PARTIAL'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface CreateIngestionBatchProps {
  projectId: string;
  name: string;
  status?: IngestionBatchStatusValue;
  totalFiles?: number;
  succeededFiles?: number;
  failedFiles?: number;
  pendingFiles?: number;
  options?: Record<string, unknown> | null;
  createdById?: string | null;
}

export interface ReconstructIngestionBatchProps {
  id: string;
  projectId: string;
  name: string;
  status: IngestionBatchStatusValue;
  totalFiles: number;
  succeededFiles: number;
  failedFiles: number;
  pendingFiles: number;
  options: Record<string, unknown> | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface UpdateIngestionBatchProps {
  status?: IngestionBatchStatusValue;
  totalFiles?: number;
  succeededFiles?: number;
  failedFiles?: number;
  pendingFiles?: number;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

/**
 * 取り込みバッチ（親）エンティティ。
 * 1バッチ = 複数 IngestionFile の2階層ステータス管理。
 */
export class IngestionBatch extends BaseEntity {
  private readonly _projectId: string;
  private _name: string;
  private _status: IngestionBatchStatusValue;
  private _totalFiles: number;
  private _succeededFiles: number;
  private _failedFiles: number;
  private _pendingFiles: number;
  private _options: Record<string, unknown> | null;
  private readonly _createdById: string | null;
  private _startedAt: Date | null;
  private _finishedAt: Date | null;

  private constructor(
    id: string,
    projectId: string,
    name: string,
    status: IngestionBatchStatusValue,
    totalFiles: number,
    succeededFiles: number,
    failedFiles: number,
    pendingFiles: number,
    options: Record<string, unknown> | null,
    createdById: string | null,
    createdAt: Date,
    updatedAt: Date,
    startedAt: Date | null,
    finishedAt: Date | null,
  ) {
    super(id, createdAt, updatedAt);
    this._projectId = projectId;
    this._name = name;
    this._status = status;
    this._totalFiles = totalFiles;
    this._succeededFiles = succeededFiles;
    this._failedFiles = failedFiles;
    this._pendingFiles = pendingFiles;
    this._options = options;
    this._createdById = createdById;
    this._startedAt = startedAt;
    this._finishedAt = finishedAt;
  }

  static create(props: CreateIngestionBatchProps, id: string): IngestionBatch {
    if (!props.projectId) {
      throw new ValidationError('Project ID is required');
    }
    if (!props.name || !props.name.trim()) {
      throw new ValidationError('Batch name is required');
    }
    const now = new Date();
    return new IngestionBatch(
      id,
      props.projectId,
      props.name.trim(),
      props.status ?? 'PENDING',
      props.totalFiles ?? 0,
      props.succeededFiles ?? 0,
      props.failedFiles ?? 0,
      props.pendingFiles ?? 0,
      props.options ?? null,
      props.createdById ?? null,
      now,
      now,
      null,
      null,
    );
  }

  static reconstruct(props: ReconstructIngestionBatchProps): IngestionBatch {
    return new IngestionBatch(
      props.id,
      props.projectId,
      props.name,
      props.status,
      props.totalFiles,
      props.succeededFiles,
      props.failedFiles,
      props.pendingFiles,
      props.options,
      props.createdById,
      props.createdAt,
      props.updatedAt,
      props.startedAt,
      props.finishedAt,
    );
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateIngestionBatchProps): void {
    if (props.status !== undefined) this._status = props.status;
    if (props.totalFiles !== undefined) this._totalFiles = props.totalFiles;
    if (props.succeededFiles !== undefined)
      this._succeededFiles = props.succeededFiles;
    if (props.failedFiles !== undefined) this._failedFiles = props.failedFiles;
    if (props.pendingFiles !== undefined)
      this._pendingFiles = props.pendingFiles;
    if (props.startedAt !== undefined) this._startedAt = props.startedAt;
    if (props.finishedAt !== undefined) this._finishedAt = props.finishedAt;
    this.touch();
  }

  /** 実行開始マーク（startedAt 未設定なら設定し RUNNING へ）。 */
  markStarted(): void {
    if (!this._startedAt) this._startedAt = new Date();
    if (this._status === 'PENDING') this._status = 'RUNNING';
    this.touch();
  }

  /** キャンセル。 */
  cancel(): void {
    this._status = 'CANCELLED';
    this._finishedAt = new Date();
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }

  get name(): string {
    return this._name;
  }

  get status(): IngestionBatchStatusValue {
    return this._status;
  }

  get totalFiles(): number {
    return this._totalFiles;
  }

  get succeededFiles(): number {
    return this._succeededFiles;
  }

  get failedFiles(): number {
    return this._failedFiles;
  }

  get pendingFiles(): number {
    return this._pendingFiles;
  }

  get options(): Record<string, unknown> | null {
    return this._options;
  }

  get createdById(): string | null {
    return this._createdById;
  }

  get startedAt(): Date | null {
    return this._startedAt;
  }

  get finishedAt(): Date | null {
    return this._finishedAt;
  }
}
