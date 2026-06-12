import { Kpi, KpiCategoryValue } from '../entities/kpi.entity';

export const KPI_REPOSITORY = Symbol('KPI_REPOSITORY');

/** KPIに紐づく情報種別の参照（一覧表示用） */
export interface KpiInfoTypeRef {
  id: string;
  name: string;
  category: string;
}

/** KPI一覧の行（紐づく情報種別＋フロー名/システム名/責任者ロール名を解決済み） */
export interface KpiListRow {
  kpi: Kpi;
  informationTypes: KpiInfoTypeRef[];
  flowName: string | null;
  systemName: string | null;
  ownerRoleName: string | null;
}

/** KPI一覧の任意フィルタ */
export interface KpiListFilter {
  category?: KpiCategoryValue;
  flowId?: string;
  systemId?: string;
}

/** 所属プロジェクト解決用の最小参照（認可・存在検証用） */
export interface ProjectScopedRef {
  id: string;
  projectId: string;
  name: string;
}

/** 業務フローの最小参照（kind = ASIS | TOBE） */
export interface FlowRef {
  id: string;
  projectId: string;
  name: string;
  kind: string;
}

/** 情報種別の詳細（同一プロジェクト検証・AIプロンプト素材用） */
export interface InfoTypeDetail {
  id: string;
  projectId: string;
  name: string;
  category: string;
  description: string | null;
}

/** フローIOサマリ素材：ノードの入出力リンク（NodeInformationLink） */
export interface FlowIoNodeLinkRow {
  informationType: InfoTypeDetail;
  nodeLabel: string;
  direction: 'INPUT' | 'OUTPUT';
}

/** フローIOサマリ素材：矢印上を流れる情報（FlowEdge.informationTypeId） */
export interface FlowIoEdgeRow {
  informationType: InfoTypeDetail;
  edgeLabel: string | null;
  sourceNodeLabel: string;
  targetNodeLabel: string;
}

export interface IKpiRepository {
  /** プロジェクトのKPI一覧（任意フィルタ。情報種別＋フロー/システム/ロール名解決済み） */
  findByProject(projectId: string, filter?: KpiListFilter): Promise<KpiListRow[]>;
  findById(id: string): Promise<Kpi | null>;
  /** 単体レスポンス用（情報種別＋フロー/システム/ロール名解決済み） */
  findRowById(id: string): Promise<KpiListRow | null>;
  /** 既存最大 order + 1（KPIが無ければ 0） */
  nextOrder(projectId: string): Promise<number>;
  save(kpi: Kpi): Promise<void>;
  delete(id: string): Promise<void>;

  /**
   * KPI群と各KPIへの情報種別リンクを単一トランザクションで新規作成する
   * （AI生成バッチ用。途中失敗時に部分コミットを残さない）
   */
  createManyWithLinks(kpis: Kpi[], informationTypeIds: string[]): Promise<void>;

  /** KPIの測定対象情報種別を全置換 */
  setInformationTypes(kpiId: string, informationTypeIds: string[]): Promise<void>;
  /** 情報種別の詳細を一括取得（同一プロジェクト検証・プロンプト素材用） */
  findInformationTypes(ids: string[]): Promise<InfoTypeDetail[]>;

  /** 業務フローの最小参照（認可・プロンプト素材用） */
  findFlowRef(flowId: string): Promise<FlowRef | null>;
  /** システムの最小参照（存在検証・プロンプト素材用） */
  findSystemRef(systemId: string): Promise<ProjectScopedRef | null>;
  /** ロールの最小参照（存在検証用） */
  findRoleRef(roleId: string): Promise<ProjectScopedRef | null>;

  /** フローIOサマリ素材：ノードの入出力リンク（direction込み） */
  findFlowIoNodeLinks(flowId: string): Promise<FlowIoNodeLinkRow[]>;
  /** フローIOサマリ素材：矢印上を流れる情報 */
  findFlowIoEdges(flowId: string): Promise<FlowIoEdgeRow[]>;

  generateId(): string;
}
