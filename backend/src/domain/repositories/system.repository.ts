import { System } from '../entities/system.entity';

export const SYSTEM_REPOSITORY = Symbol('ISystemRepository');

export interface ISystemRepository {
  findById(id: string): Promise<System | null>;
  findByProjectId(projectId: string): Promise<System[]>;
  create(system: System): Promise<void>;
  update(system: System): Promise<void>;
  delete(id: string): Promise<void>;
  generateId(): string;
}
