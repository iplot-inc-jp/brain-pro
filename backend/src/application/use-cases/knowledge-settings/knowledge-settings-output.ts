import { ProjectKnowledgeSettings } from '../../../domain';

export interface ProjectKnowledgeSettingsOutput {
  id: string;
  projectId: string;
  aiExtractionEnabled: boolean;
  ocrEnabled: boolean;
  defaultModel: string | null;
  imagingMode: string;
  maxFilesPerBatch: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toProjectKnowledgeSettingsOutput(
  settings: ProjectKnowledgeSettings,
): ProjectKnowledgeSettingsOutput {
  return {
    id: settings.id,
    projectId: settings.projectId,
    aiExtractionEnabled: settings.aiExtractionEnabled,
    ocrEnabled: settings.ocrEnabled,
    defaultModel: settings.defaultModel,
    imagingMode: settings.imagingMode,
    maxFilesPerBatch: settings.maxFilesPerBatch,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}
