import { Inject, Injectable } from '@nestjs/common';
import {
  IGlossaryTermRepository,
  GLOSSARY_TERM_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import { GlossaryTermOutput, toGlossaryTermOutput } from './glossary-term.output';

export interface UpdateGlossaryTermInput {
  userId: string;
  principal: AccessPrincipal;
  termId: string;
  subProjectId?: string | null;
  termCode?: string | null;
  name?: string;
  definition?: string | null;
  sourceOfTruth?: string | null;
  sourceOfTruthNote?: string | null;
  category?: string | null;
  status?: string | null;
  notes?: string | null;
  order?: number;
}

/**
 * 用語更新ユースケース。
 */
@Injectable()
export class UpdateGlossaryTermUseCase {
  constructor(
    @Inject(GLOSSARY_TERM_REPOSITORY)
    private readonly glossaryTermRepository: IGlossaryTermRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateGlossaryTermInput): Promise<GlossaryTermOutput> {
    const term = await this.glossaryTermRepository.findById(input.termId);
    if (!term) {
      throw new EntityNotFoundError('GlossaryTerm', input.termId);
    }

    const project = await this.projectRepository.findById(term.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', term.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      term.projectId,
      'edit',
    );

    term.update({
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
    });
    await this.glossaryTermRepository.update(term);

    const updated = await this.glossaryTermRepository.findById(input.termId);
    return toGlossaryTermOutput(updated ?? term);
  }
}
