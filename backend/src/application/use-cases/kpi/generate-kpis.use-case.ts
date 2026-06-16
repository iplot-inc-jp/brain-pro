import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  KPI_REPOSITORY,
  IKpiRepository,
  PROJECT_REPOSITORY,
  ProjectRepository,
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  EntityNotFoundError,
  ValidationError,
  Kpi,
  KpiCategoryValue,
  KpiDirectionValue,
  KpiFrequencyValue,
  KPI_DIRECTIONS,
  KPI_FREQUENCIES,
} from '../../../domain';
import {
  ClaudeService,
  GeneratedKpiItem,
} from '../../../infrastructure/services/claude.service';
import { CompanyKeyService } from '../../../infrastructure/services/company-key.service';
import { authorizeProject } from './kpi-authz';
import { KpiOutput, toKpiOutput } from './kpi.output';

export interface GenerateKpisInput {
  userId: string;
  projectId: string;
  category: KpiCategoryValue;
  flowId?: string | null;
  systemId?: string | null;
  informationTypeIds: string[];
  instructions?: string | null;
  /** 生成件数（既定 5） */
  count?: number;
}

/** 情報種別 category → プロンプト用日本語ラベル */
const INFO_CATEGORY_LABELS: Record<string, string> = {
  INFORMATION: '情報・データ',
  OBJECT: '物体',
  DOCUMENT: '帳票',
};

function sanitizeDirection(value: string | null | undefined): KpiDirectionValue {
  const v = (value ?? '').toUpperCase();
  return (KPI_DIRECTIONS as readonly string[]).includes(v)
    ? (v as KpiDirectionValue)
    : 'INCREASE';
}

function sanitizeFrequency(value: string | null | undefined): KpiFrequencyValue {
  const v = (value ?? '').toUpperCase();
  return (KPI_FREQUENCIES as readonly string[]).includes(v)
    ? (v as KpiFrequencyValue)
    : 'MONTHLY';
}

/** SMART採点を 0〜5 の整数に丸める（数値でなければ null） */
function sanitizeSmartScore(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function sanitizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sanitizeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 生成AIでKPI候補を生成し、status=DRAFT・aiGenerated=true で保存する。
 * - BUSINESS: 対象業務フローの改善を測る業務KPI
 * - AI_QUALITY: 対象システム（AI）自体の品質・精度を測るKPI
 * 応答の解析に失敗した場合は1回リトライし、それでも失敗なら ValidationError。
 */
@Injectable()
export class GenerateKpisUseCase {
  private readonly logger = new Logger(GenerateKpisUseCase.name);

  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly claudeService: ClaudeService,
    private readonly companyKeyService: CompanyKeyService,
  ) {}

  async execute(input: GenerateKpisInput): Promise<KpiOutput[]> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.userId);

    const count = Math.max(1, Math.min(20, Math.trunc(input.count ?? 5)));

    // 空文字の参照IDは null に正規化（FK違反による500を防ぐ）
    const flowId = input.flowId || null;
    const systemId = input.systemId || null;

    // 対象フロー / システムの解決（プロジェクト整合検証込み）
    let flowName: string | null = null;
    let flowKind: string | null = null;
    if (flowId) {
      const flow = await this.repo.findFlowRef(flowId);
      if (!flow) throw new EntityNotFoundError('BusinessFlow', flowId);
      if (flow.projectId !== input.projectId) {
        throw new ValidationError('指定された業務フローはこのプロジェクトに属していません');
      }
      flowName = flow.name;
      flowKind = flow.kind;
    }

    let systemName: string | null = null;
    if (systemId) {
      const system = await this.repo.findSystemRef(systemId);
      if (!system) throw new EntityNotFoundError('System', systemId);
      if (system.projectId !== input.projectId) {
        throw new ValidationError('指定されたシステムはこのプロジェクトに属していません');
      }
      systemName = system.name;
    }

    // 測定対象の情報種別の解決（同一プロジェクト検証）
    const uniqueInfoIds = Array.from(new Set(input.informationTypeIds ?? []));
    const infoTypes = await this.repo.findInformationTypes(uniqueInfoIds);
    const foundIds = new Set(infoTypes.map((t) => t.id));
    const missing = uniqueInfoIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new EntityNotFoundError('InformationType', missing[0]);
    }
    if (infoTypes.some((t) => t.projectId !== input.projectId)) {
      throw new ValidationError('指定された情報種別はこのプロジェクトに属していません');
    }

    // APIキー解決（会社 > 個人設定 > 環境変数）
    const apiKey = await this.companyKeyService.resolveForProject(
      input.projectId,
      input.userId,
    );
    if (!apiKey) {
      throw new ValidationError('AI鍵未設定');
    }

    const context = {
      category: input.category,
      flowName,
      flowKind,
      systemName,
      informationTypes: infoTypes.map((t) => ({
        name: t.name,
        categoryLabel: INFO_CATEGORY_LABELS[t.category] ?? t.category,
      })),
      instructions: input.instructions ?? null,
      count,
    };

    // 解析失敗時は1リトライ、それでも失敗なら ValidationError
    const usageCtx = {
      projectId: input.projectId,
      area: 'KPI' as const,
      userId: input.userId,
    };
    let items: GeneratedKpiItem[];
    try {
      items = await this.claudeService.generateKpis(context, apiKey, usageCtx);
    } catch (firstError) {
      this.logger.warn(
        `KPI生成の1回目が失敗。リトライします: ${(firstError as Error).message}`,
      );
      try {
        items = await this.claudeService.generateKpis(context, apiKey, usageCtx);
      } catch {
        throw new ValidationError('AI応答の解析に失敗しました');
      }
    }

    const validItems = (Array.isArray(items) ? items : []).filter(
      (item) => typeof item?.name === 'string' && item.name.trim().length > 0,
    );
    if (validItems.length === 0) {
      throw new ValidationError('AI応答の解析に失敗しました');
    }

    // status=DRAFT・aiGenerated=true で保存し、情報種別を紐づける
    const baseOrder = await this.repo.nextOrder(input.projectId);
    const infoTypeRefs = infoTypes.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
    }));

    const kpis = validItems.map((item, i) =>
      Kpi.create(
        {
          projectId: input.projectId,
          name: item.name,
          category: input.category,
          flowId,
          systemId,
          description: sanitizeText(item.description),
          definition: sanitizeText(item.definition),
          unit: sanitizeText(item.unit),
          baselineValue: sanitizeNumber(item.baselineValue),
          targetValue: sanitizeNumber(item.targetValue),
          currentValue: null,
          direction: sanitizeDirection(item.direction),
          frequency: sanitizeFrequency(item.frequency),
          measurementMethod: sanitizeText(item.measurementMethod),
          smartSpecific: sanitizeSmartScore(item.smartSpecific),
          smartMeasurable: sanitizeSmartScore(item.smartMeasurable),
          smartAchievable: sanitizeSmartScore(item.smartAchievable),
          smartRelevant: sanitizeSmartScore(item.smartRelevant),
          smartTimeBound: sanitizeSmartScore(item.smartTimeBound),
          smartComment: sanitizeText(item.smartComment),
          aiGenerated: true,
          status: 'DRAFT',
          order: baseOrder + i,
        },
        this.repo.generateId(),
      ),
    );

    // KPI群＋情報種別リンクを単一トランザクションで保存（部分コミットを残さない）
    await this.repo.createManyWithLinks(kpis, uniqueInfoIds);

    return kpis.map((kpi) =>
      toKpiOutput({
        kpi,
        informationTypes: infoTypeRefs,
        flowName,
        asisFlowName: null,
        tobeFlowName: null,
        systemName,
        ownerRoleName: null,
      }),
    );
  }
}
