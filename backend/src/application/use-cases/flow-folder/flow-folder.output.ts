import { FlowFolder } from '../../../domain';

export interface FlowFolderOutput {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toFlowFolderOutput(folder: FlowFolder): FlowFolderOutput {
  return {
    id: folder.id,
    projectId: folder.projectId,
    parentId: folder.parentId,
    name: folder.name,
    order: folder.order,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  };
}
