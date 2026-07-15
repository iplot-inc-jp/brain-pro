import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteKnowledgeNodeInput {
  userId: string;
  principal: AccessPrincipal;
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
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      node.projectId,
      'edit',
    );
    await this.knowledgeRepository.deleteNode(input.id);
  }
}
