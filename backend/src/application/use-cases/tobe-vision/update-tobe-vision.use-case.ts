import { Inject, Injectable } from '@nestjs/common';
import {
  ITobeVisionRepository,
  TOBE_VISION_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  TobeVisionOutput,
  toTobeVisionOutput,
} from './create-tobe-vision.use-case';

export interface UpdateTobeVisionInput {
  userId: string;
  id: string;
  area?: string | null;
  vision?: string | null;
  countermeasure?: string | null;
  effect?: string | null;
  order?: number;
  subProjectId?: string | null;
}

/**
 * TOBEビジョン更新ユースケース
 */
@Injectable()
export class UpdateTobeVisionUseCase {
  constructor(
    @Inject(TOBE_VISION_REPOSITORY)
    private readonly tobeVisionRepository: ITobeVisionRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: UpdateTobeVisionInput): Promise<TobeVisionOutput> {
    // 1. TOBEビジョン存在確認
    const tobeVision = await this.tobeVisionRepository.findById(input.id);
    if (!tobeVision) {
      throw new EntityNotFoundError('TobeVision', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(tobeVision.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', tobeVision.projectId);
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
    tobeVision.update({
      area: input.area,
      vision: input.vision,
      countermeasure: input.countermeasure,
      effect: input.effect,
      order: input.order,
      subProjectId: input.subProjectId,
    });

    // 5. 永続化
    await this.tobeVisionRepository.save(tobeVision);

    // 6. 出力返却
    return toTobeVisionOutput(tobeVision);
  }
}
