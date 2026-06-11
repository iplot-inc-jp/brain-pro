import { Inject, Injectable } from '@nestjs/common';
import {
  RiskCategory,
  IRiskCategoryRepository,
  RISK_CATEGORY_REPOSITORY,
  ProjectRepository,
  PROJECT_REPOSITORY,
  OrganizationRepository,
  ORGANIZATION_REPOSITORY,
  EntityNotFoundError,
  ForbiddenError,
} from '../../../domain';
import {
  RiskCategoryOutput,
  toRiskCategoryOutput,
} from './risk-category.output';

export interface GetRiskCategoriesInput {
  userId: string;
  projectId: string;
}

/** 0件時に冪等シードする PMBOK RBS 初期カテゴリ（order 0..9）。 */
const DEFAULT_CATEGORIES: { name: string; order: number }[] = [
  { name: '技術', order: 0 },
  { name: '外部（市場・法規制・ベンダー）', order: 1 },
  { name: '組織（体制・リソース）', order: 2 },
  { name: 'プロジェクト管理', order: 3 },
  { name: 'スケジュール', order: 4 },
  { name: 'コスト', order: 5 },
  { name: '品質', order: 6 },
  { name: 'スコープ', order: 7 },
  { name: 'ステークホルダー', order: 8 },
  { name: 'セキュリティ', order: 9 },
];

/**
 * プロジェクトのリスクカテゴリ（RBS）一覧取得ユースケース
 * 0件の場合は PMBOK 標準の初期カテゴリをシードしてから返す。
 */
@Injectable()
export class GetRiskCategoriesUseCase {
  constructor(
    @Inject(RISK_CATEGORY_REPOSITORY)
    private readonly riskCategoryRepository: IRiskCategoryRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  async execute(input: GetRiskCategoriesInput): Promise<RiskCategoryOutput[]> {
    const project = await this.projectRepository.findById(input.projectId);
    if (!project) {
      throw new EntityNotFoundError('Project', input.projectId);
    }

    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      input.userId,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }

    let categories = await this.riskCategoryRepository.findByProjectId(
      input.projectId,
    );

    if (categories.length === 0) {
      // 初期カテゴリをシード。RiskCategory の @@unique([projectId, name]) と
      // skipDuplicates 付きの一括INSERTにより、同時リクエストが同じシードを
      // 走らせても重複行は作られない（衝突した行はスキップされる）。
      // 最後に再取得した結果を正とする。
      const defaults = DEFAULT_CATEGORIES.map((def) =>
        RiskCategory.create(
          {
            projectId: input.projectId,
            name: def.name,
            order: def.order,
          },
          this.riskCategoryRepository.generateId(),
        ),
      );
      await this.riskCategoryRepository.createManySkipDuplicates(defaults);
      categories = await this.riskCategoryRepository.findByProjectId(
        input.projectId,
      );
    }

    return categories.map((c) => toRiskCategoryOutput(c));
  }
}
