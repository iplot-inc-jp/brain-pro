import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  KnowledgeSearchOutput,
  toKnowledgeSearchOutput,
} from './knowledge-output';

export interface SearchKnowledgeInput {
  userId: string;
  projectId: string;
  query: string;
}

/**
 * ナレッジ検索ユースケース（ラベル/タイトル部分一致 → ノード + 文書）。
 */
@Injectable()
export class SearchKnowledgeUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: SearchKnowledgeInput): Promise<KnowledgeSearchOutput> {
    await this.projectAccess.assertProjectAccess(
      input.projectId,
      input.userId,
      'view',
    );
    const result = await this.knowledgeRepository.search(
      input.projectId,
      input.query ?? '',
    );
    return toKnowledgeSearchOutput(result);
  }
}
