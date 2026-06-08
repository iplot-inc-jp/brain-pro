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
  InterestMatrixRowOutput,
  toInterestMatrixRowOutput,
} from './create-interest-matrix-row.use-case';

export interface GetInterestMatrixRowsInput {
  userId: string;
  projectId: string;
}

/**
 * 関心ごとマトリクス行一覧取得ユースケース（プロジェクト内、order昇順）
 */
@Injectable()
export class GetInterestMatrixRowsUseCase {
  constructor(
    @Inject(INTEREST_MATRIX_ROW_REPOSITORY)
    private readonly interestMatrixRowRepository: IInterestMatrixRowRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: GetInterestMatrixRowsInput,
  ): Promise<InterestMatrixRowOutput[]> {
    // 1. プロジェクト存在確認
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    // 2. 組織メンバー確認
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    // 3. 一覧取得
    const rows = await this.interestMatrixRowRepository.findByProjectId(
      input.projectId,
    );

    // 4. DTOに変換して返却
    return rows.map((r) => toInterestMatrixRowOutput(r));
  }
}
