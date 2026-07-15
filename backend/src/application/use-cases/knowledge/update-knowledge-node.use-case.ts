import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
  KnowledgeNodeTypeValue,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';
import {
  KnowledgeNodeOutput,
  toKnowledgeNodeOutput,
} from './knowledge-output';

export interface UpdateKnowledgeNodeInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  label?: string;
  description?: string | null;
  color?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  entityKind?: string | null;
  type?: KnowledgeNodeTypeValue;
}

/**
 * ナレッジノード更新ユースケース（label / description / color / position / entityKind / type）。
 */
@Injectable()
export class UpdateKnowledgeNodeUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: UpdateKnowledgeNodeInput,
  ): Promise<KnowledgeNodeOutput> {
    const node = await this.knowledgeRepository.findNodeById(input.id);
    if (!node) {
      throw new EntityNotFoundError('KnowledgeNode', input.id);
    }
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      node.projectId,
      'edit',
    );

    node.update({
      label: input.label,
      description: input.description,
      color: input.color,
      positionX: input.positionX,
      positionY: input.positionY,
      entityKind: input.entityKind,
      type: input.type,
    });
    await this.knowledgeRepository.saveNode(node);

    return toKnowledgeNodeOutput(node);
  }
}
