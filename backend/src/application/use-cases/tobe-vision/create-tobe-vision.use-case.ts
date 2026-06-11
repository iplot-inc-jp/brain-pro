import { Inject, Injectable } from '@nestjs/common';
import {
  TobeVision,
  ITobeVisionRepository,
  TOBE_VISION_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';

export interface CreateTobeVisionInput {
  userId: string;
  projectId: string;
  area?: string | null;
  vision?: string | null;
  countermeasure?: string | null;
  effect?: string | null;
  order?: number;
  subProjectId?: string | null;
}

export interface TobeVisionOutput {
  id: string;
  projectId: string;
  area: string | null;
  vision: string | null;
  countermeasure: string | null;
  effect: string | null;
  order: number;
  subProjectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toTobeVisionOutput(tobeVision: TobeVision): TobeVisionOutput {
  return {
    id: tobeVision.id,
    projectId: tobeVision.projectId,
    area: tobeVision.area,
    vision: tobeVision.vision,
    countermeasure: tobeVision.countermeasure,
    effect: tobeVision.effect,
    order: tobeVision.order,
    subProjectId: tobeVision.subProjectId,
    createdAt: tobeVision.createdAt,
    updatedAt: tobeVision.updatedAt,
  };
}

/**
 * TOBEビジョン作成ユースケース
 */
@Injectable()
export class CreateTobeVisionUseCase {
  constructor(
    @Inject(TOBE_VISION_REPOSITORY)
    private readonly tobeVisionRepository: ITobeVisionRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateTobeVisionInput): Promise<TobeVisionOutput> {
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
    const id = this.tobeVisionRepository.generateId();

    // 4. エンティティ生成
    const tobeVision = TobeVision.create(
      {
        projectId: input.projectId,
        area: input.area,
        vision: input.vision,
        countermeasure: input.countermeasure,
        effect: input.effect,
        order: input.order,
        subProjectId: input.subProjectId,
      },
      id,
    );

    // 5. 永続化
    await this.tobeVisionRepository.save(tobeVision);

    // 6. 出力返却
    return toTobeVisionOutput(tobeVision);
  }
}
