import { Inject, Injectable } from '@nestjs/common';
import {
  ITobeRoadmapRepository,
  TOBE_ROADMAP_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  TobeRoadmapOutput,
  toTobeRoadmapOutput,
} from './create-tobe-roadmap.use-case';

export interface UpdateTobeRoadmapInput {
  userId: string;
  id: string;
  phase?: string | null;
  measure?: string | null;
  roi?: string | null;
  cost?: string | null;
  payback?: string | null;
  scope?: string | null;
  order?: number;
  subProjectId?: string | null;
  tobeVisionId?: string | null;
}

/**
 * TOBEロードマップ更新ユースケース
 */
@Injectable()
export class UpdateTobeRoadmapUseCase {
  constructor(
    @Inject(TOBE_ROADMAP_REPOSITORY)
    private readonly tobeRoadmapRepository: ITobeRoadmapRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: UpdateTobeRoadmapInput): Promise<TobeRoadmapOutput> {
    // 1. TOBEロードマップ存在確認
    const tobeRoadmap = await this.tobeRoadmapRepository.findById(input.id);
    if (!tobeRoadmap) {
      throw new EntityNotFoundError('TobeRoadmap', input.id);
    }

    // 2. プロジェクト存在確認
    const project = await this.projectRepository.findById(
      tobeRoadmap.projectId,
    );
    if (!project) {
      throw new EntityNotFoundError('Project', tobeRoadmap.projectId);
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
    tobeRoadmap.update({
      phase: input.phase,
      measure: input.measure,
      roi: input.roi,
      cost: input.cost,
      payback: input.payback,
      scope: input.scope,
      order: input.order,
      subProjectId: input.subProjectId,
      tobeVisionId: input.tobeVisionId,
    });

    // 5. 永続化
    await this.tobeRoadmapRepository.save(tobeRoadmap);

    // 6. 出力返却
    return toTobeRoadmapOutput(tobeRoadmap);
  }
}
