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

export interface DeleteGlossaryTermInput {
  userId: string;
  principal: AccessPrincipal;
  termId: string;
}

/**
 * 用語削除ユースケース。用語対応（mappings）も連鎖削除される。
 */
@Injectable()
export class DeleteGlossaryTermUseCase {
  constructor(
    @Inject(GLOSSARY_TERM_REPOSITORY)
    private readonly glossaryTermRepository: IGlossaryTermRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteGlossaryTermInput): Promise<void> {
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

    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      term.projectId,
      'edit',
    );

    await this.glossaryTermRepository.delete(input.termId);
  }
}
