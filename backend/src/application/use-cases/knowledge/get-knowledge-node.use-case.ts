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
import {
  KnowledgeNodeDetailOutput,
  toKnowledgeNodeDetailOutput,
} from './knowledge-output';

export interface GetKnowledgeNodeInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * ナレッジノード詳細取得ユースケース（mentions 込み）。
 * id 指定（projectId はノードから解決）→ assertPrincipalAccess('view')。
 */
@Injectable()
export class GetKnowledgeNodeUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: GetKnowledgeNodeInput,
  ): Promise<KnowledgeNodeDetailOutput> {
    const detail = await this.knowledgeRepository.getNodeDetail(input.id);
    if (!detail) {
      throw new EntityNotFoundError('KnowledgeNode', input.id);
    }
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      detail.node.projectId,
      'view',
    );
    return toKnowledgeNodeDetailOutput(detail);
  }
}
