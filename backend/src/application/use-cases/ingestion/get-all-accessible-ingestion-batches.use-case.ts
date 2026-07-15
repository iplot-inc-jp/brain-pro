import { Inject, Injectable } from '@nestjs/common';
import {
  OrganizationRepository, ORGANIZATION_REPOSITORY,
  ProjectRepository, PROJECT_REPOSITORY,
  IIngestionBatchRepository, INGESTION_BATCH_REPOSITORY,
  ForbiddenError,
} from '../../../domain';
import { ProjectAccessService } from '../../../infrastructure/services/project-access.service';
import {
  IngestionBatchWithProjectOutput,
  toIngestionBatchWithProjectOutput,
} from './ingestion-output';

const MAX_BATCHES = 200;

export interface GetAllAccessibleIngestionBatchesInput {
  userId: string;
  /** API キー認証時のみ非 null。横断一覧は対話的ブラウザ専用なので拒否する。 */
  apiKeyId?: string;
  /**
   * 会社スコープ（管理者発行の user-api トークン）。あれば候補を scopeOrgId の会社に閉じ込める。
   * null/undefined=全社追従（従来どおり）。
   */
  scopeOrgId?: string | null;
}

@Injectable()
export class GetAllAccessibleIngestionBatchesUseCase {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepo: ProjectRepository,
    @Inject(INGESTION_BATCH_REPOSITORY)
    private readonly batchRepo: IIngestionBatchRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async execute(
    input: GetAllAccessibleIngestionBatchesInput,
  ): Promise<IngestionBatchWithProjectOutput[]> {
    // プロジェクト単位 API キーに横断集約を返すと鍵のスコープ閉じ込めを破るため拒否。
    // （プレゼンス用トークン発行と同じく「本人スコープ」系は対話的ブラウザ専用）。
    if (input.apiKeyId) {
      throw new ForbiddenError('API キーでは横断一覧を利用できません');
    }
    const allOrgs = await this.orgRepo.findByUserId(input.userId);
    // 会社スコープトークンは候補会社を scopeOrgId に閉じ込める（越境した他社プロジェクトを集約しない）。
    const orgs = input.scopeOrgId
      ? allOrgs.filter((o) => o.id === input.scopeOrgId)
      : allOrgs;
    const projectLists = await Promise.all(
      orgs.map((o) => this.projectRepo.findByOrganizationId(o.id)),
    );
    const projectById = new Map<string, { id: string; name: string }>();
    for (const list of projectLists) {
      for (const p of list) projectById.set(p.id, { id: p.id, name: p.name });
    }
    const candidates = Array.from(projectById.values());

    const levels = await Promise.all(
      candidates.map((p) => this.projectAccess.resolveProjectAccess(p.id, input.userId)),
    );
    const accessible = candidates.filter((_, i) => levels[i] !== null);

    const perProject = await Promise.all(
      accessible.map(async (p) => {
        const batches = await this.batchRepo.findByProjectId(p.id);
        return batches.map((b) => toIngestionBatchWithProjectOutput(b, p.name));
      }),
    );

    const all = perProject.flat();
    all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return all.slice(0, MAX_BATCHES);
  }
}
