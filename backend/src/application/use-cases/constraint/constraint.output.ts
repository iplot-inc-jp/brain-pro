import { Constraint } from '../../../domain';

export interface ConstraintOutput {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  category: string | null;
  kind: string | null;
  order: number;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toConstraintOutput(constraint: Constraint): ConstraintOutput {
  return {
    id: constraint.id,
    projectId: constraint.projectId,
    title: constraint.title,
    description: constraint.description,
    category: constraint.category,
    kind: constraint.kind,
    order: constraint.order,
    subProjectId: constraint.subProjectId,
    createdAt: constraint.createdAt,
    updatedAt: constraint.updatedAt,
  };
}
