import { ProjectKnowledgeSettings } from '../entities';

/**
 * ProjectKnowledgeSettings リポジトリインターフェース。
 * projectId は @unique（1プロジェクト = 1設定）。
 */
export interface IProjectKnowledgeSettingsRepository {
  /** projectId で検索（無ければ null → use-case が既定値で create） */
  findByProjectId(projectId: string): Promise<ProjectKnowledgeSettings | null>;

  /** 保存（upsert） */
  save(settings: ProjectKnowledgeSettings): Promise<void>;

  /** IDの生成 */
  generateId(): string;
}

export const PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY = Symbol(
  'PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY',
);
