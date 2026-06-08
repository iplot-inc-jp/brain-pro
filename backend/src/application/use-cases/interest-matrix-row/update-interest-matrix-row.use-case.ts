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

export interface UpdateInterestMatrixRowInput {
  userId: string;
  id: string;
  phase?: string | null;
  duration?: string | null;
  mainMeetings?: string | null;
  fieldStaff?: string | null;
  clientPm?: string | null;
  executive?: string | null;
  order?: number;
}

/**
 * 関心ごとマトリクス行更新ユースケース
 */
@Injectable()
export class UpdateInterestMatrixRowUseCase {
  constructor(
    @Inject(INTEREST_MATRIX_ROW_REPOSITORY)
    private readonly interestMatrixRowRepository: IInterestMatrixRowRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: UpdateInterestMatrixRowInput,
  ): Promise<InterestMatrixRowOutput> {
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

    // 4. ドメインロジック適用
    row.update({
      phase: input.phase,
      duration: input.duration,
      mainMeetings: input.mainMeetings,
      fieldStaff: input.fieldStaff,
      clientPm: input.clientPm,
      executive: input.executive,
      order: input.order,
    });

    // 5. 永続化
    await this.interestMatrixRowRepository.save(row);

    // 6. 出力返却
    return toInterestMatrixRowOutput(row);
  }
}
