import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type IngestionSourceTypeValue = 'UPLOAD' | 'ATTACHMENT' | 'DRIVE';

export type IngestionFileStatusValue =
  | 'PENDING'
  | 'FETCHING'
  | 'EXPANDING'
  | 'PREPROCESSING'
  | 'EXTRACTING'
  | 'MERGING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'SKIPPED';

export interface CreateIngestionFileProps {
  batchId: string;
  projectId: string;
  sourceType: IngestionSourceTypeValue;
  sourceRef?: string | null;
  filename: string;
  displayName?: string | null;
  mimeType?: string | null;
  size?: number | null;
  blobUrl?: string | null;
  isArchive?: boolean;
  parentFileId?: string | null;
  status?: IngestionFileStatusValue;
  maxAttempts?: number;
}

export interface ReconstructIngestionFileProps {
  id: string;
  batchId: string;
  projectId: string;
  sourceType: IngestionSourceTypeValue;
  sourceRef: string | null;
  filename: string;
  displayName: string | null;
  mimeType: string | null;
  size: number | null;
  blobUrl: string | null;
  isArchive: boolean;
  parentFileId: string | null;
  status: IngestionFileStatusValue;
  step: string | null;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  extractedText: string | null;
  pageImageUrls: unknown | null;
  extractionResult: unknown | null;
  jobId: string | null;
  knowledgeDocumentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface UpdateIngestionFileProps {
  status?: IngestionFileStatusValue;
  step?: string | null;
  progress?: number;
  blobUrl?: string | null;
  error?: string | null;
  extractedText?: string | null;
  pageImageUrls?: unknown | null;
  extractionResult?: unknown | null;
  jobId?: string | null;
  knowledgeDocumentId?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

/**
 * 取り込みファイル（子）エンティティ。
 * 業務的な細かいステータス（status/step/progress/attempts/error）を保持する。
 */
export class IngestionFile extends BaseEntity {
  private readonly _batchId: string;
  private readonly _projectId: string;
  private readonly _sourceType: IngestionSourceTypeValue;
  private _sourceRef: string | null;
  private _filename: string;
  private _displayName: string | null;
  private _mimeType: string | null;
  private _size: number | null;
  private _blobUrl: string | null;
  private readonly _isArchive: boolean;
  private readonly _parentFileId: string | null;
  private _status: IngestionFileStatusValue;
  private _step: string | null;
  private _progress: number;
  private _attempts: number;
  private _maxAttempts: number;
  private _error: string | null;
  private _extractedText: string | null;
  private _pageImageUrls: unknown | null;
  private _extractionResult: unknown | null;
  private _jobId: string | null;
  private _knowledgeDocumentId: string | null;
  private _startedAt: Date | null;
  private _finishedAt: Date | null;

  private constructor(props: ReconstructIngestionFileProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._batchId = props.batchId;
    this._projectId = props.projectId;
    this._sourceType = props.sourceType;
    this._sourceRef = props.sourceRef;
    this._filename = props.filename;
    this._displayName = props.displayName;
    this._mimeType = props.mimeType;
    this._size = props.size;
    this._blobUrl = props.blobUrl;
    this._isArchive = props.isArchive;
    this._parentFileId = props.parentFileId;
    this._status = props.status;
    this._step = props.step;
    this._progress = props.progress;
    this._attempts = props.attempts;
    this._maxAttempts = props.maxAttempts;
    this._error = props.error;
    this._extractedText = props.extractedText;
    this._pageImageUrls = props.pageImageUrls;
    this._extractionResult = props.extractionResult;
    this._jobId = props.jobId;
    this._knowledgeDocumentId = props.knowledgeDocumentId;
    this._startedAt = props.startedAt;
    this._finishedAt = props.finishedAt;
  }

  static create(props: CreateIngestionFileProps, id: string): IngestionFile {
    if (!props.batchId) throw new ValidationError('Batch ID is required');
    if (!props.projectId) throw new ValidationError('Project ID is required');
    if (!props.filename || !props.filename.trim()) {
      throw new ValidationError('Filename is required');
    }
    const now = new Date();
    return new IngestionFile({
      id,
      batchId: props.batchId,
      projectId: props.projectId,
      sourceType: props.sourceType,
      sourceRef: props.sourceRef ?? null,
      filename: props.filename.trim(),
      displayName: props.displayName ?? null,
      mimeType: props.mimeType ?? null,
      size: props.size ?? null,
      blobUrl: props.blobUrl ?? null,
      isArchive: props.isArchive ?? false,
      parentFileId: props.parentFileId ?? null,
      status: props.status ?? 'PENDING',
      step: null,
      progress: 0,
      attempts: 0,
      maxAttempts: props.maxAttempts ?? 4,
      error: null,
      extractedText: null,
      pageImageUrls: null,
      extractionResult: null,
      jobId: null,
      knowledgeDocumentId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    });
  }

  static reconstruct(props: ReconstructIngestionFileProps): IngestionFile {
    return new IngestionFile(props);
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateIngestionFileProps): void {
    if (props.status !== undefined) this._status = props.status;
    if (props.step !== undefined) this._step = props.step;
    if (props.progress !== undefined) this._progress = props.progress;
    if (props.blobUrl !== undefined) this._blobUrl = props.blobUrl;
    if (props.error !== undefined) this._error = props.error;
    if (props.extractedText !== undefined)
      this._extractedText = props.extractedText;
    if (props.pageImageUrls !== undefined)
      this._pageImageUrls = props.pageImageUrls;
    if (props.extractionResult !== undefined)
      this._extractionResult = props.extractionResult;
    if (props.jobId !== undefined) this._jobId = props.jobId;
    if (props.knowledgeDocumentId !== undefined)
      this._knowledgeDocumentId = props.knowledgeDocumentId;
    if (props.startedAt !== undefined) this._startedAt = props.startedAt;
    if (props.finishedAt !== undefined) this._finishedAt = props.finishedAt;
    this.touch();
  }

  /** ジョブ再投入用に PENDING へ戻す（status/step/error をクリア、attempts は保持）。 */
  requeue(jobId?: string | null): void {
    this._status = 'PENDING';
    this._step = null;
    this._error = null;
    this._progress = 0;
    this._finishedAt = null;
    if (jobId !== undefined) this._jobId = jobId;
    this.touch();
  }

  /** 試行回数を1つ増やす。 */
  incrementAttempts(): void {
    this._attempts += 1;
    this.touch();
  }

  /** 手動スキップ（SKIPPED + 理由）。 */
  skip(reason?: string | null): void {
    this._status = 'SKIPPED';
    this._step = reason ?? '手動スキップ';
    this._finishedAt = new Date();
    this.touch();
  }

  setJobId(jobId: string | null): void {
    this._jobId = jobId;
    this.touch();
  }

  // ========== Getter ==========

  get batchId(): string {
    return this._batchId;
  }
  get projectId(): string {
    return this._projectId;
  }
  get sourceType(): IngestionSourceTypeValue {
    return this._sourceType;
  }
  get sourceRef(): string | null {
    return this._sourceRef;
  }
  get filename(): string {
    return this._filename;
  }
  get displayName(): string | null {
    return this._displayName;
  }
  get mimeType(): string | null {
    return this._mimeType;
  }
  get size(): number | null {
    return this._size;
  }
  get blobUrl(): string | null {
    return this._blobUrl;
  }
  get isArchive(): boolean {
    return this._isArchive;
  }
  get parentFileId(): string | null {
    return this._parentFileId;
  }
  get status(): IngestionFileStatusValue {
    return this._status;
  }
  get step(): string | null {
    return this._step;
  }
  get progress(): number {
    return this._progress;
  }
  get attempts(): number {
    return this._attempts;
  }
  get maxAttempts(): number {
    return this._maxAttempts;
  }
  get error(): string | null {
    return this._error;
  }
  get extractedText(): string | null {
    return this._extractedText;
  }
  get pageImageUrls(): unknown | null {
    return this._pageImageUrls;
  }
  get extractionResult(): unknown | null {
    return this._extractionResult;
  }
  get jobId(): string | null {
    return this._jobId;
  }
  get knowledgeDocumentId(): string | null {
    return this._knowledgeDocumentId;
  }
  get startedAt(): Date | null {
    return this._startedAt;
  }
  get finishedAt(): Date | null {
    return this._finishedAt;
  }
}
