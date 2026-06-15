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

export interface UpdateDocumentPositionInput {
  userId: string;
  id: string;
  positionX?: number | null;
  positionY?: number | null;
}

/**
 * 文書ノードの位置更新ユースケース（キャンバスのドラッグ位置永続化）。
 */
@Injectable()
export class UpdateDocumentPositionUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: UpdateDocumentPositionInput,
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

    doc.updatePosition({
      positionX: input.positionX,
      positionY: input.positionY,
    });
    await this.knowledgeRepository.saveDocument(doc);

    return toKnowledgeDocumentOutput(doc);
  }
}
