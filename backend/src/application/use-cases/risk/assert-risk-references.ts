import {
  EntityNotFoundError,
  IRiskCategoryRepository,
  IStakeholderRepository,
  IMeetingRepository,
} from '../../../domain';
import { PrismaService } from '../../../infrastructure/persistence/prisma/prisma.service';

/** リスクの参照ID検証に必要な依存（Create/Update 両ユースケースで共用）。 */
export interface RiskReferenceDeps {
  riskCategoryRepository: IRiskCategoryRepository;
  stakeholderRepository: IStakeholderRepository;
  meetingRepository: IMeetingRepository;
  /** SubProject はドメインリポジトリ未整備のため Prisma を直接参照する。 */
  prisma: PrismaService;
}

/** リスクが参照しうる他テーブルのID（いずれも任意・null可）。 */
export interface RiskReferenceIds {
  categoryId?: string | null;
  subProjectId?: string | null;
  ownerStakeholderId?: string | null;
  reviewMeetingId?: string | null;
}

/**
 * 指定された参照ID（カテゴリ・サブ領域・オーナー・レビュー会議）が
 * すべて当該プロジェクトに属することを検証する。
 *
 * FK は存在しか保証しないため、直接APIコールで他プロジェクト
 * （他組織を含む）のエンティティを紐付けられるのを防ぐ。
 * create-task.use-case.ts の assertIssueNodeInProject と同じ作法で、
 * 存在しない／プロジェクト不一致はいずれも EntityNotFoundError とする。
 */
export async function assertRiskReferencesInProject(
  deps: RiskReferenceDeps,
  projectId: string,
  refs: RiskReferenceIds,
): Promise<void> {
  if (refs.categoryId) {
    const category = await deps.riskCategoryRepository.findById(
      refs.categoryId,
    );
    if (!category || category.projectId !== projectId) {
      throw new EntityNotFoundError('RiskCategory', refs.categoryId);
    }
  }

  if (refs.subProjectId) {
    const subProject = await deps.prisma.subProject.findUnique({
      where: { id: refs.subProjectId },
      select: { projectId: true },
    });
    if (!subProject || subProject.projectId !== projectId) {
      throw new EntityNotFoundError('SubProject', refs.subProjectId);
    }
  }

  if (refs.ownerStakeholderId) {
    const stakeholder = await deps.stakeholderRepository.findById(
      refs.ownerStakeholderId,
    );
    if (!stakeholder || stakeholder.projectId !== projectId) {
      throw new EntityNotFoundError('Stakeholder', refs.ownerStakeholderId);
    }
  }

  if (refs.reviewMeetingId) {
    const meeting = await deps.meetingRepository.findById(refs.reviewMeetingId);
    if (!meeting || meeting.projectId !== projectId) {
      throw new EntityNotFoundError('Meeting', refs.reviewMeetingId);
    }
  }
}
