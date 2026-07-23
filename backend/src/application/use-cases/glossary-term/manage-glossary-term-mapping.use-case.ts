import { Inject, Injectable } from '@nestjs/common';
import {
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
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import {
  GlossaryTermMappingOutput,
  toGlossaryTermMappingOutput,
} from './glossary-term.output';

export interface CreateGlossaryTermMappingCommand {
  userId: string;
  principal: AccessPrincipal;
  termId: string;
  context?: string | null;
  systemName?: string | null;
  value: string;
  note?: string | null;
  order?: number;
}

export interface UpdateGlossaryTermMappingCommand {
  userId: string;
  principal: AccessPrincipal;
  mappingId: string;
  context?: string | null;
  systemName?: string | null;
  value?: string;
  note?: string | null;
  order?: number;
}

export interface DeleteGlossaryTermMappingCommand {
  userId: string;
  principal: AccessPrincipal;
  mappingId: string;
}

/**
 * 用語対応（GlossaryTermMapping）の作成・更新・削除ユースケース。
 *
 * 対応は用語に従属する子レコードのため、権限判定は親の用語が属する
 * プロジェクトに対して行う。
 */
@Injectable()
export class ManageGlossaryTermMappingUseCase {
  constructor(
    @Inject(GLOSSARY_TERM_REPOSITORY)
    private readonly glossaryTermRepository: IGlossaryTermRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /** 親の用語を取得し、所属組織のメンバーであることと編集権限を確認する。 */
  private async assertEditableTerm(
    termId: string,
    userId: string,
    principal: AccessPrincipal,
  ): Promise<string> {
    const term = await this.glossaryTermRepository.findById(termId);
    if (!term) {
      throw new EntityNotFoundError('GlossaryTerm', termId);
    }

    const project = await this.projectRepository.findById(term.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', term.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    await this.projectAccess.assertPrincipalAccess(
      principal,
      term.projectId,
      'edit',
    );

    return term.projectId;
  }

  async create(
    input: CreateGlossaryTermMappingCommand,
  ): Promise<GlossaryTermMappingOutput> {
    await this.assertEditableTerm(input.termId, input.userId, input.principal);

    const mapping = GlossaryTermMapping.create(
      {
        termId: input.termId,
        context: input.context,
        systemName: input.systemName,
        value: input.value,
        note: input.note,
        order: input.order,
      },
      this.glossaryTermRepository.generateId(),
    );
    await this.glossaryTermRepository.createMapping(mapping);

    return toGlossaryTermMappingOutput(mapping);
  }

  async update(
    input: UpdateGlossaryTermMappingCommand,
  ): Promise<GlossaryTermMappingOutput> {
    const mapping = await this.glossaryTermRepository.findMappingById(
      input.mappingId,
    );
    if (!mapping) {
      throw new EntityNotFoundError('GlossaryTermMapping', input.mappingId);
    }

    await this.assertEditableTerm(
      mapping.termId,
      input.userId,
      input.principal,
    );

    mapping.update({
      context: input.context,
      systemName: input.systemName,
      value: input.value,
      note: input.note,
      order: input.order,
    });
    await this.glossaryTermRepository.updateMapping(mapping);

    return toGlossaryTermMappingOutput(mapping);
  }

  async delete(input: DeleteGlossaryTermMappingCommand): Promise<void> {
    const mapping = await this.glossaryTermRepository.findMappingById(
      input.mappingId,
    );
    if (!mapping) {
      throw new EntityNotFoundError('GlossaryTermMapping', input.mappingId);
    }

    await this.assertEditableTerm(
      mapping.termId,
      input.userId,
      input.principal,
    );

    await this.glossaryTermRepository.deleteMapping(input.mappingId);
  }
}
