import { Inject, Injectable } from '@nestjs/common';
import {
  IInterestMatrixRowRepository,
  INTEREST_MATRIX_ROW_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  AccessPrincipal,
  ProjectAccessService,
} from '../../../infrastructure/services/project-access.service';

export interface DeleteInterestMatrixRowInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
}

/**
 * 関心ごとマトリクス行削除ユースケース
 */
@Injectable()
export class DeleteInterestMatrixRowUseCase {
  constructor(
    @Inject(INTEREST_MATRIX_ROW_REPOSITORY)
    private readonly interestMatrixRowRepository: IInterestMatrixRowRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: DeleteInterestMatrixRowInput): Promise<void> {
    // 1. 行存在確認
    const row = await this.interestMatrixRowRepository.findById(input.id);
    if (!row) {
      throw new EntityNotFoundError('InterestMatrixRow', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(row.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', row.projectId);
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
      row.projectId,
      'edit',
    );

    // 4. 削除
    await this.interestMatrixRowRepository.delete(input.id);
  }
}
