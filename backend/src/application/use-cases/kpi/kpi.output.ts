import {
  KpiCategoryValue,
  KpiDirectionValue,
  KpiFrequencyValue,
  KpiStatusValue,
} from '../../../domain/entities/kpi.entity';
import { KpiListRow } from '../../../domain/repositories/kpi.repository';

/** KPIに紐づく情報種別（測定対象のINPUT/OUTPUT） */
export interface KpiInformationTypeOutput {
  id: string;
  name: string;
  /** INFORMATION（情報）/ OBJECT（物体）/ DOCUMENT（帳票） */
  category: string;
}

export interface KpiOutput {
  id: string;
  projectId: string;
  category: KpiCategoryValue;
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
  direction: KpiDirectionValue;
  frequency: KpiFrequencyValue;
  measurementMethod: string | null;
  ownerRoleId: string | null;
  smartSpecific: number | null;
  smartMeasurable: number | null;
  smartAchievable: number | null;
  smartRelevant: number | null;
  smartTimeBound: number | null;
  smartComment: string | null;
  aiGenerated: boolean;
  status: KpiStatusValue;
  order: number;
  /** 測定対象の情報種別 */
  informationTypes: KpiInformationTypeOutput[];
  /** 対象業務フロー名（解決済み。生成の元フロー用・後方互換） */
  flowName: string | null;
  /** ASIS業務フロー名（解決済み） */
  asisFlowName: string | null;
  /** TOBE業務フロー名（解決済み） */
  tobeFlowName: string | null;
  /** 対象システム名（解決済み） */
  systemName: string | null;
  /** 責任者ロール名（解決済み） */
  ownerRoleName: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toKpiOutput(row: KpiListRow): KpiOutput {
  const k = row.kpi;
  return {
    id: k.id,
    projectId: k.projectId,
    category: k.category,
    flowId: k.flowId,
    asisFlowId: k.asisFlowId,
    tobeFlowId: k.tobeFlowId,
    systemId: k.systemId,
    name: k.name,
    description: k.description,
    definition: k.definition,
    unit: k.unit,
    baselineValue: k.baselineValue,
    targetValue: k.targetValue,
    currentValue: k.currentValue,
    direction: k.direction,
    frequency: k.frequency,
    measurementMethod: k.measurementMethod,
    ownerRoleId: k.ownerRoleId,
    smartSpecific: k.smartSpecific,
    smartMeasurable: k.smartMeasurable,
    smartAchievable: k.smartAchievable,
    smartRelevant: k.smartRelevant,
    smartTimeBound: k.smartTimeBound,
    smartComment: k.smartComment,
    aiGenerated: k.aiGenerated,
    status: k.status,
    order: k.order,
    informationTypes: row.informationTypes,
    flowName: row.flowName,
    asisFlowName: row.asisFlowName,
    tobeFlowName: row.tobeFlowName,
    systemName: row.systemName,
    ownerRoleName: row.ownerRoleName,
    createdAt: k.createdAt.toISOString(),
    updatedAt: k.updatedAt.toISOString(),
  };
}

/** フローIOサマリ：1情報種別の出現元（ノードの入出力 or 矢印上のデータ） */
export interface IoSummarySourceOutput {
  kind: 'node' | 'edge';
  /** ノードならノードのラベル、矢印なら「矢印ラベル」または「始点→終点」 */
  label: string;
  /** ノードの場合のみ（INPUT | OUTPUT） */
  direction?: 'INPUT' | 'OUTPUT';
}

/** フローIOサマリ：重複排除済みの情報種別1件 */
export interface IoSummaryItemOutput {
  id: string;
  name: string;
  category: string;
  description: string | null;
  sources: IoSummarySourceOutput[];
}
