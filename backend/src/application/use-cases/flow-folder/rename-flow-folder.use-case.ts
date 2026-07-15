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
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface RenameFlowFolderInput {
  userId: string;
  principal: AccessPrincipal;
  folderId: string;
  name: string;
}

/**
 * フローフォルダ名変更ユースケース
 */
@Injectable()
export class RenameFlowFolderUseCase {
  constructor(
    @Inject(FLOW_FOLDER_REPOSITORY)
    private readonly flowFolderRepository: IFlowFolderRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: RenameFlowFolderInput): Promise<FlowFolderOutput> {
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

    // プロジェクト単位 RBAC: フォルダ名変更は書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      folder.projectId,
      'edit',
    );

    folder.rename(input.name);
    await this.flowFolderRepository.save(folder);

    return toFlowFolderOutput(folder);
  }
}
