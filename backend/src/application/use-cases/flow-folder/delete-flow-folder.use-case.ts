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
} from '../../../domain';

export interface DeleteFlowFolderInput {
  userId: string;
  folderId: string;
}

/**
 * フローフォルダ削除ユースケース
 * 子フォルダはスキーマの onDelete: Cascade で連鎖削除される。
 * 紐づく BusinessFlow.folderId は onDelete: SetNull で NULL になる（フロー自体は残る）。
 */
@Injectable()
export class DeleteFlowFolderUseCase {
  constructor(
    @Inject(FLOW_FOLDER_REPOSITORY)
    private readonly flowFolderRepository: IFlowFolderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: DeleteFlowFolderInput): Promise<void> {
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

    await this.flowFolderRepository.delete(input.folderId);
  }
}
