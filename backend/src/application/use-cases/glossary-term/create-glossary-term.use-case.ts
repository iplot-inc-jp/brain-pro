import { Inject, Injectable } from '@nestjs/common';
import {
  GlossaryTerm,
  GlossaryTermMapping,
  IGlossaryTermRepository,
  GLOSSARY_TERM_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import { GlossaryTermOutput, toGlossaryTermOutput } from './glossary-term.output';

export interface CreateGlossaryTermMappingInput {
  context?: string | null;
  systemName?: string | null;
  value: string;
  note?: string | null;
  order?: number;
}

export interface CreateGlossaryTermInput {
  userId: string;
  projectId: string;
  subProjectId?: string | null;
  termCode?: string | null;
  name: string;
  definition?: string | null;
  sourceOfTruth?: string | null;
  sourceOfTruthNote?: string | null;
  category?: string | null;
  status?: string | null;
  notes?: string | null;
  order?: number;
  /** 用語対応をまとめて登録する場合（任意）。 */
  mappings?: CreateGlossaryTermMappingInput[];
}

/**
 * 用語作成ユースケース。
 * 用語対応（mappings）を同時に登録できる（一括投入・移行を想定）。
 */
@Injectable()
export class CreateGlossaryTermUseCase {
  constructor(
    @Inject(GLOSSARY_TERM_REPOSITORY)
    private readonly glossaryTermRepository: IGlossaryTermRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateGlossaryTermInput): Promise<GlossaryTermOutput> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const id = this.glossaryTermRepository.generateId();
    const term = GlossaryTerm.create(
      {
        projectId: input.projectId,
        subProjectId: input.subProjectId,
        termCode: input.termCode,
        name: input.name,
        definition: input.definition,
        sourceOfTruth: input.sourceOfTruth,
        sourceOfTruthNote: input.sourceOfTruthNote,
        category: input.category,
        status: input.status,
        notes: input.notes,
        order: input.order,
      },
      id,
    );

    await this.glossaryTermRepository.create(term);

    for (const [index, m] of (input.mappings ?? []).entries()) {
      const mapping = GlossaryTermMapping.create(
        {
          termId: id,
          context: m.context,
          systemName: m.systemName,
          value: m.value,
          note: m.note,
          order: m.order ?? index,
        },
        this.glossaryTermRepository.generateId(),
      );
      await this.glossaryTermRepository.createMapping(mapping);
    }

    const created = await this.glossaryTermRepository.findById(id);
    return toGlossaryTermOutput(created ?? term);
  }
}
