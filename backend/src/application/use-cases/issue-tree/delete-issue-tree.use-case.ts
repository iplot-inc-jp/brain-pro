import { Inject, Injectable } from '@nestjs/common';
import {
  IIssueTreeRepository,
  ISSUE_TREE_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  ProjectAccessService,
  AccessPrincipal,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteIssueTreeInput {
  userId: string;
  principal: AccessPrincipal;
  treeId: string;
}

/**
 * イシューツリー削除ユースケース（ノードはDB側のカスケードで削除）
 */
@Injectable()
export class DeleteIssueTreeUseCase {
  constructor(
    @Inject(ISSUE_TREE_REPOSITORY)
    private readonly issueTreeRepository: IIssueTreeRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteIssueTreeInput): Promise<void> {
    // 1. ツリー存在確認
    const tree = await this.issueTreeRepository.findById(input.treeId);
    if (!tree) {
      throw new EntityNotFoundError('IssueTree', input.treeId);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(tree.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', tree.projectId);
    }

    // 3. 組織メンバー確認（プロジェクトスコープ認可）
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You do not have access to this project');
    }

    // 4. プロジェクト単位 RBAC: 書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      tree.projectId,
      'edit',
    );

    // 5. 削除
    await this.issueTreeRepository.delete(tree.id);
  }
}
