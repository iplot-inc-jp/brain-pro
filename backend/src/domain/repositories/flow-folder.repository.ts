import { FlowFolder } from '../entities/flow-folder.entity';

export const FLOW_FOLDER_REPOSITORY = Symbol('FLOW_FOLDER_REPOSITORY');

export interface IFlowFolderRepository {
  findById(id: string): Promise<FlowFolder | null>;
  findByProjectId(projectId: string): Promise<FlowFolder[]>;
  findChildrenByParentId(parentId: string): Promise<FlowFolder[]>;
  save(folder: FlowFolder): Promise<void>;
  delete(id: string): Promise<void>;
  generateId(): string;
}
