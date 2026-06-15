import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';

export interface DeleteKnowledgeDocumentInput {
  userId: string;
  id: string;
}

/**
 * ナレッジ文書削除ユースケース。
 * 文書 + その mentions を削除（relations.sourceDocumentId は SetNull）、
 * 関係していたノードの mentionCount を再計算する（リポジトリの $transaction）。
 */
@Injectable()
export class DeleteKnowledgeDocumentUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteKnowledgeDocumentInput): Promise<void> {
    const doc = await this.knowledgeRepository.findDocumentById(input.id);
    if (!doc) {
      throw new EntityNotFoundError('KnowledgeDocument', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      doc.projectId,
      input.userId,
      'edit',
    );
    await this.knowledgeRepository.deleteDocument(input.id);
  }
}
