import { Inject, Injectable } from '@nestjs/common';
import {
  KPI_REPOSITORY,
  IKpiRepository,
  PROJECT_REPOSITORY,
  ProjectRepository,
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  EntityNotFoundError,
} from '../../../domain';
import { InfoTypeDetail } from '../../../domain/repositories/kpi.repository';
import { authorizeProject } from './kpi-authz';
import { IoSummaryItemOutput, IoSummarySourceOutput } from './kpi.output';

export interface GetFlowIoSummaryInput {
  userId: string;
  flowId: string;
}

/**
 * フロー上の NodeInformationLink（direction込み）と FlowEdge.informationTypeId から
 * 重複排除した情報種別一覧（出現元 sources 付き）を返す。
 * KPI生成時の「測定対象の情報種別」候補リストの素材。
 */
@Injectable()
export class GetFlowIoSummaryUseCase {
  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: GetFlowIoSummaryInput): Promise<IoSummaryItemOutput[]> {
    const flow = await this.repo.findFlowRef(input.flowId);
    if (!flow) throw new EntityNotFoundError('BusinessFlow', input.flowId);
    await authorizeProject(this.projectRepo, this.orgRepo, flow.projectId, input.userId);

    const [nodeLinks, edges] = await Promise.all([
      this.repo.findFlowIoNodeLinks(input.flowId),
      this.repo.findFlowIoEdges(input.flowId),
    ]);

    // 情報種別ID単位で重複排除し、出現元（sources）を蓄積する
    const byId = new Map<string, IoSummaryItemOutput>();
    const upsert = (it: InfoTypeDetail): IoSummaryItemOutput => {
      let item = byId.get(it.id);
      if (!item) {
        item = {
          id: it.id,
          name: it.name,
          category: it.category,
          description: it.description,
          sources: [],
        };
        byId.set(it.id, item);
      }
      return item;
    };

    for (const link of nodeLinks) {
      const item = upsert(link.informationType);
      const source: IoSummarySourceOutput = {
        kind: 'node',
        label: link.nodeLabel,
        direction: link.direction,
      };
      // 同一ノード×同一方向の重複は除く
      if (
        !item.sources.some(
          (s) => s.kind === 'node' && s.label === source.label && s.direction === source.direction,
        )
      ) {
        item.sources.push(source);
      }
    }

    for (const edge of edges) {
      const item = upsert(edge.informationType);
      const label =
        edge.edgeLabel && edge.edgeLabel.trim().length > 0
          ? edge.edgeLabel
          : `${edge.sourceNodeLabel}→${edge.targetNodeLabel}`;
      if (!item.sources.some((s) => s.kind === 'edge' && s.label === label)) {
        item.sources.push({ kind: 'edge', label });
      }
    }

    return Array.from(byId.values());
  }
}
