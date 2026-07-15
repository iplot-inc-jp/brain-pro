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
import { AsisMemoOutput, toAsisMemoOutput } from './create-asis-memo.use-case';

export interface UpdateAsisMemoInput {
  userId: string;
  principal: AccessPrincipal;
  id: string;
  topic?: string | null;
  currentState?: string | null;
  pain?: string | null;
  restriction?: string | null;
  note?: string | null;
  order?: number;
}

/**
 * ASISメモ更新ユースケース
 */
@Injectable()
export class UpdateAsisMemoUseCase {
  constructor(
    @Inject(ASIS_MEMO_REPOSITORY)
    private readonly asisMemoRepository: IAsisMemoRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(input: UpdateAsisMemoInput): Promise<AsisMemoOutput> {
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

    // 4. ドメインロジック適用
    asisMemo.update({
      topic: input.topic,
      currentState: input.currentState,
      pain: input.pain,
      restriction: input.restriction,
      note: input.note,
      order: input.order,
    });

    // 5. 永続化
    await this.asisMemoRepository.save(asisMemo);

    // 6. 出力返却
    return toAsisMemoOutput(asisMemo);
  }
}
