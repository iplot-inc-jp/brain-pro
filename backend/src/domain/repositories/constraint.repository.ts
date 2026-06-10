import { Constraint } from '../entities/constraint.entity';

export const CONSTRAINT_REPOSITORY = Symbol('IConstraintRepository');

export interface IConstraintRepository {
  findById(id: string): Promise<Constraint | null>;
  findByProjectId(projectId: string): Promise<Constraint[]>;
  create(constraint: Constraint): Promise<void>;
  update(constraint: Constraint): Promise<void>;
  delete(id: string): Promise<void>;
  generateId(): string;
}
