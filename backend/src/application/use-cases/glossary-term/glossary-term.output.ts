import { GlossaryTerm, GlossaryTermMapping } from '../../../domain';

export interface GlossaryTermMappingOutput {
  id: string;
  termId: string;
  context: string;
  systemName: string | null;
  value: string;
  note: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GlossaryTermOutput {
  id: string;
  projectId: string;
  subProjectId: string | null;
  termCode: string | null;
  name: string;
  definition: string | null;
  sourceOfTruth: string | null;
  sourceOfTruthNote: string | null;
  category: string | null;
  status: string;
  notes: string | null;
  order: number;
  mappings: GlossaryTermMappingOutput[];
  createdAt: Date;
  updatedAt: Date;
}

export function toGlossaryTermMappingOutput(
  mapping: GlossaryTermMapping,
): GlossaryTermMappingOutput {
  return {
    id: mapping.id,
    termId: mapping.termId,
    context: mapping.context,
    systemName: mapping.systemName,
    value: mapping.value,
    note: mapping.note,
    order: mapping.order,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  };
}

export function toGlossaryTermOutput(term: GlossaryTerm): GlossaryTermOutput {
  return {
    id: term.id,
    projectId: term.projectId,
    subProjectId: term.subProjectId,
    termCode: term.termCode,
    name: term.name,
    definition: term.definition,
    sourceOfTruth: term.sourceOfTruth,
    sourceOfTruthNote: term.sourceOfTruthNote,
    category: term.category,
    status: term.status,
    notes: term.notes,
    order: term.order,
    mappings: term.mappings.map((m) => toGlossaryTermMappingOutput(m)),
    createdAt: term.createdAt,
    updatedAt: term.updatedAt,
  };
}
