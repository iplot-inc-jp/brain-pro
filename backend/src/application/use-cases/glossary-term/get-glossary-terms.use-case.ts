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
import { GlossaryTermOutput, toGlossaryTermOutput } from './glossary-term.output';

export interface GetGlossaryTermsInput {
  userId: string;
  projectId: string;
}

/**
 * プロジェクトの用語集一覧取得ユースケース。
 * 各用語には用語対応（mappings）が含まれる。
 */
@Injectable()
export class GetGlossaryTermsUseCase {
  constructor(
    @Inject(GLOSSARY_TERM_REPOSITORY)
    private readonly glossaryTermRepository: IGlossaryTermRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetGlossaryTermsInput): Promise<GlossaryTermOutput[]> {
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

    const terms = await this.glossaryTermRepository.findByProjectId(
      input.projectId,
    );

    return terms.map((t) => toGlossaryTermOutput(t));
  }
}
