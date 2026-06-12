import { Inject, Injectable } from '@nestjs/common';
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
  KpiStatusValue,
} from '../../../domain';
import { authorizeProject } from './kpi-authz';
import { KpiOutput, toKpiOutput } from './kpi.output';

// ============================================================
// 共通: 参照（flow / system / ownerRole）のプロジェクト整合検証
// ============================================================

async function assertFlowInProject(
  repo: IKpiRepository,
  flowId: string,
  projectId: string,
): Promise<void> {
  const flow = await repo.findFlowRef(flowId);
  if (!flow) throw new EntityNotFoundError('BusinessFlow', flowId);
  if (flow.projectId !== projectId) {
    throw new ValidationError('指定された業務フローはこのプロジェクトに属していません');
  }
}

async function assertSystemInProject(
  repo: IKpiRepository,
  systemId: string,
  projectId: string,
): Promise<void> {
  const system = await repo.findSystemRef(systemId);
  if (!system) throw new EntityNotFoundError('System', systemId);
  if (system.projectId !== projectId) {
    throw new ValidationError('指定されたシステムはこのプロジェクトに属していません');
  }
}

async function assertRoleInProject(
  repo: IKpiRepository,
  roleId: string,
  projectId: string,
): Promise<void> {
  const role = await repo.findRoleRef(roleId);
  if (!role) throw new EntityNotFoundError('Role', roleId);
  if (role.projectId !== projectId) {
    throw new ValidationError('指定されたロールはこのプロジェクトに属していません');
  }
}

/**
 * 参照ID（flowId / systemId / ownerRoleId）の空文字を null に正規化する。
 * 空文字のまま書き込むと FK違反（P2003 → 500）になるため、未指定として扱う。
 * undefined は「変更なし」の意味を保つためそのまま返す。
 */
function normalizeRefId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value && value.trim().length > 0 ? value : null;
}

// ============================================================
// 一覧
// ============================================================

export interface ListKpisInput {
  userId: string;
  projectId: string;
  category?: KpiCategoryValue;
  flowId?: string;
  systemId?: string;
}

@Injectable()
export class ListKpisUseCase {
  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: ListKpisInput): Promise<KpiOutput[]> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.userId);
    const rows = await this.repo.findByProject(input.projectId, {
      category: input.category,
      flowId: input.flowId,
      systemId: input.systemId,
    });
    return rows.map(toKpiOutput);
  }
}

// ============================================================
// 作成
// ============================================================

export interface CreateKpiInput {
  userId: string;
  projectId: string;
  name: string;
  category?: KpiCategoryValue;
  flowId?: string | null;
  systemId?: string | null;
  description?: string | null;
  definition?: string | null;
  unit?: string | null;
  baselineValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  direction?: KpiDirectionValue;
  frequency?: KpiFrequencyValue;
  measurementMethod?: string | null;
  ownerRoleId?: string | null;
  smartSpecific?: number | null;
  smartMeasurable?: number | null;
  smartAchievable?: number | null;
  smartRelevant?: number | null;
  smartTimeBound?: number | null;
  smartComment?: string | null;
  status?: KpiStatusValue;
  order?: number;
}

@Injectable()
export class CreateKpiUseCase {
  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: CreateKpiInput): Promise<KpiOutput> {
    await authorizeProject(this.projectRepo, this.orgRepo, input.projectId, input.userId);

    // 空文字の参照IDは null（未指定）に正規化してから検証・保存する
    const flowId = normalizeRefId(input.flowId) ?? null;
    const systemId = normalizeRefId(input.systemId) ?? null;
    const ownerRoleId = normalizeRefId(input.ownerRoleId) ?? null;

    if (flowId) await assertFlowInProject(this.repo, flowId, input.projectId);
    if (systemId) await assertSystemInProject(this.repo, systemId, input.projectId);
    if (ownerRoleId) await assertRoleInProject(this.repo, ownerRoleId, input.projectId);

    const order = input.order ?? (await this.repo.nextOrder(input.projectId));
    const kpi = Kpi.create(
      {
        projectId: input.projectId,
        name: input.name,
        category: input.category,
        flowId,
        systemId,
        description: input.description ?? null,
        definition: input.definition ?? null,
        unit: input.unit ?? null,
        baselineValue: input.baselineValue ?? null,
        targetValue: input.targetValue ?? null,
        currentValue: input.currentValue ?? null,
        direction: input.direction,
        frequency: input.frequency,
        measurementMethod: input.measurementMethod ?? null,
        ownerRoleId,
        smartSpecific: input.smartSpecific ?? null,
        smartMeasurable: input.smartMeasurable ?? null,
        smartAchievable: input.smartAchievable ?? null,
        smartRelevant: input.smartRelevant ?? null,
        smartTimeBound: input.smartTimeBound ?? null,
        smartComment: input.smartComment ?? null,
        status: input.status,
        order,
      },
      this.repo.generateId(),
    );
    await this.repo.save(kpi);
    const row = await this.repo.findRowById(kpi.id);
    if (!row) throw new EntityNotFoundError('Kpi', kpi.id);
    return toKpiOutput(row);
  }
}

// ============================================================
// 更新（全編集可能フィールド）
// ============================================================

export interface UpdateKpiInput {
  userId: string;
  id: string;
  name?: string;
  category?: KpiCategoryValue;
  flowId?: string | null;
  systemId?: string | null;
  description?: string | null;
  definition?: string | null;
  unit?: string | null;
  baselineValue?: number | null;
  targetValue?: number | null;
  currentValue?: number | null;
  direction?: KpiDirectionValue;
  frequency?: KpiFrequencyValue;
  measurementMethod?: string | null;
  ownerRoleId?: string | null;
  smartSpecific?: number | null;
  smartMeasurable?: number | null;
  smartAchievable?: number | null;
  smartRelevant?: number | null;
  smartTimeBound?: number | null;
  smartComment?: string | null;
  status?: KpiStatusValue;
  order?: number;
}

@Injectable()
export class UpdateKpiUseCase {
  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: UpdateKpiInput): Promise<KpiOutput> {
    const kpi = await this.repo.findById(input.id);
    if (!kpi) throw new EntityNotFoundError('Kpi', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, kpi.projectId, input.userId);

    // 空文字の参照IDは null（解除）に正規化。undefined は「変更なし」のまま
    const flowId = normalizeRefId(input.flowId);
    const systemId = normalizeRefId(input.systemId);
    const ownerRoleId = normalizeRefId(input.ownerRoleId);

    if (flowId) await assertFlowInProject(this.repo, flowId, kpi.projectId);
    if (systemId) await assertSystemInProject(this.repo, systemId, kpi.projectId);
    if (ownerRoleId) await assertRoleInProject(this.repo, ownerRoleId, kpi.projectId);

    if (input.name !== undefined) kpi.updateName(input.name);
    if (input.category !== undefined) kpi.updateCategory(input.category);
    if (flowId !== undefined) kpi.updateFlowId(flowId);
    if (systemId !== undefined) kpi.updateSystemId(systemId);
    if (input.description !== undefined) kpi.updateDescription(input.description);
    if (input.definition !== undefined) kpi.updateDefinition(input.definition);
    if (input.unit !== undefined) kpi.updateUnit(input.unit);
    if (input.baselineValue !== undefined) kpi.updateBaselineValue(input.baselineValue);
    if (input.targetValue !== undefined) kpi.updateTargetValue(input.targetValue);
    if (input.currentValue !== undefined) kpi.updateCurrentValue(input.currentValue);
    if (input.direction !== undefined) kpi.updateDirection(input.direction);
    if (input.frequency !== undefined) kpi.updateFrequency(input.frequency);
    if (input.measurementMethod !== undefined) kpi.updateMeasurementMethod(input.measurementMethod);
    if (ownerRoleId !== undefined) kpi.updateOwnerRoleId(ownerRoleId);
    if (
      input.smartSpecific !== undefined ||
      input.smartMeasurable !== undefined ||
      input.smartAchievable !== undefined ||
      input.smartRelevant !== undefined ||
      input.smartTimeBound !== undefined
    ) {
      kpi.updateSmartScores({
        smartSpecific: input.smartSpecific,
        smartMeasurable: input.smartMeasurable,
        smartAchievable: input.smartAchievable,
        smartRelevant: input.smartRelevant,
        smartTimeBound: input.smartTimeBound,
      });
    }
    if (input.smartComment !== undefined) kpi.updateSmartComment(input.smartComment);
    if (input.status !== undefined) kpi.updateStatus(input.status);
    if (input.order !== undefined) kpi.updateOrder(input.order);

    await this.repo.save(kpi);
    const row = await this.repo.findRowById(kpi.id);
    if (!row) throw new EntityNotFoundError('Kpi', kpi.id);
    return toKpiOutput(row);
  }
}

// ============================================================
// 削除
// ============================================================

export interface DeleteKpiInput {
  userId: string;
  id: string;
}

@Injectable()
export class DeleteKpiUseCase {
  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: DeleteKpiInput): Promise<void> {
    const kpi = await this.repo.findById(input.id);
    if (!kpi) throw new EntityNotFoundError('Kpi', input.id);
    await authorizeProject(this.projectRepo, this.orgRepo, kpi.projectId, input.userId);
    await this.repo.delete(input.id);
  }
}

// ============================================================
// 測定対象の情報種別を全置換
// ============================================================

export interface SetKpiInformationTypesInput {
  userId: string;
  kpiId: string;
  informationTypeIds: string[];
}

@Injectable()
export class SetKpiInformationTypesUseCase {
  constructor(
    @Inject(KPI_REPOSITORY) private readonly repo: IKpiRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  async execute(input: SetKpiInformationTypesInput): Promise<KpiOutput> {
    const kpi = await this.repo.findById(input.kpiId);
    if (!kpi) throw new EntityNotFoundError('Kpi', input.kpiId);
    await authorizeProject(this.projectRepo, this.orgRepo, kpi.projectId, input.userId);

    // 同一プロジェクト検証（存在しないID / 他プロジェクトの情報種別は拒否）
    const uniqueIds = Array.from(new Set(input.informationTypeIds));
    if (uniqueIds.length > 0) {
      const infoTypes = await this.repo.findInformationTypes(uniqueIds);
      const foundIds = new Set(infoTypes.map((t) => t.id));
      const missing = uniqueIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new EntityNotFoundError('InformationType', missing[0]);
      }
      const foreign = infoTypes.filter((t) => t.projectId !== kpi.projectId);
      if (foreign.length > 0) {
        throw new ValidationError('指定された情報種別はこのプロジェクトに属していません');
      }
    }

    await this.repo.setInformationTypes(kpi.id, uniqueIds);
    const row = await this.repo.findRowById(kpi.id);
    if (!row) throw new EntityNotFoundError('Kpi', kpi.id);
    return toKpiOutput(row);
  }
}
