import { Inject, Injectable } from '@nestjs/common';
import {
  ProjectKnowledgeSettings,
  IProjectKnowledgeSettingsRepository,
  PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY,
  ImagingModeValue,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  ProjectKnowledgeSettingsOutput,
  toProjectKnowledgeSettingsOutput,
} from './knowledge-settings-output';

export interface UpdateSettingsInput {
  userId: string;
  projectId: string;
  aiExtractionEnabled?: boolean;
  ocrEnabled?: boolean;
  defaultModel?: string | null;
  imagingMode?: ImagingModeValue;
  maxFilesPerBatch?: number;
}

/**
 * プロジェクトのナレッジ設定を更新するユースケース（projectId @unique で get-or-create）。
 * 課金ガード（AI抽出 / OCR の ON/OFF 等）の編集なので edit 強制。
 */
@Injectable()
export class UpdateSettingsUseCase {
  constructor(
    @Inject(PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: IProjectKnowledgeSettingsRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: UpdateSettingsInput,
  ): Promise<ProjectKnowledgeSettingsOutput> {
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'edit',
    );

    let settings = await this.settingsRepository.findByProjectId(
      input.projectId,
    );
    if (!settings) {
      const id = this.settingsRepository.generateId();
      settings = ProjectKnowledgeSettings.create(
        { projectId: input.projectId },
        id,
      );
    }

    settings.update({
      aiExtractionEnabled: input.aiExtractionEnabled,
      ocrEnabled: input.ocrEnabled,
      defaultModel: input.defaultModel,
      imagingMode: input.imagingMode,
      maxFilesPerBatch: input.maxFilesPerBatch,
    });
    await this.settingsRepository.save(settings);

    return toProjectKnowledgeSettingsOutput(settings);
  }
}
