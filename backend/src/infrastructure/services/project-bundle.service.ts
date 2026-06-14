import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../persistence/prisma/prisma.service';

/**
 * プロジェクト全体 export/import（独自 JSON バンドル）。
 *
 * 設計の要点（plan に準拠）:
 *  - export: プロジェクト配下の対象モデルを全件読み、実DBのidを保持したまま
 *    { formatVersion, exportedAt?, project, entities:{ <sectionKey>: Row[] } } で返す。
 *  - import: section を「依存順」に走査し、各 Row に randomUUID で新IDを採番、
 *    idMap(oldId→newId) で FK を旧→新解決する。解決できない任意FKは null、
 *    必須FKが解決できない行は skip してログに残す。
 *  - mode=replace は対象プロジェクト配下の対象データを「逆依存順」で deleteMany してから再構築。
 *    mode=merge は既存を残して追加（@@unique 衝突は get-or-create / skip で回避）。
 *  - 秘匿情報（APIキー暗号文・接続文字列・PAT 等）と監査ログ・スナップショット・
 *    Attachment バイナリ本体は export 対象外。
 *
 * 注: idMap は **全 section 横断のグローバルマップ**（旧ID→新ID）。
 *     旧IDは export 元プロジェクト内で uuid 一意なので、種別を跨いでも衝突しない。
 */

export const BUNDLE_FORMAT_VERSION = 1 as const;

// ---- バンドルの型 ----------------------------------------------------------

export interface ProjectBundle {
  formatVersion: number;
  exportedAt?: string;
  project: {
    name: string;
    slug: string;
    description: string | null;
  };
  entities: Record<string, Array<Record<string, unknown>>>;
}

export type ImportMode = 'replace' | 'merge';

export interface ImportResult {
  projectId: string;
  mode: ImportMode;
  counts: Record<string, number>;
  /** 解決できなかった必須FKなどで skip した行の説明（最大50件） */
  warnings: string[];
}

// ---- FK 再マップの宣言的メタ -------------------------------------------------

/**
 * FK 列の宣言。
 *  - field: バンドル Row 中の列名（= Prisma フィールド名）
 *  - required: true なら解決失敗時に行を skip、false なら null を入れて続行
 */
interface FkSpec {
  field: string;
  required: boolean;
}

/**
 * 1 モデルの import 仕様。
 *  - model: Prisma デリゲート名（prisma[model]）
 *  - fks: 再マップ対象の FK 列（projectId は別途 targetProjectId へ固定で再マップ）
 *  - deferredFks: 第1パスでは null にし、全行 create 後の第2パスで UPDATE する自己/相互参照 FK
 *  - includeProjectId: projectId 列を持つか（true=targetProjectId を入れる）
 *  - unique: merge 時の get-or-create 判定に使う @@unique キー（projectId を除いた残りの列名）。
 *            指定時、targetProjectId+これらの値で既存行を探し、あれば idMap に流用して create を skip。
 */
interface ModelSpec {
  model: string;
  fks?: FkSpec[];
  deferredFks?: string[];
  includeProjectId?: boolean;
  /** merge 時の既存行検索キー（projectId 以外の列）。idMap 再利用のため。 */
  uniqueBy?: string[];
}

interface SectionSpec {
  key: string;
  /** このセクションに含めるモデル（投入順） */
  models: ModelSpec[];
}

/**
 * export/import の section 定義。**配列の順序が依存順（=import 投入順）**。
 * delete（replace）はこの逆順で行う。
 *
 * projectId は includeProjectId のモデルすべてで targetProjectId に再マップ。
 * createdAt/updatedAt は import では使わない（DB 既定値に委ねる）。
 */
const SECTIONS: SectionSpec[] = [
  // projectRoot は Project 自体なので entities には含めない（別扱い）。
  {
    key: 'phases',
    models: [{ model: 'projectPhase', includeProjectId: true, uniqueBy: ['kind'] }],
  },
  {
    key: 'domains',
    models: [
      {
        model: 'subProject',
        includeProjectId: true,
        deferredFks: ['parentId'],
      },
    ],
  },
  {
    key: 'systems',
    models: [
      {
        model: 'system',
        includeProjectId: true,
        fks: [{ field: 'subProjectId', required: false }],
      },
    ],
  },
  {
    key: 'informationTypes',
    models: [
      {
        model: 'informationType',
        includeProjectId: true,
        fks: [{ field: 'subProjectId', required: false }],
      },
    ],
  },
  {
    key: 'constraints',
    models: [
      {
        model: 'constraint',
        includeProjectId: true,
        fks: [{ field: 'subProjectId', required: false }],
      },
    ],
  },
  {
    key: 'stakeholders',
    models: [
      { model: 'stakeholder', includeProjectId: true },
      {
        model: 'stakeholderSubProject',
        fks: [
          { field: 'stakeholderId', required: true },
          { field: 'subProjectId', required: true },
        ],
        uniqueBy: ['stakeholderId', 'subProjectId'],
      },
    ],
  },
  {
    key: 'roles',
    models: [
      {
        model: 'role',
        includeProjectId: true,
        fks: [
          { field: 'systemId', required: false },
          { field: 'subProjectId', required: false },
        ],
        uniqueBy: ['name'],
      },
    ],
  },
  {
    key: 'meetings',
    models: [
      {
        model: 'meeting',
        includeProjectId: true,
        fks: [{ field: 'ownerStakeholderId', required: false }],
      },
      {
        model: 'meetingStakeholder',
        fks: [
          { field: 'meetingId', required: true },
          { field: 'stakeholderId', required: true },
        ],
        uniqueBy: ['meetingId', 'stakeholderId'],
      },
      {
        model: 'meetingSubProject',
        fks: [
          { field: 'meetingId', required: true },
          { field: 'subProjectId', required: true },
        ],
        uniqueBy: ['meetingId', 'subProjectId'],
      },
    ],
  },
  {
    key: 'dataObjects',
    models: [
      {
        model: 'dataObject',
        includeProjectId: true,
        fks: [{ field: 'subProjectId', required: false }],
        uniqueBy: ['name'],
      },
      {
        model: 'dataObjectRelation',
        includeProjectId: true,
        fks: [
          { field: 'sourceObjectId', required: true },
          { field: 'targetObjectId', required: true },
        ],
      },
      {
        model: 'dataObjectAnnotation',
        includeProjectId: true,
        fks: [{ field: 'subProjectId', required: false }],
      },
    ],
  },
  {
    key: 'dataCatalog',
    models: [
      {
        model: 'table',
        includeProjectId: true,
        fks: [
          { field: 'informationTypeId', required: false },
          { field: 'dataObjectId', required: false },
        ],
        uniqueBy: ['name'],
      },
      {
        model: 'column',
        fks: [{ field: 'tableId', required: true }],
        uniqueBy: ['tableId', 'name'],
      },
      {
        model: 'tableStatus',
        fks: [{ field: 'tableId', required: true }],
        uniqueBy: ['tableId', 'value'],
      },
      {
        model: 'statusRolePermission',
        fks: [
          { field: 'tableStatusId', required: true },
          { field: 'roleId', required: true },
        ],
        uniqueBy: ['tableStatusId', 'roleId'],
      },
    ],
  },
  {
    key: 'apiCatalog',
    models: [
      {
        model: 'apiEndpoint',
        includeProjectId: true,
        uniqueBy: ['method', 'path'],
      },
      {
        model: 'apiRolePermission',
        fks: [
          { field: 'apiEndpointId', required: true },
          { field: 'roleId', required: true },
        ],
        uniqueBy: ['apiEndpointId', 'roleId'],
      },
    ],
  },
  {
    key: 'flowFolders',
    models: [
      {
        model: 'flowFolder',
        includeProjectId: true,
        deferredFks: ['parentId'],
      },
    ],
  },
  {
    key: 'flows',
    models: [
      {
        model: 'businessFlow',
        includeProjectId: true,
        fks: [
          { field: 'subProjectId', required: false },
          { field: 'folderId', required: false },
        ],
        // parentId / asisFlowId は自己参照・TOBE→ASIS のため第2パスで解決
        deferredFks: ['parentId', 'asisFlowId'],
      },
      {
        model: 'flowDefinition',
        fks: [{ field: 'flowId', required: true }],
        uniqueBy: ['flowId'],
      },
      {
        model: 'flowNode',
        fks: [
          { field: 'flowId', required: true },
          { field: 'roleId', required: false },
        ],
        // childFlowId は BusinessFlow を指す（全 BusinessFlow 作成後に確定）
        deferredFks: ['childFlowId'],
      },
      {
        model: 'flowEdge',
        fks: [
          { field: 'flowId', required: true },
          { field: 'sourceNodeId', required: true },
          { field: 'targetNodeId', required: true },
          { field: 'informationTypeId', required: false },
        ],
      },
      {
        model: 'flowAnnotation',
        fks: [{ field: 'flowId', required: true }],
      },
    ],
  },
  {
    key: 'flowLinks',
    models: [
      {
        model: 'nodeInformationLink',
        fks: [
          { field: 'nodeId', required: true },
          { field: 'informationTypeId', required: true },
        ],
      },
      {
        model: 'flowNodeLink',
        fks: [
          { field: 'nodeId', required: true },
          { field: 'targetFlowId', required: true },
          { field: 'targetNodeId', required: false },
        ],
      },
      {
        model: 'flowEdgeApiLink',
        fks: [
          { field: 'edgeId', required: true },
          { field: 'apiEndpointId', required: true },
        ],
        uniqueBy: ['edgeId', 'apiEndpointId'],
      },
      {
        model: 'interfaceDefinition',
        fks: [{ field: 'flowEdgeId', required: true }],
      },
      {
        model: 'interfaceColumn',
        fks: [
          { field: 'interfaceId', required: true },
          { field: 'columnId', required: true },
        ],
        uniqueBy: ['interfaceId', 'columnId'],
      },
      {
        model: 'crudMapping',
        fks: [
          { field: 'columnId', required: true },
          { field: 'roleId', required: true },
          { field: 'flowId', required: false },
          { field: 'flowNodeId', required: false },
        ],
      },
    ],
  },
  {
    key: 'cruoa',
    models: [
      {
        model: 'cruoaCol',
        fks: [
          { field: 'flowId', required: true },
          { field: 'roleId', required: false },
        ],
      },
      {
        model: 'cruoaRow',
        fks: [{ field: 'flowId', required: true }],
      },
      {
        model: 'cruoaCell',
        fks: [
          { field: 'rowId', required: true },
          { field: 'colId', required: true },
        ],
      },
    ],
  },
  {
    key: 'dfd',
    models: [
      {
        model: 'dfdDiagram',
        includeProjectId: true,
        fks: [{ field: 'flowId', required: false }],
        // [projectId, flowId] と flowId @unique。flowId が null の図は衝突しない
        // （Postgres は NULL を distinct 扱い）。非 null の場合のみ get-or-create が効く。
        uniqueBy: ['flowId'],
      },
      {
        model: 'dfdNode',
        fks: [
          { field: 'diagramId', required: true },
          { field: 'refFlowId', required: false },
          { field: 'refNodeId', required: false },
          { field: 'dataObjectId', required: false },
        ],
      },
      {
        model: 'dfdFlow',
        fks: [
          { field: 'diagramId', required: true },
          { field: 'sourceNodeId', required: true },
          { field: 'targetNodeId', required: true },
          { field: 'informationTypeId', required: false },
        ],
      },
      {
        model: 'dfdAnnotation',
        fks: [{ field: 'diagramId', required: true }],
      },
    ],
  },
  {
    key: 'issues',
    models: [
      { model: 'issueTree', includeProjectId: true },
      {
        model: 'issueNode',
        fks: [{ field: 'treeId', required: true }],
        // parentId(自己参照) と rootCauseNodeId(任意の他ノード参照) は第2パス
        deferredFks: ['parentId', 'rootCauseNodeId'],
      },
    ],
  },
  {
    key: 'gaps',
    models: [
      {
        model: 'gapItem',
        includeProjectId: true,
        fks: [
          { field: 'phaseId', required: false },
          { field: 'asisFlowId', required: false },
          { field: 'asisNodeId', required: false },
          { field: 'tobeFlowId', required: false },
          { field: 'tobeNodeId', required: false },
          { field: 'issueTreeId', required: false },
        ],
      },
      {
        model: 'gapLedger',
        includeProjectId: true,
        fks: [{ field: 'gapId', required: true }],
        uniqueBy: ['gapId'],
      },
    ],
  },
  {
    key: 'requirements',
    models: [
      {
        model: 'requirement',
        includeProjectId: true,
        deferredFks: ['parentId'],
      },
      {
        model: 'requirementFlowMapping',
        fks: [
          { field: 'requirementId', required: true },
          { field: 'flowId', required: true },
          { field: 'flowNodeId', required: false },
        ],
      },
      {
        model: 'requirementCrudMapping',
        fks: [
          { field: 'requirementId', required: true },
          { field: 'crudMappingId', required: true },
        ],
      },
    ],
  },
  {
    key: 'tobe',
    models: [
      {
        model: 'tobeVision',
        includeProjectId: true,
        fks: [
          { field: 'subProjectId', required: false },
          { field: 'asisFlowId', required: false },
        ],
      },
      {
        model: 'tobeRoadmap',
        includeProjectId: true,
        fks: [
          { field: 'subProjectId', required: false },
          { field: 'tobeVisionId', required: false },
        ],
      },
    ],
  },
  {
    key: 'roadmap',
    models: [{ model: 'roadmapPhase', includeProjectId: true }],
  },
  {
    key: 'asisMemo',
    models: [{ model: 'asisMemo', includeProjectId: true }],
  },
  {
    key: 'kpis',
    models: [
      {
        model: 'kpi',
        includeProjectId: true,
        fks: [
          { field: 'flowId', required: false },
          { field: 'systemId', required: false },
          { field: 'ownerRoleId', required: false },
        ],
      },
      {
        model: 'kpiInformationLink',
        fks: [
          { field: 'kpiId', required: true },
          { field: 'informationTypeId', required: true },
        ],
        uniqueBy: ['kpiId', 'informationTypeId'],
      },
    ],
  },
  {
    key: 'analysis',
    models: [
      { model: 'analysisParetoRow', includeProjectId: true },
      { model: 'analysisSensitivityRow', includeProjectId: true },
      { model: 'analysisGapRow', includeProjectId: true },
      { model: 'analysisLeakRow', includeProjectId: true },
    ],
  },
  {
    key: 'masterData',
    models: [
      { model: 'supplier', includeProjectId: true },
      {
        model: 'product',
        includeProjectId: true,
        fks: [{ field: 'supplierId', required: false }],
      },
      { model: 'demandData', includeProjectId: true },
    ],
  },
  {
    key: 'risks',
    models: [
      { model: 'riskCategory', includeProjectId: true, uniqueBy: ['name'] },
      {
        model: 'risk',
        includeProjectId: true,
        fks: [
          { field: 'categoryId', required: false },
          { field: 'subProjectId', required: false },
          { field: 'ownerStakeholderId', required: false },
          { field: 'reviewMeetingId', required: false },
        ],
      },
    ],
  },
  {
    key: 'tasks',
    models: [
      {
        model: 'task',
        includeProjectId: true,
        fks: [
          { field: 'assigneeRoleId', required: false },
          { field: 'issueNodeId', required: false },
          { field: 'riskId', required: false },
        ],
        deferredFks: ['parentId'],
      },
      {
        model: 'taskDependency',
        fks: [
          { field: 'predecessorId', required: true },
          { field: 'successorId', required: true },
        ],
        uniqueBy: ['predecessorId', 'successorId'],
      },
      {
        model: 'taskComment',
        fks: [{ field: 'taskId', required: true }],
        // authorUserId は FK なし＝そのまま保持（別環境では無効だが害なし）
      },
    ],
  },
  {
    key: 'stakeholderTracking',
    models: [
      {
        model: 'adoptionStatus',
        includeProjectId: true,
        fks: [
          { field: 'stakeholderId', required: true },
          { field: 'systemId', required: false },
        ],
        // [projectId, stakeholderId, systemId]。systemId が null の行は衝突しない。
        uniqueBy: ['stakeholderId', 'systemId'],
      },
      {
        model: 'reportCalendar',
        includeProjectId: true,
        fks: [
          { field: 'stakeholderId', required: false },
          { field: 'meetingId', required: false },
        ],
      },
      { model: 'interestMatrixRow', includeProjectId: true },
    ],
  },
  {
    key: 'charter',
    models: [
      {
        model: 'projectCharter',
        includeProjectId: true,
        fks: [
          { field: 'approverStakeholderId', required: false },
          { field: 'sponsorStakeholderId', required: false },
        ],
        // projectId @unique（1 プロジェクト 1 charter）。merge 再取り込みで既存を流用。
        uniqueBy: [],
      },
      {
        model: 'changeRequest',
        includeProjectId: true,
        fks: [{ field: 'approverStakeholderId', required: false }],
      },
      {
        model: 'lessonLearned',
        includeProjectId: true,
        fks: [{ field: 'subProjectId', required: false }],
      },
    ],
  },
  {
    key: 'attachments',
    models: [
      {
        model: 'attachment',
        includeProjectId: true,
        fks: [
          { field: 'phaseId', required: false },
          { field: 'taskId', required: false },
          { field: 'informationTypeId', required: false },
          { field: 'flowId', required: false },
        ],
      },
    ],
  },
];

/**
 * export で読み出さない列（秘匿情報・バイナリ・タイムスタンプは出力するが import で無視）。
 * モデルごとに「Prisma の select」を構成するためのブラックリストではなく、
 * バイナリ等の重い/秘匿列は明示的に select から外す。
 */
const ATTACHMENT_EXPORT_OMIT = new Set(['data']);

@Injectable()
export class ProjectBundleService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  /**
   * プロジェクト配下の全対象データをバンドル化して返す（exportedAt は呼び出し側で付与）。
   */
  async export(projectId: string): Promise<ProjectBundle> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, slug: true, description: true },
    });
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const entities: Record<string, Array<Record<string, unknown>>> = {};

    for (const section of SECTIONS) {
      const sectionRows: Array<Record<string, unknown>> = [];
      for (const m of section.models) {
        const rows = await this.readModelRows(m.model, projectId);
        // 同一セクション内は配列を連結せず、モデルごとに __model タグを付けて保持。
        // import 側で section の models 定義順に正しく振り分けるため、各 row に種別を残す。
        for (const r of rows) {
          (r as Record<string, unknown>).__model = m.model;
          sectionRows.push(r);
        }
      }
      entities[section.key] = sectionRows;
    }

    return {
      formatVersion: BUNDLE_FORMAT_VERSION,
      project,
      entities,
    };
  }

  /**
   * 1モデルの行を projectId スコープで読む。
   * projectId 列が無いモデルは親FK経由で絞り込む（whereByParent）。
   */
  private async readModelRows(
    model: string,
    projectId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const delegate = this.delegate(model);
    const where = this.exportWhere(model, projectId);
    const args: Record<string, unknown> = { where };
    // Attachment は data(Bytes) を select から外す（バイナリは export 対象外）。
    if (model === 'attachment') {
      args.select = this.attachmentSelect();
    }
    const rows = (await delegate.findMany(args)) as Array<
      Record<string, unknown>
    >;
    return rows;
  }

  private attachmentSelect(): Record<string, boolean> {
    // data 以外の全スカラ列。Prisma の select は明示列挙が必要。
    const fields = [
      'id',
      'projectId',
      'phaseId',
      'taskId',
      'kind',
      'filename',
      'displayName',
      'folder',
      'mimeType',
      'url',
      'size',
      'pageRange',
      'caption',
      'order',
      'createdAt',
      'informationTypeId',
      'flowId',
    ];
    const sel: Record<string, boolean> = {};
    for (const f of fields) {
      if (!ATTACHMENT_EXPORT_OMIT.has(f)) sel[f] = true;
    }
    return sel;
  }

  /**
   * モデルごとの export 絞り込み where。
   * projectId を直接持つモデルは { projectId }、持たないモデルは親リレーション経由。
   */
  private exportWhere(
    model: string,
    projectId: string,
  ): Record<string, unknown> {
    switch (model) {
      // --- projectId を直接持たない子モデルは親経由で絞る ---
      case 'column':
        return { table: { projectId } };
      case 'tableStatus':
        return { table: { projectId } };
      case 'statusRolePermission':
        return { tableStatus: { table: { projectId } } };
      case 'apiRolePermission':
        return { apiEndpoint: { projectId } };
      case 'flowDefinition':
        return { flow: { projectId } };
      case 'flowNode':
        return { flow: { projectId } };
      case 'flowEdge':
        return { flow: { projectId } };
      case 'flowAnnotation':
        return { flow: { projectId } };
      case 'nodeInformationLink':
        return { node: { flow: { projectId } } };
      case 'flowNodeLink':
        return { node: { flow: { projectId } } };
      case 'flowEdgeApiLink':
        return { edge: { flow: { projectId } } };
      case 'interfaceDefinition':
        return { flowEdge: { flow: { projectId } } };
      case 'interfaceColumn':
        return { interface: { flowEdge: { flow: { projectId } } } };
      case 'crudMapping':
        return { column: { table: { projectId } } };
      case 'cruoaCol':
        return { flow: { projectId } };
      case 'cruoaRow':
        return { flow: { projectId } };
      case 'cruoaCell':
        return { row: { flow: { projectId } } };
      case 'dfdNode':
        return { diagram: { projectId } };
      case 'dfdFlow':
        return { diagram: { projectId } };
      case 'dfdAnnotation':
        return { diagram: { projectId } };
      case 'issueNode':
        return { tree: { projectId } };
      case 'requirementFlowMapping':
        return { requirement: { projectId } };
      case 'requirementCrudMapping':
        return { requirement: { projectId } };
      case 'stakeholderSubProject':
        return { stakeholder: { projectId } };
      case 'meetingStakeholder':
        return { meeting: { projectId } };
      case 'meetingSubProject':
        return { meeting: { projectId } };
      case 'kpiInformationLink':
        return { kpi: { projectId } };
      case 'taskDependency':
        return { predecessor: { projectId } };
      case 'taskComment':
        return { task: { projectId } };
      // --- それ以外は projectId 直持ち ---
      default:
        return { projectId };
    }
  }

  // ===========================================================================
  // IMPORT
  // ===========================================================================

  /**
   * バンドルを取り込む。
   * @param targetProjectId 取り込み先プロジェクト（必須。新規作成は呼び出し側で行う）
   * @param bundle          取り込むバンドル
   * @param mode            'replace'（対象データを全消し再構築）| 'merge'（追加）
   * @param _userId         監査用（現状 ChangeLogInterceptor が記録するため未使用）
   */
  async import(
    targetProjectId: string,
    bundle: ProjectBundle,
    mode: ImportMode,
    _userId: string,
  ): Promise<ImportResult> {
    if (!bundle || typeof bundle !== 'object') {
      throw new Error('Invalid bundle: not an object');
    }
    if (bundle.formatVersion !== BUNDLE_FORMAT_VERSION) {
      throw new Error(
        `Unsupported bundle formatVersion: ${String(
          bundle.formatVersion,
        )} (expected ${BUNDLE_FORMAT_VERSION})`,
      );
    }
    const project = await this.prisma.project.findUnique({
      where: { id: targetProjectId },
      select: { id: true },
    });
    if (!project) {
      throw new Error(`Target project not found: ${targetProjectId}`);
    }

    const entities = bundle.entities ?? {};
    const idMap = new Map<string, string>();
    const counts: Record<string, number> = {};
    const warnings: string[] = [];
    // 第2パス（deferred FK の UPDATE）用に、行ごとの元データを退避。
    // model -> Array<{ newId, oldRow }>
    const deferredWork: Array<{
      model: string;
      newId: string;
      oldRow: Record<string, unknown>;
      deferredFks: string[];
    }> = [];

    await this.prisma.$transaction(
      async (tx) => {
        if (mode === 'replace') {
          await this.deleteExisting(tx, targetProjectId);
        }

        // ---- 第1パス: 依存順に create（deferred FK は null） ----
        for (const section of SECTIONS) {
          const sectionRows = entities[section.key] ?? [];
          // multi-model section では __model が無い行を「全モデルとして create」する
          // 二重生成を防ぐため、__model を必須にする（無い行は 1 回だけ警告して skip）。
          const singleModel = section.models.length === 1;
          if (!singleModel) {
            for (const r of sectionRows) {
              if (r.__model == null) {
                this.pushWarning(
                  warnings,
                  `skip row in section "${section.key}" (old id ${String(
                    r.id,
                  )}): missing required "__model" discriminator for a multi-model section`,
                );
              }
            }
          }
          for (const m of section.models) {
            const rowsForModel = sectionRows.filter((r) =>
              singleModel
                ? (r.__model ?? m.model) === m.model
                : r.__model === m.model,
            );
            let created = 0;
            for (const row of rowsForModel) {
              const oldId = row.id as string | undefined;
              if (!oldId) continue;

              // merge: @@unique で既存行があれば idMap に流用して create を skip。
              // uniqueBy が空配列でも includeProjectId のモデル（projectId @unique の
              // singleton。例: ProjectCharter）は projectId だけで既存を特定できる。
              if (
                mode === 'merge' &&
                m.uniqueBy &&
                (m.uniqueBy.length > 0 || m.includeProjectId)
              ) {
                const existingId = await this.findExistingByUnique(
                  tx,
                  m,
                  targetProjectId,
                  row,
                  idMap,
                );
                if (existingId) {
                  idMap.set(oldId, existingId);
                  continue;
                }
              }

              const built = this.buildCreateData(
                m,
                row,
                targetProjectId,
                idMap,
                warnings,
              );
              if (built.skip) continue;

              const newId = randomUUID();
              idMap.set(oldId, newId);

              try {
                await this.delegate(m.model, tx).create({
                  data: { ...built.data, id: newId },
                });
                created++;
                if (m.deferredFks && m.deferredFks.length > 0) {
                  deferredWork.push({
                    model: m.model,
                    newId,
                    oldRow: row,
                    deferredFks: m.deferredFks,
                  });
                }
              } catch (e) {
                // @@unique 衝突など（主に merge）。idMap を巻き戻して skip。
                idMap.delete(oldId);
                this.pushWarning(
                  warnings,
                  `create failed for ${m.model} (old id ${oldId}): ${
                    (e as Error).message
                  }`,
                );
              }
            }
            counts[m.model] = (counts[m.model] ?? 0) + created;
          }
        }

        // ---- 第2パス: deferred FK（自己/相互参照）を UPDATE ----
        for (const work of deferredWork) {
          const patch: Record<string, unknown> = {};
          for (const fk of work.deferredFks) {
            const oldRef = work.oldRow[fk] as string | null | undefined;
            if (oldRef) {
              const newRef = idMap.get(oldRef);
              if (newRef) patch[fk] = newRef;
            }
          }
          if (Object.keys(patch).length > 0) {
            try {
              await this.delegate(work.model, tx).update({
                where: { id: work.newId },
                data: patch,
              });
            } catch (e) {
              this.pushWarning(
                warnings,
                `deferred update failed for ${work.model} (${work.newId}): ${
                  (e as Error).message
                }`,
              );
            }
          }
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );

    return { projectId: targetProjectId, mode, counts, warnings };
  }

  /**
   * mode=replace: 対象プロジェクト配下の対象データを「逆依存順」で deleteMany。
   * Cascade に頼らず明示削除することで、対象外データ（ChangeLog等）に触れない。
   * 多くは projectId 直持ちまたは onDelete: Cascade なので、Project を残したまま
   * セクション逆順で消せば整合する。
   */
  private async deleteExisting(
    tx: PrismaTx,
    projectId: string,
  ): Promise<void> {
    for (let i = SECTIONS.length - 1; i >= 0; i--) {
      const section = SECTIONS[i];
      for (let j = section.models.length - 1; j >= 0; j--) {
        const m = section.models[j];
        const where = this.exportWhere(m.model, projectId);
        await this.delegate(m.model, tx).deleteMany({ where });
      }
    }
  }

  /**
   * 1行の create データを構築。
   *  - id/createdAt/updatedAt/__model を除去
   *  - projectId を targetProjectId に固定
   *  - 通常 FK を idMap で旧→新解決（required で解決不可なら skip、optional なら null）
   *  - deferred FK は null にしておく（第2パスで UPDATE）
   */
  private buildCreateData(
    m: ModelSpec,
    row: Record<string, unknown>,
    targetProjectId: string,
    idMap: Map<string, string>,
    warnings: string[],
  ): { data: Record<string, unknown>; skip: boolean } {
    const data: Record<string, unknown> = {};
    const deferred = new Set(m.deferredFks ?? []);
    const fkByField = new Map<string, FkSpec>();
    for (const fk of m.fks ?? []) fkByField.set(fk.field, fk);

    for (const [key, value] of Object.entries(row)) {
      if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue;
      if (key === '__model') continue;

      if (key === 'projectId') {
        if (m.includeProjectId) data.projectId = targetProjectId;
        continue;
      }

      if (deferred.has(key)) {
        // 第2パスで解決。第1パスは null。
        data[key] = null;
        continue;
      }

      const fk = fkByField.get(key);
      if (fk) {
        if (value == null) {
          data[key] = null;
          continue;
        }
        const mapped = idMap.get(value as string);
        if (mapped) {
          data[key] = mapped;
        } else if (fk.required) {
          this.pushWarning(
            warnings,
            `skip ${m.model} row (old id ${String(
              row.id,
            )}): unresolved required FK ${key}=${String(value)}`,
          );
          return { data, skip: true };
        } else {
          data[key] = null;
        }
        continue;
      }

      // 通常スカラ列（Json/配列含む）はそのまま
      data[key] = value;
    }

    return { data, skip: false };
  }

  /**
   * merge 時の get-or-create: targetProjectId + uniqueBy 列で既存行を探す。
   *
   * uniqueBy が FK 列（このモデルの fks / deferredFks に含まれる列）を指す場合、
   * バンドルの値は **旧プロジェクトの id** なので idMap で旧→新へ解決してから照合する。
   * 解決できない FK が uniqueBy に含まれる場合は既存行を確実に特定できないため null を返す
   *（呼び出し側は通常の create を試み、衝突したら catch で skip 警告に倒れる）。
   */
  private async findExistingByUnique(
    tx: PrismaTx,
    m: ModelSpec,
    targetProjectId: string,
    row: Record<string, unknown>,
    idMap: Map<string, string>,
  ): Promise<string | null> {
    const fkFields = new Set<string>([
      ...(m.fks ?? []).map((fk) => fk.field),
      ...(m.deferredFks ?? []),
    ]);

    const where: Record<string, unknown> = {};
    if (m.includeProjectId) where.projectId = targetProjectId;
    for (const f of m.uniqueBy ?? []) {
      const raw = row[f];
      if (fkFields.has(f)) {
        // FK 列は旧→新解決が必須。解決できなければ照合不能。
        if (raw == null) return null;
        const mapped = idMap.get(raw as string);
        if (!mapped) return null;
        where[f] = mapped;
      } else {
        where[f] = raw;
      }
    }
    const found = (await this.delegate(m.model, tx).findFirst({
      where,
      select: { id: true },
    })) as { id: string } | null;
    return found ? found.id : null;
  }

  // ===========================================================================
  // JSON Schema（機械可読 / draft-07）
  // ===========================================================================

  /**
   * AI が形式を理解して読み書きできる粒度の JSON Schema（draft-07）。
   * top-level 構造 + 各 section が配列であること + 主要フィールドを記述。
   */
  getBundleSchema(): Record<string, unknown> {
    const entityProps: Record<string, unknown> = {};
    for (const section of SECTIONS) {
      const modelNames = section.models.map((mm) => mm.model);
      const multiModel = modelNames.length > 1;
      // multi-model section では __model を必須にし、許可値を enum で示す。
      // これにより、AI が生成したバンドルで __model 欠落行が「全モデルとして二重 create」される
      // 事故をスキーマレベルで防ぐ（import 側も欠落行を skip する）。
      const itemRequired = multiModel ? ['id', '__model'] : ['id'];
      const modelDescription = multiModel
        ? `REQUIRED Prisma model discriminator. This section contains multiple models, so every row MUST set "__model" to exactly one of: ${modelNames.join(
            ', ',
          )}. Rows missing "__model" are skipped on import.`
        : `Optional Prisma model discriminator. This section has a single model ("${modelNames[0]}"); when omitted it defaults to that model.`;
      entityProps[section.key] = {
        type: 'array',
        description: `Rows for section "${section.key}" (models: ${modelNames.join(
          ', ',
        )}). Each row keeps its original DB "id" (used for FK remap on import)${
          multiModel
            ? ' and MUST carry a "__model" discriminator (multiple models in this section)'
            : ''
        }.`,
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description:
                'Original source DB id (uuid). Preserved on export, remapped to a fresh uuid on import.',
            },
            __model: {
              type: 'string',
              enum: modelNames,
              description: modelDescription,
            },
          },
          required: itemRequired,
          additionalProperties: true,
        },
      };
    }

    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $id: 'https://iplot.local/schemas/project-bundle.json',
      title: 'IPLoT Project Bundle',
      description:
        'Self-contained export/import bundle of a single IPLoT project. Secrets (API keys, encrypted tokens/connection strings), audit logs, flow snapshots and attachment binaries are excluded. On import, every row gets a fresh uuid and foreign keys are remapped old->new in dependency order.',
      type: 'object',
      required: ['formatVersion', 'project', 'entities'],
      additionalProperties: false,
      properties: {
        formatVersion: {
          type: 'integer',
          const: BUNDLE_FORMAT_VERSION,
          description: 'Bundle format version. Import requires an exact match.',
        },
        exportedAt: {
          type: 'string',
          format: 'date-time',
          description: 'ISO timestamp added by the export endpoint.',
        },
        project: {
          type: 'object',
          description:
            'Root project metadata. organizationId is NOT included; on import the target org is resolved by the caller. slug may be renamed on collision.',
          required: ['name', 'slug'],
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: ['string', 'null'] },
          },
        },
        entities: {
          type: 'object',
          description:
            'Map of sectionKey -> array of rows. Sections are imported in the declared dependency order; deletion (replace mode) happens in reverse.',
          additionalProperties: false,
          properties: entityProps,
        },
      },
    };
  }

  /** import 投入順（= section キーの依存順）。ドキュメント/デバッグ用。 */
  getSectionOrder(): string[] {
    return SECTIONS.map((s) => s.key);
  }

  // ===========================================================================
  // helpers
  // ===========================================================================

  /**
   * Prisma デリゲートを動的に解決。tx 指定時はトランザクションクライアントを使う。
   */
  private delegate(model: string, tx?: PrismaTx): PrismaDelegate {
    const client = (tx ?? this.prisma) as unknown as Record<
      string,
      PrismaDelegate
    >;
    const delegate = client[model];
    if (!delegate) {
      throw new Error(`Unknown Prisma model delegate: ${model}`);
    }
    return delegate;
  }

  private pushWarning(warnings: string[], msg: string): void {
    if (warnings.length < 50) warnings.push(msg);
  }
}

// Prisma の最小デリゲート型（any を避けつつ動的アクセスするための薄い型）
interface PrismaDelegate {
  findMany(args?: unknown): Promise<unknown[]>;
  findFirst(args?: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  deleteMany(args?: unknown): Promise<unknown>;
}

// $transaction のコールバックに渡るトランザクションクライアント
type PrismaTx = Parameters<
  Parameters<PrismaService['$transaction']>[0]
>[0];
