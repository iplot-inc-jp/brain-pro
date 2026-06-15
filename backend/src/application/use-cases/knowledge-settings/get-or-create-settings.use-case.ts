import { Inject, Injectable } from '@nestjs/common';
import {
  ProjectKnowledgeSettings,
  IProjectKnowledgeSettingsRepository,
  PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  ProjectKnowledgeSettingsOutput,
  toProjectKnowledgeSettingsOutput,
} from './knowledge-settings-output';

export interface GetOrCreateSettingsInput {
  userId: string;
  projectId: string;
}

/**
 * プロジェクトのナレッジ設定を get-or-create するユースケース。
 * 未作成プロジェクトは既定値（全 ON）で作成して返す（projectId は @unique）。
 */
@Injectable()
export class GetOrCreateSettingsUseCase {
  constructor(
    @Inject(PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY)
    private readonly settingsRepository: IProjectKnowledgeSettingsRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: GetOrCreateSettingsInput,
  ): Promise<ProjectKnowledgeSettingsOutput> {
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'view',
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
      await this.settingsRepository.save(settings);
    }

    return toProjectKnowledgeSettingsOutput(settings);
  }
}
