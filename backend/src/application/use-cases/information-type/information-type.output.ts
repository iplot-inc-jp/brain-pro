import { InformationType, InformationCategoryValue } from '../../../domain';

export interface InformationTypeOutput {
  id: string;
  projectId: string;
  name: string;
  category: InformationCategoryValue;
  description: string | null;
  order: number;
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
    attachmentCount,
    createdAt: informationType.createdAt,
    updatedAt: informationType.updatedAt,
  };
}
