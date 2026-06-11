import { Inject, Injectable } from '@nestjs/common';
import {
  TobeRoadmap,
  ITobeRoadmapRepository,
  TOBE_ROADMAP_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';

export interface CreateTobeRoadmapInput {
  userId: string;
  projectId: string;
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

export interface TobeRoadmapOutput {
  id: string;
  projectId: string;
  phase: string | null;
  measure: string | null;
  roi: string | null;
  cost: string | null;
  payback: string | null;
  scope: string | null;
  order: number;
  subProjectId: string | null;
  tobeVisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toTobeRoadmapOutput(
  tobeRoadmap: TobeRoadmap,
): TobeRoadmapOutput {
  return {
    id: tobeRoadmap.id,
    projectId: tobeRoadmap.projectId,
    phase: tobeRoadmap.phase,
    measure: tobeRoadmap.measure,
    roi: tobeRoadmap.roi,
    cost: tobeRoadmap.cost,
    payback: tobeRoadmap.payback,
    scope: tobeRoadmap.scope,
    order: tobeRoadmap.order,
    subProjectId: tobeRoadmap.subProjectId,
    tobeVisionId: tobeRoadmap.tobeVisionId,
    createdAt: tobeRoadmap.createdAt,
    updatedAt: tobeRoadmap.updatedAt,
  };
}

/**
 * TOBEロードマップ作成ユースケース
 */
@Injectable()
export class CreateTobeRoadmapUseCase {
  constructor(
    @Inject(TOBE_ROADMAP_REPOSITORY)
    private readonly tobeRoadmapRepository: ITobeRoadmapRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: CreateTobeRoadmapInput): Promise<TobeRoadmapOutput> {
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
    const id = this.tobeRoadmapRepository.generateId();

    // 4. エンティティ生成
    const tobeRoadmap = TobeRoadmap.create(
      {
        projectId: input.projectId,
        phase: input.phase,
        measure: input.measure,
        roi: input.roi,
        cost: input.cost,
        payback: input.payback,
        scope: input.scope,
        order: input.order,
        subProjectId: input.subProjectId,
        tobeVisionId: input.tobeVisionId,
      },
      id,
    );

    // 5. 永続化
    await this.tobeRoadmapRepository.save(tobeRoadmap);

    // 6. 出力返却
    return toTobeRoadmapOutput(tobeRoadmap);
  }
}
