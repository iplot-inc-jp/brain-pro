import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  KnowledgeDocumentOutput,
  toKnowledgeDocumentOutput,
} from './knowledge-output';

export interface UpdateKnowledgeDocumentInput {
  userId: string;
  id: string;
  title?: string;
  summary?: string | null;
}

/**
 * ナレッジ文書更新ユースケース（title / summary）。
 */
@Injectable()
export class UpdateKnowledgeDocumentUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: UpdateKnowledgeDocumentInput,
  ): Promise<KnowledgeDocumentOutput> {
    const doc = await this.knowledgeRepository.findDocumentById(input.id);
    if (!doc) {
      throw new EntityNotFoundError('KnowledgeDocument', input.id);
    }
    await this.projectAccess.assertProjectAccess(
      doc.projectId,
      input.userId,
      'edit',
    );

    doc.update({ title: input.title, summary: input.summary });
    await this.knowledgeRepository.saveDocument(doc);

    return toKnowledgeDocumentOutput(doc);
  }
}
