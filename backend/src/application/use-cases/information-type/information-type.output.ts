import { InformationType, InformationCategoryValue } from '../../../domain';

export interface InformationTypeOutput {
  id: string;
  projectId: string;
  name: string;
  category: InformationCategoryValue;
  description: string | null;
  order: number;
  // 紐づくサブ領域（共通マスタ基盤。任意）
  subProjectId: string | null;
  attachmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toInformationTypeOutput(
  informationType: InformationType,
  attachmentCount = 0,
): InformationTypeOutput {
  return {
    id: informationType.id,
    projectId: informationType.projectId,
    name: informationType.name,
    category: informationType.category,
    description: informationType.description,
    order: informationType.order,
    subProjectId: informationType.subProjectId,
    attachmentCount,
    createdAt: informationType.createdAt,
    updatedAt: informationType.updatedAt,
  };
}
