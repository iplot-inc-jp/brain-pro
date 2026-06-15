import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface DeleteKnowledgeNodeInput {
  userId: string;
  id: string;
}

/**
 * ナレッジノード削除ユースケース。
 * mention / relation は DB の Cascade で削除される。
 */
@Injectable()
export class DeleteKnowledgeNodeUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteKnowledgeNodeInput): Promise<void> {
    const node = await this.knowledgeRepository.findNodeById(input.id);
    if (!node) {
      throw new EntityNotFoundError('KnowledgeNode', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      node.projectId,
      input.userId,
      'edit',
    );
    await this.knowledgeRepository.deleteNode(input.id);
  }
}
