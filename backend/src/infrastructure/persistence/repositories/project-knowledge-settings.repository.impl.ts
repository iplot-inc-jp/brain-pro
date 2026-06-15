import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ProjectKnowledgeSettings,
  IProjectKnowledgeSettingsRepository,
  ImagingModeValue,
} from '../../../domain';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ProjectKnowledgeSettings リポジトリ実装。projectId は @unique。
 */
@Injectable()
export class ProjectKnowledgeSettingsRepositoryImpl
  implements IProjectKnowledgeSettingsRepository
{
  constructor(private readonly prisma: PrismaService) {}

  private toDomain(data: {
    id: string;
    projectId: string;
    aiExtractionEnabled: boolean;
    ocrEnabled: boolean;
    defaultModel: string | null;
    imagingMode: string;
    maxFilesPerBatch: number;
    createdAt: Date;
    updatedAt: Date;
  }): ProjectKnowledgeSettings {
    return ProjectKnowledgeSettings.reconstruct({
      id: data.id,
      projectId: data.projectId,
      aiExtractionEnabled: data.aiExtractionEnabled,
      ocrEnabled: data.ocrEnabled,
      defaultModel: data.defaultModel,
      imagingMode: data.imagingMode as ImagingModeValue,
      maxFilesPerBatch: data.maxFilesPerBatch,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    });
  }

  async findByProjectId(
    projectId: string,
  ): Promise<ProjectKnowledgeSettings | null> {
    const data = await this.prisma.projectKnowledgeSettings.findUnique({
      where: { projectId },
    });
    if (!data) return null;
    return this.toDomain(data);
  }

  async save(settings: ProjectKnowledgeSettings): Promise<void> {
    const data = {
      projectId: settings.projectId,
      aiExtractionEnabled: settings.aiExtractionEnabled,
      ocrEnabled: settings.ocrEnabled,
      defaultModel: settings.defaultModel,
      imagingMode: settings.imagingMode,
      maxFilesPerBatch: settings.maxFilesPerBatch,
    };
    // upsert は一意キー（projectId @unique）で行う。id 指定だと get-or-create で
    // 別 id を生成した並行リクエストが衝突しうるため、業務上の一意キーで突き合わせる。
    await this.prisma.projectKnowledgeSettings.upsert({
      where: { projectId: settings.projectId },
      create: {
        id: settings.id,
        ...data,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      },
      update: {
        ...data,
        updatedAt: settings.updatedAt,
      },
    });
  }

  generateId(): string {
    return randomUUID();
  }
}
