import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';
import { IngestionSourceTypeValue } from './ingestion-file.entity';

export interface ReconstructKnowledgeDocumentProps {
  id: string;
  projectId: string;
  ingestionFileId: string | null;
  title: string;
  summary: string | null;
  contentText: string | null;
  sourceType: IngestionSourceTypeValue;
  sourceRef: string | null;
  blobUrl: string | null;
  mimeType: string | null;
  positionX: number | null;
  positionY: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateKnowledgeDocumentPositionProps {
  positionX?: number | null;
  positionY?: number | null;
}

export interface UpdateKnowledgeDocumentProps {
  title?: string;
  summary?: string | null;
}

/**
 * 文書ノード（1ファイル = 1文書ノード。再実行で置換）。
 * 本スライスでは read + 位置更新を担当（生成は取り込みパイプライン側）。
 */
export class KnowledgeDocument extends BaseEntity {
  private readonly _projectId: string;
  private readonly _ingestionFileId: string | null;
  private _title: string;
  private _summary: string | null;
  private _contentText: string | null;
  private readonly _sourceType: IngestionSourceTypeValue;
  private readonly _sourceRef: string | null;
  private readonly _blobUrl: string | null;
  private readonly _mimeType: string | null;
  private _positionX: number | null;
  private _positionY: number | null;

  private constructor(props: ReconstructKnowledgeDocumentProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._projectId = props.projectId;
    this._ingestionFileId = props.ingestionFileId;
    this._title = props.title;
    this._summary = props.summary;
    this._contentText = props.contentText;
    this._sourceType = props.sourceType;
    this._sourceRef = props.sourceRef;
    this._blobUrl = props.blobUrl;
    this._mimeType = props.mimeType;
    this._positionX = props.positionX;
    this._positionY = props.positionY;
  }

  static reconstruct(
    props: ReconstructKnowledgeDocumentProps,
  ): KnowledgeDocument {
    return new KnowledgeDocument(props);
  }

  // ========== ビジネスロジック ==========

  updatePosition(props: UpdateKnowledgeDocumentPositionProps): void {
    if (props.positionX !== undefined) this._positionX = props.positionX;
    if (props.positionY !== undefined) this._positionY = props.positionY;
    this.touch();
  }

  update(props: UpdateKnowledgeDocumentProps): void {
    if (props.title !== undefined) {
      if (!props.title.trim()) {
        throw new ValidationError('Document title is required');
      }
      this._title = props.title.trim();
    }
    if (props.summary !== undefined) {
      this._summary = props.summary?.trim() || null;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }
  get ingestionFileId(): string | null {
    return this._ingestionFileId;
  }
  get title(): string {
    return this._title;
  }
  get summary(): string | null {
    return this._summary;
  }
  get contentText(): string | null {
    return this._contentText;
  }
  get sourceType(): IngestionSourceTypeValue {
    return this._sourceType;
  }
  get sourceRef(): string | null {
    return this._sourceRef;
  }
  get blobUrl(): string | null {
    return this._blobUrl;
  }
  get mimeType(): string | null {
    return this._mimeType;
  }
  get positionX(): number | null {
    return this._positionX;
  }
  get positionY(): number | null {
    return this._positionY;
  }
}
