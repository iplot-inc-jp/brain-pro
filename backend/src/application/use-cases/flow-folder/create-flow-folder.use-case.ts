import { Inject, Injectable } from '@nestjs/common';
import {
  FlowFolder,
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

export interface CreateFlowFolderInput {
  userId: string;
  projectId: string;
  parentId?: string | null;
  name: string;
  order?: number;
}

/**
 * フローフォルダ作成ユースケース
 */
@Injectable()
export class CreateFlowFolderUseCase {
  constructor(
    @Inject(FLOW_FOLDER_REPOSITORY)
    private readonly flowFolderRepository: IFlowFolderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateFlowFolderInput): Promise<FlowFolderOutput> {
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

    // 親フォルダが指定されている場合、同一プロジェクトに属することを確認
    if (input.parentId) {
      const parent = await this.flowFolderRepository.findById(input.parentId);
      if (!parent || parent.projectId !== input.projectId) {
        throw new EntityNotFoundError('FlowFolder', input.parentId);
      }
    }

    const id = this.flowFolderRepository.generateId();
    const folder = FlowFolder.create(
      {
        projectId: input.projectId,
        parentId: input.parentId,
        name: input.name,
        order: input.order,
      },
      id,
    );

    await this.flowFolderRepository.save(folder);

    return toFlowFolderOutput(folder);
  }
}
