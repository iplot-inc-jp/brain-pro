import { Inject, Injectable } from '@nestjs/common';
import {
  IAsisMemoRepository,
  ASIS_MEMO_REPOSITORY,
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

export interface DeleteAsisMemoInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * ASISメモ削除ユースケース
 */
@Injectable()
export class DeleteAsisMemoUseCase {
  constructor(
    @Inject(ASIS_MEMO_REPOSITORY)
    private readonly asisMemoRepository: IAsisMemoRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteAsisMemoInput): Promise<void> {
    // 1. ASISメモ存在確認
    const asisMemo = await this.asisMemoRepository.findById(input.id);
    if (!asisMemo) {
      throw new EntityNotFoundError('AsisMemo', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(asisMemo.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', asisMemo.projectId);
    }

    // 3. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // プロジェクト単位 RBAC: 書込のため edit 強制
    await this.projectAccess.assertPrincipalAccess(
      input.principal,
      asisMemo.projectId,
      'edit',
    );

    // 4. 削除
    await this.asisMemoRepository.delete(input.id);
  }
}
