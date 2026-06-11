import { RiskCategory } from '../../../domain';

export interface RiskCategoryOutput {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toRiskCategoryOutput(
  riskCategory: RiskCategory,
): RiskCategoryOutput {
  return {
    id: riskCategory.id,
    projectId: riskCategory.projectId,
    name: riskCategory.name,
    order: riskCategory.order,
    createdAt: riskCategory.createdAt,
    updatedAt: riskCategory.updatedAt,
  };
}
