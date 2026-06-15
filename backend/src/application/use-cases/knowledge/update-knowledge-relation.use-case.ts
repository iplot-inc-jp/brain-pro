import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  KnowledgeEdgeOutput,
  toKnowledgeEdgeOutput,
} from './knowledge-output';

export interface UpdateKnowledgeRelationInput {
  userId: string;
  id: string;
  label?: string | null;
  type?: string | null;
}

/**
 * ナレッジ関係（エッジ）更新ユースケース（label / type）。
 */
@Injectable()
export class UpdateKnowledgeRelationUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: UpdateKnowledgeRelationInput,
  ): Promise<KnowledgeEdgeOutput> {
    const rel = await this.knowledgeRepository.findRelationById(input.id);
    if (!rel) {
      throw new EntityNotFoundError('KnowledgeRelation', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      rel.projectId,
      input.userId,
      'edit',
    );

    const updated = await this.knowledgeRepository.updateRelation(input.id, {
      label: input.label,
      type: input.type,
    });
    return toKnowledgeEdgeOutput(updated);
  }
}
