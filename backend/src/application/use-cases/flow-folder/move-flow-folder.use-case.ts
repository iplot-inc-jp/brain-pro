import { Inject, Injectable } from '@nestjs/common';
import {
  IFlowFolderRepository,
  FLOW_FOLDER_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
} from '../../../domain';
import { FlowFolderOutput, toFlowFolderOutput } from './flow-folder.output';

export interface MoveFlowFolderInput {
  userId: string;
  folderId: string;
  parentId?: string | null;
  order?: number;
}

/**
 * フローフォルダ移動ユースケース（親変更・並び順変更）
 */
@Injectable()
export class MoveFlowFolderUseCase {
  constructor(
    @Inject(FLOW_FOLDER_REPOSITORY)
    private readonly flowFolderRepository: IFlowFolderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: MoveFlowFolderInput): Promise<FlowFolderOutput> {
    const folder = await this.flowFolderRepository.findById(input.folderId);
    if (!folder) {
      throw new EntityNotFoundError('FlowFolder', input.folderId);
    }

    const project = await this.projectRepository.findById(folder.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', folder.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 新しい親フォルダの検証
    let newParentId: string | null = folder.parentId;
    if (input.parentId !== undefined) {
      newParentId = input.parentId;
      if (newParentId) {
        const parent = await this.flowFolderRepository.findById(newParentId);
        if (!parent || parent.projectId !== folder.projectId) {
          throw new EntityNotFoundError('FlowFolder', newParentId);
        }
        // 直接の自己参照と循環参照を防止
        if (await this.wouldCreateCycle(folder.id, newParentId)) {
          throw new ValidationError(
            'Cannot move a folder into its own descendant',
          );
        }
      }
    }

    folder.moveTo(newParentId, input.order);
    await this.flowFolderRepository.save(folder);

    return toFlowFolderOutput(folder);
  }

  /** 新しい親が自身またはその子孫であるかを判定 */
  private async wouldCreateCycle(
    folderId: string,
    newParentId: string,
  ): Promise<boolean> {
    let current: string | null = newParentId;
    const visited = new Set<string>();
    while (current) {
      if (current === folderId) return true;
      if (visited.has(current)) break;
      visited.add(current);
      const node = await this.flowFolderRepository.findById(current);
      current = node?.parentId ?? null;
    }
    return false;
  }
}
