import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface DeleteKnowledgeRelationInput {
  userId: string;
  id: string;
}

/**
 * ナレッジ関係（エッジ）削除ユースケース。
 */
@Injectable()
export class DeleteKnowledgeRelationUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteKnowledgeRelationInput): Promise<void> {
    const rel = await this.knowledgeRepository.findRelationById(input.id);
    if (!rel) {
      throw new EntityNotFoundError('KnowledgeRelation', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      rel.projectId,
      input.userId,
      'edit',
    );
    await this.knowledgeRepository.deleteRelation(input.id);
  }
}
