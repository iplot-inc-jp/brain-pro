import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  IKpiRepository,
  KpiListRow,
  KpiListFilter,
  ProjectScopedRef,
  FlowRef,
  InfoTypeDetail,
  FlowIoNodeLinkRow,
  FlowIoEdgeRow,
} from '../../../domain/repositories/kpi.repository';
import {
  Kpi,
  KpiCategoryValue,
  KpiDirectionValue,
  KpiFrequencyValue,
  KpiStatusValue,
} from '../../../domain/entities/kpi.entity';

interface KpiRecord {
  id: string;
  projectId: string;
  category: string;
  flowId: string | null;
  asisFlowId: string | null;
  tobeFlowId: string | null;
  systemId: string | null;
  name: string;
  description: string | null;
  definition: string | null;
  unit: string | null;
  baselineValue: number | null;
  targetValue: number | null;
  currentValue: number | null;
  direction: string;
  frequency: string;
  measurementMethod: string | null;
  ownerRoleId: string | null;
  smartSpecific: number | null;
  smartMeasurable: number | null;
  smartAchievable: number | null;
  smartRelevant: number | null;
  smartTimeBound: number | null;
  smartComment: string | null;
  aiGenerated: boolean;
  status: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

/** KPI一覧/単体で共通に使う include（情報種別＋フロー/システム/ロール名） */
const KPI_ROW_INCLUDE = {
  informationLinks: {
    include: {
      informationType: { select: { id: true, name: true, category: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  flow: { select: { name: true } },
  asisFlow: { select: { name: true } },
  tobeFlow: { select: { name: true } },
  system: { select: { name: true } },
  ownerRole: { select: { name: true } },
};

type KpiRowRecord = KpiRecord & {
  informationLinks: Array<{
    informationType: { id: string; name: string; category: string };
  }>;
  flow: { name: string } | null;
  asisFlow: { name: string } | null;
  tobeFlow: { name: string } | null;
  system: { name: string } | null;
  ownerRole: { name: string } | null;
};

@Injectable()
export class KpiRepositoryImpl implements IKpiRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toEntity(r: KpiRecord): Kpi {
    return Kpi.reconstruct({
      id: r.id,
      projectId: r.projectId,
      category: r.category as KpiCategoryValue,
      flowId: r.flowId,
      asisFlowId: r.asisFlowId,
      tobeFlowId: r.tobeFlowId,
      systemId: r.systemId,
      name: r.name,
      description: r.description,
      definition: r.definition,
      unit: r.unit,
      baselineValue: r.baselineValue,
      targetValue: r.targetValue,
      currentValue: r.currentValue,
      direction: r.direction as KpiDirectionValue,
      frequency: r.frequency as KpiFrequencyValue,
      measurementMethod: r.measurementMethod,
      ownerRoleId: r.ownerRoleId,
      smartSpecific: r.smartSpecific,
      smartMeasurable: r.smartMeasurable,
      smartAchievable: r.smartAchievable,
      smartRelevant: r.smartRelevant,
      smartTimeBound: r.smartTimeBound,
      smartComment: r.smartComment,
      aiGenerated: r.aiGenerated,
      status: r.status as KpiStatusValue,
      order: r.order,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  private toRow(r: KpiRowRecord): KpiListRow {
    return {
      kpi: this.toEntity(r),
      informationTypes: r.informationLinks.map((l) => ({
        id: l.informationType.id,
        name: l.informationType.name,
        category: l.informationType.category,
      })),
      flowName: r.flow?.name ?? null,
      asisFlowName: r.asisFlow?.name ?? null,
      tobeFlowName: r.tobeFlow?.name ?? null,
      systemName: r.system?.name ?? null,
      ownerRoleName: r.ownerRole?.name ?? null,
    };
  }

  async findByProject(projectId: string, filter?: KpiListFilter): Promise<KpiListRow[]> {
    const rows = await this.prisma.kpi.findMany({
      where: {
        projectId,
        ...(filter?.category ? { category: filter.category } : {}),
        ...(filter?.flowId ? { flowId: filter.flowId } : {}),
        ...(filter?.systemId ? { systemId: filter.systemId } : {}),
      },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: KPI_ROW_INCLUDE,
    });
    return rows.map((r) => this.toRow(r));
  }

  async findById(id: string): Promise<Kpi | null> {
    const r = await this.prisma.kpi.findUnique({ where: { id } });
    return r ? this.toEntity(r) : null;
  }

  async findRowById(id: string): Promise<KpiListRow | null> {
    const r = await this.prisma.kpi.findUnique({
      where: { id },
      include: KPI_ROW_INCLUDE,
    });
    return r ? this.toRow(r) : null;
  }

  async nextOrder(projectId: string): Promise<number> {
    const agg = await this.prisma.kpi.aggregate({
      where: { projectId },
      _max: { order: true },
    });
    return agg._max.order === null ? 0 : agg._max.order + 1;
  }

  /** エンティティ → Prisma カラム（id を除く） */
  private toData(kpi: Kpi) {
    return {
      projectId: kpi.projectId,
      category: kpi.category,
      flowId: kpi.flowId,
      asisFlowId: kpi.asisFlowId,
      tobeFlowId: kpi.tobeFlowId,
      systemId: kpi.systemId,
      name: kpi.name,
      description: kpi.description,
      definition: kpi.definition,
      unit: kpi.unit,
      baselineValue: kpi.baselineValue,
      targetValue: kpi.targetValue,
      currentValue: kpi.currentValue,
      direction: kpi.direction,
      frequency: kpi.frequency,
      measurementMethod: kpi.measurementMethod,
      ownerRoleId: kpi.ownerRoleId,
      smartSpecific: kpi.smartSpecific,
      smartMeasurable: kpi.smartMeasurable,
      smartAchievable: kpi.smartAchievable,
      smartRelevant: kpi.smartRelevant,
      smartTimeBound: kpi.smartTimeBound,
      smartComment: kpi.smartComment,
      aiGenerated: kpi.aiGenerated,
      status: kpi.status,
      order: kpi.order,
    };
  }

  async save(kpi: Kpi): Promise<void> {
    const data = this.toData(kpi);
    await this.prisma.kpi.upsert({
      where: { id: kpi.id },
      create: { id: kpi.id, ...data },
      update: data,
    });
  }

  async createManyWithLinks(kpis: Kpi[], informationTypeIds: string[]): Promise<void> {
    if (kpis.length === 0) return;
    const uniqueInfoIds = Array.from(new Set(informationTypeIds));
    // KPI群＋情報種別リンクを単一トランザクションで作成（部分コミットを残さない）
    await this.prisma.$transaction([
      this.prisma.kpi.createMany({
        data: kpis.map((kpi) => ({ id: kpi.id, ...this.toData(kpi) })),
      }),
      ...(uniqueInfoIds.length > 0
        ? [
            this.prisma.kpiInformationLink.createMany({
              data: kpis.flatMap((kpi) =>
                uniqueInfoIds.map((informationTypeId) => ({
                  kpiId: kpi.id,
                  informationTypeId,
                })),
              ),
            }),
          ]
        : []),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.kpi.delete({ where: { id } });
  }

  async setInformationTypes(kpiId: string, informationTypeIds: string[]): Promise<void> {
    // 全置換（重複IDは除去）
    const uniqueIds = Array.from(new Set(informationTypeIds));
    await this.prisma.$transaction([
      this.prisma.kpiInformationLink.deleteMany({ where: { kpiId } }),
      ...(uniqueIds.length > 0
        ? [
            this.prisma.kpiInformationLink.createMany({
              data: uniqueIds.map((informationTypeId) => ({ kpiId, informationTypeId })),
            }),
          ]
        : []),
    ]);
  }

  async findInformationTypes(ids: string[]): Promise<InfoTypeDetail[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.informationType.findMany({
      where: { id: { in: ids } },
      select: { id: true, projectId: true, name: true, category: true, description: true },
    });
    return rows;
  }

  async findFlowRef(flowId: string): Promise<FlowRef | null> {
    const r = await this.prisma.businessFlow.findUnique({
      where: { id: flowId },
      select: { id: true, projectId: true, name: true, kind: true },
    });
    return r;
  }

  async findSystemRef(systemId: string): Promise<ProjectScopedRef | null> {
    const r = await this.prisma.system.findUnique({
      where: { id: systemId },
      select: { id: true, projectId: true, name: true },
    });
    return r;
  }

  async findRoleRef(roleId: string): Promise<ProjectScopedRef | null> {
    const r = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, projectId: true, name: true },
    });
    return r;
  }

  async findFlowIoNodeLinks(flowId: string): Promise<FlowIoNodeLinkRow[]> {
    const links = await this.prisma.nodeInformationLink.findMany({
      where: { node: { flowId } },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        direction: true,
        node: { select: { label: true } },
        informationType: {
          select: { id: true, projectId: true, name: true, category: true, description: true },
        },
      },
    });
    return links.map((l) => ({
      informationType: l.informationType,
      nodeLabel: l.node.label,
      direction: l.direction,
    }));
  }

  async findFlowIoEdges(flowId: string): Promise<FlowIoEdgeRow[]> {
    const edges = await this.prisma.flowEdge.findMany({
      where: { flowId, informationTypeId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        label: true,
        sourceNode: { select: { label: true } },
        targetNode: { select: { label: true } },
        informationType: {
          select: { id: true, projectId: true, name: true, category: true, description: true },
        },
      },
    });
    return edges
      .filter((e) => e.informationType !== null)
      .map((e) => ({
        informationType: e.informationType!,
        edgeLabel: e.label,
        sourceNodeLabel: e.sourceNode.label,
        targetNodeLabel: e.targetNode.label,
      }));
  }

  generateId(): string {
    return randomUUID();
  }
}
