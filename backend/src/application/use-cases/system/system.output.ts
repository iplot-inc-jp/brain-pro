import { System, SystemKindValue } from '../../../domain';

export interface SystemOutput {
  id: string;
  projectId: string;
  name: string;
  kind: SystemKindValue;
  description: string | null;
  order: number;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSystemOutput(system: System): SystemOutput {
  return {
    id: system.id,
    projectId: system.projectId,
    name: system.name,
    kind: system.kind,
    description: system.description,
    order: system.order,
    subProjectId: system.subProjectId,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
  };
}
