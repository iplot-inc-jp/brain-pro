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
import { FlowFolderOutput, toFlowFolderOutput } from './flow-folder.output';

export interface GetFlowFoldersInput {
  userId: string;
  projectId: string;
}

/**
 * プロジェクトのフローフォルダ一覧取得ユースケース
 * parentId を含むフラットなリストを返す（フロントでツリー化可能）
 */
@Injectable()
export class GetFlowFoldersUseCase {
  constructor(
    @Inject(FLOW_FOLDER_REPOSITORY)
    private readonly flowFolderRepository: IFlowFolderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetFlowFoldersInput): Promise<FlowFolderOutput[]> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    const folders = await this.flowFolderRepository.findByProjectId(
      input.projectId,
    );

    return folders.map((f) => toFlowFolderOutput(f));
  }
}
