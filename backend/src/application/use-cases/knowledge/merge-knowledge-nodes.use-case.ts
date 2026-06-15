import { Inject, Injectable } from '@nestjs/common';
import {
  IKnowledgeRepository,
  KNOWLEDGE_REPOSITORY,
  EntityNotFoundError,
  ValidationError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  KnowledgeNodeOutput,
  toKnowledgeNodeOutput,
} from './knowledge-output';

export interface MergeKnowledgeNodesInput {
  userId: string;
  /** マージ元（削除される側）ノードID */
  id: string;
  /** マージ先（残る側）ノードID */
  targetNodeId: string;
}

/**
 * ナレッジノードマージユースケース。
 * source（:id）の mentions / relations を target に付け替え、source を削除する。
 * 同一ノード / 別type / 別project は 400（ValidationError）。
 * 付け替え後の target ノードを返す。
 */
@Injectable()
export class MergeKnowledgeNodesUseCase {
  constructor(
    @Inject(KNOWLEDGE_REPOSITORY)
    private readonly knowledgeRepository: IKnowledgeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: MergeKnowledgeNodesInput,
  ): Promise<KnowledgeNodeOutput> {
    if (input.id === input.targetNodeId) {
      throw new ValidationError('Cannot merge a node into itself');
    }

    const source = await this.knowledgeRepository.findNodeById(input.id);
    if (!source) {
      throw new EntityNotFoundError('KnowledgeNode', input.id);
    }
    const target = await this.knowledgeRepository.findNodeById(
      input.targetNodeId,
    );
    if (!target) {
      throw new EntityNotFoundError('KnowledgeNode', input.targetNodeId);
    }

    // 認可は source 側 projectId で edit を要求。
    await this.projectAccess.assertProjectAccess(
      source.projectId,
      input.userId,
      'edit',
    );

    if (source.projectId !== target.projectId) {
      throw new ValidationError('Cannot merge nodes across projects');
    }
    if (source.type !== target.type) {
      throw new ValidationError('Cannot merge nodes of different type');
    }

    await this.knowledgeRepository.mergeNodes(source.id, target.id);

    // マージ後（mentionCount 再計算済み）の target を返す。
    const merged = await this.knowledgeRepository.findNodeById(target.id);
    if (!merged) {
      throw new EntityNotFoundError('KnowledgeNode', target.id);
    }
    return toKnowledgeNodeOutput(merged);
  }
}
