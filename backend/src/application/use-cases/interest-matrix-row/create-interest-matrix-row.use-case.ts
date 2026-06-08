import { Inject, Injectable } from '@nestjs/common';
import {
  InterestMatrixRow,
  IInterestMatrixRowRepository,
  INTEREST_MATRIX_ROW_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';

export interface CreateInterestMatrixRowInput {
  userId: string;
  projectId: string;
  phase?: string | null;
  duration?: string | null;
  mainMeetings?: string | null;
  fieldStaff?: string | null;
  clientPm?: string | null;
  executive?: string | null;
  order?: number;
}

export interface InterestMatrixRowOutput {
  id: string;
  projectId: string;
  phase: string | null;
  duration: string | null;
  mainMeetings: string | null;
  fieldStaff: string | null;
  clientPm: string | null;
  executive: string | null;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export function toInterestMatrixRowOutput(
  row: InterestMatrixRow,
): InterestMatrixRowOutput {
  return {
    id: row.id,
    projectId: row.projectId,
    phase: row.phase,
    duration: row.duration,
    mainMeetings: row.mainMeetings,
    fieldStaff: row.fieldStaff,
    clientPm: row.clientPm,
    executive: row.executive,
    order: row.order,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 関心ごとマトリクス行作成ユースケース
 */
@Injectable()
export class CreateInterestMatrixRowUseCase {
  constructor(
    @Inject(INTEREST_MATRIX_ROW_REPOSITORY)
    private readonly interestMatrixRowRepository: IInterestMatrixRowRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(
    input: CreateInterestMatrixRowInput,
  ): Promise<InterestMatrixRowOutput> {
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

    // 3. ID生成
    const id = this.interestMatrixRowRepository.generateId();

    // 4. エンティティ生成
    const row = InterestMatrixRow.create(
      {
        projectId: input.projectId,
        phase: input.phase,
        duration: input.duration,
        mainMeetings: input.mainMeetings,
        fieldStaff: input.fieldStaff,
        clientPm: input.clientPm,
        executive: input.executive,
        order: input.order,
      },
      id,
    );

    // 5. 永続化
    await this.interestMatrixRowRepository.save(row);

    // 6. 出力返却
    return toInterestMatrixRowOutput(row);
  }
}
