import { BaseEntity } from './base.entity';
import { ValidationError } from '../errors';

export type ImagingModeValue = 'auto' | 'always' | 'never';

export interface CreateProjectKnowledgeSettingsProps {
  projectId: string;
  aiExtractionEnabled?: boolean;
  ocrEnabled?: boolean;
  defaultModel?: string | null;
  imagingMode?: ImagingModeValue;
  maxFilesPerBatch?: number;
}

export interface ReconstructProjectKnowledgeSettingsProps {
  id: string;
  projectId: string;
  aiExtractionEnabled: boolean;
  ocrEnabled: boolean;
  defaultModel: string | null;
  imagingMode: ImagingModeValue;
  maxFilesPerBatch: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateProjectKnowledgeSettingsProps {
  aiExtractionEnabled?: boolean;
  ocrEnabled?: boolean;
  defaultModel?: string | null;
  imagingMode?: ImagingModeValue;
  maxFilesPerBatch?: number;
}

/**
 * プロジェクト単位の課金ガード設定。
 * projectId は @unique。未作成プロジェクトは既定値（全 ON）として get-or-create する。
 */
export class ProjectKnowledgeSettings extends BaseEntity {
  private readonly _projectId: string;
  private _aiExtractionEnabled: boolean;
  private _ocrEnabled: boolean;
  private _defaultModel: string | null;
  private _imagingMode: ImagingModeValue;
  private _maxFilesPerBatch: number;

  private constructor(props: ReconstructProjectKnowledgeSettingsProps) {
    super(props.id, props.createdAt, props.updatedAt);
    this._projectId = props.projectId;
    this._aiExtractionEnabled = props.aiExtractionEnabled;
    this._ocrEnabled = props.ocrEnabled;
    this._defaultModel = props.defaultModel;
    this._imagingMode = props.imagingMode;
    this._maxFilesPerBatch = props.maxFilesPerBatch;
  }

  static create(
    props: CreateProjectKnowledgeSettingsProps,
    id: string,
  ): ProjectKnowledgeSettings {
    if (!props.projectId) throw new ValidationError('Project ID is required');
    const now = new Date();
    return new ProjectKnowledgeSettings({
      id,
      projectId: props.projectId,
      aiExtractionEnabled: props.aiExtractionEnabled ?? true,
      ocrEnabled: props.ocrEnabled ?? true,
      defaultModel: props.defaultModel ?? null,
      imagingMode: props.imagingMode ?? 'auto',
      maxFilesPerBatch: props.maxFilesPerBatch ?? 200,
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstruct(
    props: ReconstructProjectKnowledgeSettingsProps,
  ): ProjectKnowledgeSettings {
    return new ProjectKnowledgeSettings(props);
  }

  // ========== ビジネスロジック ==========

  update(props: UpdateProjectKnowledgeSettingsProps): void {
    if (props.aiExtractionEnabled !== undefined)
      this._aiExtractionEnabled = props.aiExtractionEnabled;
    if (props.ocrEnabled !== undefined) this._ocrEnabled = props.ocrEnabled;
    if (props.defaultModel !== undefined)
      this._defaultModel = props.defaultModel?.trim() || null;
    if (props.imagingMode !== undefined) this._imagingMode = props.imagingMode;
    if (props.maxFilesPerBatch !== undefined) {
      if (props.maxFilesPerBatch < 1) {
        throw new ValidationError('maxFilesPerBatch must be >= 1');
      }
      this._maxFilesPerBatch = props.maxFilesPerBatch;
    }
    this.touch();
  }

  // ========== Getter ==========

  get projectId(): string {
    return this._projectId;
  }
  get aiExtractionEnabled(): boolean {
    return this._aiExtractionEnabled;
  }
  get ocrEnabled(): boolean {
    return this._ocrEnabled;
  }
  get defaultModel(): string | null {
    return this._defaultModel;
  }
  get imagingMode(): ImagingModeValue {
    return this._imagingMode;
  }
  get maxFilesPerBatch(): number {
    return this._maxFilesPerBatch;
  }
}
