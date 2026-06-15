import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  KnowledgeGraphOutput,
  toKnowledgeGraphOutput,
} from './knowledge-output';

export interface GetKnowledgeGraphInput {
  userId: string;
  projectId: string;
}

/**
 * ナレッジグラフ取得ユースケース（nodes + edges + documents）。
 */
@Injectable()
export class GetKnowledgeGraphUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: GetKnowledgeGraphInput): Promise<KnowledgeGraphOutput> {
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'view',
    );
    const graph = await this.knowledgeRepository.getGraph(input.projectId);
    return toKnowledgeGraphOutput(graph);
  }
}
