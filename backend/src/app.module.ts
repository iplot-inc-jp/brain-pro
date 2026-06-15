import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// Domain
import {
  USER_REPOSITORY,
  ORGANIZATION_REPOSITORY,
  PROJECT_REPOSITORY,
  ROLE_REPOSITORY,
  TABLE_REPOSITORY,
  COLUMN_REPOSITORY,
  BUSINESS_FLOW_REPOSITORY,
  FLOW_NODE_REPOSITORY,
  FLOW_FOLDER_REPOSITORY,
  FLOW_DEFINITION_REPOSITORY,
  FLOW_NODE_LINK_REPOSITORY,
  CRUD_MAPPING_REPOSITORY,
  PROJECT_PHASE_REPOSITORY,
  GAP_ITEM_REPOSITORY,
  ISSUE_TREE_REPOSITORY,
  ISSUE_NODE_REPOSITORY,
  TASK_REPOSITORY,
  TASK_COMMENT_REPOSITORY,
  DFD_REPOSITORY,
  DATA_OBJECT_REPOSITORY,
  INFORMATION_TYPE_REPOSITORY,
  SYSTEM_REPOSITORY,
  CONSTRAINT_REPOSITORY,
  STAKEHOLDER_REPOSITORY,
  MEETING_REPOSITORY,
  RISK_REPOSITORY,
  RISK_CATEGORY_REPOSITORY,
  SUPPLIER_REPOSITORY,
  PRODUCT_REPOSITORY,
  DEMAND_DATA_REPOSITORY,
  REPORT_CALENDAR_REPOSITORY,
  INTEREST_MATRIX_ROW_REPOSITORY,
  ASIS_MEMO_REPOSITORY,
  TOBE_VISION_REPOSITORY,
  TOBE_ROADMAP_REPOSITORY,
  ROADMAP_PHASE_REPOSITORY,
  KPI_REPOSITORY,
  // Knowledge graph batch ingestion
  INGESTION_BATCH_REPOSITORY,
  INGESTION_FILE_REPOSITORY,
  KNOWLEDGE_REPOSITORY,
  PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY,
  PASSWORD_HASH_SERVICE,
  TOKEN_SERVICE,
} from './domain';

// Application
import {
  RegisterUserUseCase,
  LoginUserUseCase,
  GetCurrentUserUseCase,
  CreateOrganizationUseCase,
  GetOrganizationsUseCase,
  CreateProjectUseCase,
  GetProjectsUseCase,
  CreateRoleUseCase,
  GetRolesUseCase,
  UpdateRoleUseCase,
  // ProjectPhase
  CreatePhaseUseCase,
  GetPhasesUseCase,
  GetPhaseUseCase,
  InitializePhasesUseCase,
  UpdatePhaseUseCase,
  TransitionPhaseUseCase,
  DeletePhaseUseCase,
  // GapItem
  CreateGapItemUseCase,
  GetGapItemsUseCase,
  GetGapItemUseCase,
  UpdateGapItemUseCase,
  ResolveGapItemUseCase,
  ReopenGapItemUseCase,
  DeleteGapItemUseCase,
  // IssueTree
  CreateIssueTreeUseCase,
  GetIssueTreesUseCase,
  GetIssueTreeUseCase,
  UpdateIssueTreeUseCase,
  DeleteIssueTreeUseCase,
  AddIssueNodeUseCase,
  UpdateIssueNodeUseCase,
  DeleteIssueNodeUseCase,
  SetNodeVerificationUseCase,
  ListProjectIssueNodesUseCase,
  // FlowFolder
  CreateFlowFolderUseCase,
  GetFlowFoldersUseCase,
  RenameFlowFolderUseCase,
  MoveFlowFolderUseCase,
  DeleteFlowFolderUseCase,
  // FlowDefinition
  GetFlowDefinitionUseCase,
  UpsertFlowDefinitionUseCase,
  ListFlowDefinitionsUseCase,
  // FlowNodeLink
  CreateNodeLinkUseCase,
  GetNodeLinksUseCase,
  DeleteNodeLinkUseCase,
  // FlowNode child-flow drill-down
  CreateNodeChildFlowUseCase,
  // FlowTree (project-wide hierarchy map)
  GetFlowTreeUseCase,
  // Task
  CreateTaskUseCase,
  GetTasksUseCase,
  GetTaskUseCase,
  UpdateTaskUseCase,
  DeleteTaskUseCase,
  AddTaskDependencyUseCase,
  RemoveTaskDependencyUseCase,
  ImportBacklogTasksUseCase,
  ImportJiraTasksUseCase,
  // 外部トラッカー Webhook（秘密の生成/再生成/無効化/URL取得）
  ManageTrackerWebhookUseCase,
  // 外部トラッカー Webhook 受信（token検証→単一import / 削除=クローズ）
  ProcessTrackerWebhookUseCase,
  // AI使用量サマリ（モデル別/領域別/概算コスト）
  GetLlmUsageSummaryUseCase,
  // Task Comment
  CreateTaskCommentUseCase,
  GetTaskCommentsUseCase,
  UpdateTaskCommentUseCase,
  DeleteTaskCommentUseCase,
  // DFD
  GetFlowDfdUseCase,
  GenerateFlowDfdUseCase,
  GetProjectDfdUseCase,
  GenerateProjectDfdUseCase,
  AddDfdNodeUseCase,
  UpdateDfdNodeUseCase,
  DeleteDfdNodeUseCase,
  AddDfdFlowUseCase,
  UpdateDfdFlowUseCase,
  DeleteDfdFlowUseCase,
  SaveDfdPositionsUseCase,
  // DataObject（オブジェクト関係性マップ・ER図）
  GetObjectGraphUseCase,
  CreateDataObjectUseCase,
  UpdateDataObjectUseCase,
  UpdateDataObjectSubProjectUseCase,
  DeleteDataObjectUseCase,
  CreateObjectRelationUseCase,
  UpdateObjectRelationUseCase,
  DeleteObjectRelationUseCase,
  SaveObjectPositionsUseCase,
  ImportFromDfdUseCase,
  ImportMermaidUseCase,
  GetErGraphUseCase,
  LinkTableToObjectUseCase,
  SaveErPositionsUseCase,
  // InformationType
  GetInformationTypesUseCase,
  CreateInformationTypeUseCase,
  UpdateInformationTypeUseCase,
  DeleteInformationTypeUseCase,
  // System
  GetSystemsUseCase,
  CreateSystemUseCase,
  UpdateSystemUseCase,
  DeleteSystemUseCase,
  // Constraint
  GetConstraintsUseCase,
  CreateConstraintUseCase,
  UpdateConstraintUseCase,
  DeleteConstraintUseCase,
  // Stakeholder
  CreateStakeholderUseCase,
  GetStakeholdersUseCase,
  UpdateStakeholderUseCase,
  DeleteStakeholderUseCase,
  // Meeting
  CreateMeetingUseCase,
  GetMeetingsUseCase,
  UpdateMeetingUseCase,
  DeleteMeetingUseCase,
  SetMeetingStakeholdersUseCase,
  SetMeetingSubProjectsUseCase,
  // Risk
  CreateRiskUseCase,
  GetRisksUseCase,
  UpdateRiskUseCase,
  DeleteRiskUseCase,
  // RiskCategory
  CreateRiskCategoryUseCase,
  GetRiskCategoriesUseCase,
  UpdateRiskCategoryUseCase,
  DeleteRiskCategoryUseCase,
  // Supplier
  CreateSupplierUseCase,
  GetSuppliersUseCase,
  UpdateSupplierUseCase,
  DeleteSupplierUseCase,
  // Product
  CreateProductUseCase,
  GetProductsUseCase,
  UpdateProductUseCase,
  DeleteProductUseCase,
  // DemandData
  CreateDemandDataUseCase,
  GetDemandDataUseCase,
  UpdateDemandDataUseCase,
  DeleteDemandDataUseCase,
  // ReportCalendar
  CreateReportCalendarUseCase,
  GetReportCalendarsUseCase,
  UpdateReportCalendarUseCase,
  DeleteReportCalendarUseCase,
  // InterestMatrixRow
  CreateInterestMatrixRowUseCase,
  GetInterestMatrixRowsUseCase,
  UpdateInterestMatrixRowUseCase,
  DeleteInterestMatrixRowUseCase,
  // AsisMemo
  CreateAsisMemoUseCase,
  GetAsisMemosUseCase,
  UpdateAsisMemoUseCase,
  DeleteAsisMemoUseCase,
  // TobeVision
  CreateTobeVisionUseCase,
  GetTobeVisionsUseCase,
  UpdateTobeVisionUseCase,
  DeleteTobeVisionUseCase,
  // TobeRoadmap
  CreateTobeRoadmapUseCase,
  GetTobeRoadmapsUseCase,
  UpdateTobeRoadmapUseCase,
  DeleteTobeRoadmapUseCase,
  // RoadmapPhase
  CreateRoadmapPhaseUseCase,
  GetRoadmapPhasesUseCase,
  UpdateRoadmapPhaseUseCase,
  DeleteRoadmapPhaseUseCase,
  // KPI（業務KPI・AI精度KPI）
  ListKpisUseCase,
  CreateKpiUseCase,
  UpdateKpiUseCase,
  DeleteKpiUseCase,
  SetKpiInformationTypesUseCase,
  GetFlowIoSummaryUseCase,
  GenerateKpisUseCase,
  // Ingestion（取り込みバッチ/ファイル）
  CreateIngestionBatchUseCase,
  GetIngestionBatchesUseCase,
  GetIngestionBatchDetailUseCase,
  ResumeBatchUseCase,
  CancelBatchUseCase,
  RetryFileUseCase,
  SkipFileUseCase,
  // Knowledge（ナレッジグラフ read + node/document/relation 編集）
  GetKnowledgeGraphUseCase,
  GetKnowledgeNodeUseCase,
  SearchKnowledgeUseCase,
  UpdateKnowledgeNodeUseCase,
  DeleteKnowledgeNodeUseCase,
  MergeKnowledgeNodesUseCase,
  UpdateDocumentPositionUseCase,
  UpdateKnowledgeDocumentUseCase,
  DeleteKnowledgeDocumentUseCase,
  UpdateKnowledgeRelationUseCase,
  DeleteKnowledgeRelationUseCase,
  // KnowledgeSettings（課金ガード設定）
  GetOrCreateSettingsUseCase,
  UpdateSettingsUseCase,
} from './application';

// Infrastructure
import {
  PrismaModule,
  UserRepositoryImpl,
  OrganizationRepositoryImpl,
  ProjectRepositoryImpl,
  RoleRepositoryImpl,
  PrismaTableRepository,
  PrismaColumnRepository,
  PrismaBusinessFlowRepository,
  PrismaFlowNodeRepository,
  FlowFolderRepositoryImpl,
  FlowDefinitionRepositoryImpl,
  FlowNodeLinkRepositoryImpl,
  PrismaCrudMappingRepository,
  ProjectPhaseRepositoryImpl,
  GapItemRepositoryImpl,
  IssueTreeRepositoryImpl,
  IssueNodeRepositoryImpl,
  TaskRepositoryImpl,
  TaskCommentRepositoryImpl,
  DfdRepositoryImpl,
  DataObjectRepositoryImpl,
  InformationTypeRepositoryImpl,
  SystemRepositoryImpl,
  ConstraintRepositoryImpl,
  StakeholderRepositoryImpl,
  MeetingRepositoryImpl,
  RiskRepositoryImpl,
  RiskCategoryRepositoryImpl,
  SupplierRepositoryImpl,
  ProductRepositoryImpl,
  DemandDataRepositoryImpl,
  ReportCalendarRepositoryImpl,
  InterestMatrixRowRepositoryImpl,
  AsisMemoRepositoryImpl,
  TobeVisionRepositoryImpl,
  TobeRoadmapRepositoryImpl,
  RoadmapPhaseRepositoryImpl,
  KpiRepositoryImpl,
  // Knowledge graph batch ingestion
  IngestionBatchRepositoryImpl,
  IngestionFileRepositoryImpl,
  KnowledgeRepositoryImpl,
  ProjectKnowledgeSettingsRepositoryImpl,
  BcryptPasswordHashService,
  JwtTokenService,
  ProjectAccessService,
  ProjectBundleService,
  EntityJsonService,
} from './infrastructure';

// Presentation
import {
  AuthController,
  OrganizationController,
  ProjectController,
  ProjectByIdController,
  ProjectMemberController,
  ProjectMyAccessController,
  RoleController,
  TableController,
  BusinessFlowController,
  FlowFolderController,
  FlowFolderByIdController,
  FlowDefinitionController,
  ProjectPhaseController,
  PhaseByIdController,
  GapItemController,
  GapItemByIdController,
  IssueTreeController,
  TaskController,
  TaskByIdController,
  TaskCommentController,
  TaskCommentByIdController,
  DfdController,
  DataObjectController,
  StakeholderController,
  StakeholderByIdController,
  StakeholderAssignmentController,
  MeetingController,
  MeetingByIdController,
  RiskController,
  RiskByIdController,
  RiskCategoryController,
  RiskCategoryByIdController,
  SupplierController,
  SupplierByIdController,
  ProductController,
  ProductByIdController,
  DemandDataController,
  DemandDataByIdController,
  ReportCalendarController,
  ReportCalendarByIdController,
  InterestMatrixRowController,
  InterestMatrixRowByIdController,
  AsisMemoController,
  AsisMemoByIdController,
  TobeVisionController,
  TobeVisionByIdController,
  TobeRoadmapController,
  TobeRoadmapByIdController,
  ProjectCharterController,
  ChangeLogController,
  AdoptionStatusController,
  AdoptionStatusByIdController,
  KpiController,
  ProjectBundleController,
  OrganizationProjectImportController,
  ExportSchemaController,
  EntityJsonController,
  EntityJsonSchemaController,
  FeatureIoController,
  FeatureIoSchemaController,
  JwtAuthGuard,
  DomainExceptionFilter,
} from './presentation';
import { ChangeLogInterceptor } from './presentation/interceptors/change-log.interceptor';
import { HealthController } from './presentation/controllers/health.controller';
import { RequirementController } from './presentation/controllers/requirement.controller';
import { UserSettingsController } from './presentation/controllers/user-settings.controller';
import { ApiKeyController } from './presentation/controllers/api-key.controller';
import { GithubConnectionController } from './presentation/controllers/github-connection.controller';
import { CronController } from './presentation/controllers/cron.controller';
import { CodeCatalogController } from './presentation/controllers/code-catalog.controller';
import { DatabaseConnectionController } from './presentation/controllers/database-connection.controller';
import { AttachmentController } from './presentation/controllers/attachment.controller';
import {
  InformationTypeController,
  InformationTypeByIdController,
} from './presentation/controllers/information-type.controller';
import {
  SystemController,
  SystemByIdController,
} from './presentation/controllers/system.controller';
import {
  ConstraintController,
  ConstraintByIdController,
} from './presentation/controllers/constraint.controller';
import {
  RoadmapPhaseController,
  RoadmapPhaseByIdController,
} from './presentation/controllers/roadmap-phase.controller';
import { SubProjectController } from './presentation/controllers/sub-project.controller';
import { AnalysisController } from './presentation/controllers/analysis.controller';
import { GapLedgerController } from './presentation/controllers/gap-ledger.controller';
import { CruoaController } from './presentation/controllers/cruoa.controller';
import { ClaudeService } from './infrastructure/services/claude.service';
import { ApiKeyService } from './infrastructure/services/api-key.service';
import { CryptoService } from './infrastructure/services/crypto.service';
import { CompanyKeyService } from './infrastructure/services/company-key.service';
import { GithubService } from './infrastructure/services/github.service';
import { CodeExtractionService } from './infrastructure/services/code-extraction.service';
import { LlmUsageRecorder } from './infrastructure/services/llm-usage-recorder.service';
import { AttachmentRegisterService } from './infrastructure/services/attachment-register.service';
import { SyncService } from './infrastructure/services/sync.service';
import { SyncSchedulerService } from './infrastructure/services/sync-scheduler.service';
import { QStashService } from './infrastructure/services/qstash.service';
import { JobService } from './infrastructure/services/job.service';
import { TaskWebhookService } from './infrastructure/services/task-webhook.service';
import { TrackerImportService } from './infrastructure/services/trackers/tracker-import.service';
import { WebhookController } from './presentation/controllers/webhook.controller';
import { TrackerConnectionController } from './presentation/controllers/tracker-connection.controller';
import { TrackerWebhookController } from './presentation/controllers/tracker-webhook.controller';
import { LlmUsageController } from './presentation/controllers/llm-usage.controller';
import { BlobUploadController } from './presentation/controllers/blob-upload.controller';
import {
  JobWorkerController,
  ProjectJobController,
  JobByIdController,
} from './presentation/controllers/job.controller';
// ナレッジグラフ バッチ取り込み
import { BlobStorageService } from './infrastructure/services/blob-storage.service';
import { FileExtractionService } from './infrastructure/knowledge/file-extraction.service';
import { KnowledgeIngestionService } from './infrastructure/knowledge/knowledge-ingestion.service';
import {
  IngestionBatchProjectController,
  IngestionBatchByIdController,
  MyIngestionBatchController,
} from './presentation/controllers/ingestion.controller';
import { IngestionFileController } from './presentation/controllers/ingestion-file.controller';
import { IngestionUploadController } from './presentation/controllers/ingestion-upload.controller';
import { IngestionSourceController } from './presentation/controllers/ingestion-source.controller';
import {
  KnowledgeProjectController,
  KnowledgeNodeController,
  KnowledgeDocumentController,
  KnowledgeRelationController,
} from './presentation/controllers/knowledge.controller';
import { KnowledgeSettingsController } from './presentation/controllers/knowledge-settings.controller';
// ナレッジグラフ Google Drive ソースアダプタ（Phase 3）
import { DriveService } from './infrastructure/knowledge/drive.service';
import { DriveController } from './presentation/controllers/drive.controller';
// Liveblocks リアルタイム・プレゼンス（トークン発行）
import { LiveblocksController } from './presentation/controllers/liveblocks.controller';
import { IssueLiveblocksTokenUseCase } from './application/use-cases/liveblocks/issue-liveblocks-token.use-case';
import { GetAllAccessibleIngestionBatchesUseCase } from './application/use-cases/ingestion/get-all-accessible-ingestion-batches.use-case';
import { LiveblocksTokenService } from './infrastructure/services/liveblocks-token.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'your-secret-key'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
  ],
  controllers: [
    HealthController,
    CronController,
    AuthController,
    OrganizationController,
    ProjectController,
    ProjectByIdController,
    ProjectMemberController,
    ProjectMyAccessController,
    RoleController,
    TableController,
    BusinessFlowController,
    FlowFolderController,
    FlowFolderByIdController,
    FlowDefinitionController,
    ProjectPhaseController,
    PhaseByIdController,
    GapItemController,
    GapItemByIdController,
    IssueTreeController,
    TaskController,
    TaskByIdController,
    TaskCommentController,
    TaskCommentByIdController,
    RequirementController,
    UserSettingsController,
    ApiKeyController,
    GithubConnectionController,
    CodeCatalogController,
    DatabaseConnectionController,
    AttachmentController,
    SubProjectController,
    AnalysisController,
    GapLedgerController,
    CruoaController,
    DfdController,
    DataObjectController,
    InformationTypeController,
    InformationTypeByIdController,
    SystemController,
    SystemByIdController,
    ConstraintController,
    ConstraintByIdController,
    StakeholderController,
    StakeholderByIdController,
    StakeholderAssignmentController,
    MeetingController,
    MeetingByIdController,
    RiskController,
    RiskByIdController,
    RiskCategoryController,
    RiskCategoryByIdController,
    SupplierController,
    SupplierByIdController,
    ProductController,
    ProductByIdController,
    DemandDataController,
    DemandDataByIdController,
    ReportCalendarController,
    ReportCalendarByIdController,
    InterestMatrixRowController,
    InterestMatrixRowByIdController,
    AsisMemoController,
    AsisMemoByIdController,
    TobeVisionController,
    TobeVisionByIdController,
    TobeRoadmapController,
    TobeRoadmapByIdController,
    RoadmapPhaseController,
    RoadmapPhaseByIdController,
    ProjectCharterController,
    ChangeLogController,
    AdoptionStatusController,
    AdoptionStatusByIdController,
    KpiController,
    // Project Bundle (export/import)
    ProjectBundleController,
    OrganizationProjectImportController,
    ExportSchemaController,
    // 単一エンティティ（業務フロー/DFD/イシューツリー）丸ごと JSON I/O
    EntityJsonController,
    EntityJsonSchemaController,
    // 機能(section)単位 export/import（全体バンドルと SECTIONS 機械を共有）
    FeatureIoController,
    FeatureIoSchemaController,
    // Background Jobs (Upstash QStash)
    JobWorkerController,
    ProjectJobController,
    JobByIdController,
    // タスク Webhook（outbound: Brain Pro → 外部/ipro-kun）
    WebhookController,
    // 外部トラッカー（Backlog/Jira）移行・同期
    TrackerConnectionController,
    // 外部トラッカー Webhook 秘密の管理（admin）
    TrackerWebhookController,
    LlmUsageController,
    BlobUploadController,
    // ナレッジグラフ バッチ取り込み（取り込み/ナレッジ/設定）
    IngestionBatchProjectController,
    IngestionBatchByIdController,
    MyIngestionBatchController,
    IngestionFileController,
    IngestionUploadController,
    IngestionSourceController,
    KnowledgeProjectController,
    KnowledgeNodeController,
    KnowledgeDocumentController,
    KnowledgeRelationController,
    KnowledgeSettingsController,
    // Google Drive ソースアダプタ（Phase 3）
    DriveController,
    // Liveblocks リアルタイム・プレゼンス
    LiveblocksController,
  ],
  providers: [
    // ========== Domain Service Implementations ==========
    {
      provide: PASSWORD_HASH_SERVICE,
      useClass: BcryptPasswordHashService,
    },
    {
      provide: TOKEN_SERVICE,
      useClass: JwtTokenService,
    },

    // ========== Repository Implementations ==========
    {
      provide: USER_REPOSITORY,
      useClass: UserRepositoryImpl,
    },
    {
      provide: ORGANIZATION_REPOSITORY,
      useClass: OrganizationRepositoryImpl,
    },
    {
      provide: PROJECT_REPOSITORY,
      useClass: ProjectRepositoryImpl,
    },
    {
      provide: ROLE_REPOSITORY,
      useClass: RoleRepositoryImpl,
    },
    {
      provide: TABLE_REPOSITORY,
      useClass: PrismaTableRepository,
    },
    {
      provide: COLUMN_REPOSITORY,
      useClass: PrismaColumnRepository,
    },
    {
      provide: BUSINESS_FLOW_REPOSITORY,
      useClass: PrismaBusinessFlowRepository,
    },
    {
      provide: FLOW_NODE_REPOSITORY,
      useClass: PrismaFlowNodeRepository,
    },
    {
      provide: FLOW_FOLDER_REPOSITORY,
      useClass: FlowFolderRepositoryImpl,
    },
    {
      provide: FLOW_DEFINITION_REPOSITORY,
      useClass: FlowDefinitionRepositoryImpl,
    },
    {
      provide: FLOW_NODE_LINK_REPOSITORY,
      useClass: FlowNodeLinkRepositoryImpl,
    },
    {
      provide: CRUD_MAPPING_REPOSITORY,
      useClass: PrismaCrudMappingRepository,
    },
    {
      provide: PROJECT_PHASE_REPOSITORY,
      useClass: ProjectPhaseRepositoryImpl,
    },
    {
      provide: GAP_ITEM_REPOSITORY,
      useClass: GapItemRepositoryImpl,
    },
    {
      provide: ISSUE_TREE_REPOSITORY,
      useClass: IssueTreeRepositoryImpl,
    },
    {
      provide: ISSUE_NODE_REPOSITORY,
      useClass: IssueNodeRepositoryImpl,
    },
    {
      provide: TASK_REPOSITORY,
      useClass: TaskRepositoryImpl,
    },
    {
      provide: TASK_COMMENT_REPOSITORY,
      useClass: TaskCommentRepositoryImpl,
    },
    {
      provide: DFD_REPOSITORY,
      useClass: DfdRepositoryImpl,
    },
    {
      provide: DATA_OBJECT_REPOSITORY,
      useClass: DataObjectRepositoryImpl,
    },
    {
      provide: INFORMATION_TYPE_REPOSITORY,
      useClass: InformationTypeRepositoryImpl,
    },
    {
      provide: SYSTEM_REPOSITORY,
      useClass: SystemRepositoryImpl,
    },
    {
      provide: CONSTRAINT_REPOSITORY,
      useClass: ConstraintRepositoryImpl,
    },
    {
      provide: STAKEHOLDER_REPOSITORY,
      useClass: StakeholderRepositoryImpl,
    },
    {
      provide: MEETING_REPOSITORY,
      useClass: MeetingRepositoryImpl,
    },
    {
      provide: RISK_REPOSITORY,
      useClass: RiskRepositoryImpl,
    },
    {
      provide: RISK_CATEGORY_REPOSITORY,
      useClass: RiskCategoryRepositoryImpl,
    },
    {
      provide: SUPPLIER_REPOSITORY,
      useClass: SupplierRepositoryImpl,
    },
    {
      provide: PRODUCT_REPOSITORY,
      useClass: ProductRepositoryImpl,
    },
    {
      provide: DEMAND_DATA_REPOSITORY,
      useClass: DemandDataRepositoryImpl,
    },
    {
      provide: REPORT_CALENDAR_REPOSITORY,
      useClass: ReportCalendarRepositoryImpl,
    },
    {
      provide: INTEREST_MATRIX_ROW_REPOSITORY,
      useClass: InterestMatrixRowRepositoryImpl,
    },
    {
      provide: ASIS_MEMO_REPOSITORY,
      useClass: AsisMemoRepositoryImpl,
    },
    {
      provide: TOBE_VISION_REPOSITORY,
      useClass: TobeVisionRepositoryImpl,
    },
    {
      provide: TOBE_ROADMAP_REPOSITORY,
      useClass: TobeRoadmapRepositoryImpl,
    },
    {
      provide: ROADMAP_PHASE_REPOSITORY,
      useClass: RoadmapPhaseRepositoryImpl,
    },
    {
      provide: KPI_REPOSITORY,
      useClass: KpiRepositoryImpl,
    },
    // ========== Knowledge Graph Batch Ingestion ==========
    {
      provide: INGESTION_BATCH_REPOSITORY,
      useClass: IngestionBatchRepositoryImpl,
    },
    {
      provide: INGESTION_FILE_REPOSITORY,
      useClass: IngestionFileRepositoryImpl,
    },
    {
      provide: KNOWLEDGE_REPOSITORY,
      useClass: KnowledgeRepositoryImpl,
    },
    {
      provide: PROJECT_KNOWLEDGE_SETTINGS_REPOSITORY,
      useClass: ProjectKnowledgeSettingsRepositoryImpl,
    },

    // ========== Use Cases ==========
    RegisterUserUseCase,
    LoginUserUseCase,
    GetCurrentUserUseCase,
    CreateOrganizationUseCase,
    GetOrganizationsUseCase,
    CreateProjectUseCase,
    GetProjectsUseCase,
    CreateRoleUseCase,
    GetRolesUseCase,
    UpdateRoleUseCase,
    // ProjectPhase
    CreatePhaseUseCase,
    GetPhasesUseCase,
    GetPhaseUseCase,
    InitializePhasesUseCase,
    UpdatePhaseUseCase,
    TransitionPhaseUseCase,
    DeletePhaseUseCase,
    // GapItem
    CreateGapItemUseCase,
    GetGapItemsUseCase,
    GetGapItemUseCase,
    UpdateGapItemUseCase,
    ResolveGapItemUseCase,
    ReopenGapItemUseCase,
    DeleteGapItemUseCase,
    // IssueTree
    CreateIssueTreeUseCase,
    GetIssueTreesUseCase,
    GetIssueTreeUseCase,
    UpdateIssueTreeUseCase,
    DeleteIssueTreeUseCase,
    AddIssueNodeUseCase,
    UpdateIssueNodeUseCase,
    DeleteIssueNodeUseCase,
    SetNodeVerificationUseCase,
    ListProjectIssueNodesUseCase,
    // FlowFolder
    CreateFlowFolderUseCase,
    GetFlowFoldersUseCase,
    RenameFlowFolderUseCase,
    MoveFlowFolderUseCase,
    DeleteFlowFolderUseCase,
    // FlowDefinition
    GetFlowDefinitionUseCase,
    UpsertFlowDefinitionUseCase,
    ListFlowDefinitionsUseCase,
    // FlowNodeLink
    CreateNodeLinkUseCase,
    GetNodeLinksUseCase,
    DeleteNodeLinkUseCase,
    // FlowNode child-flow drill-down
    CreateNodeChildFlowUseCase,
    // FlowTree (project-wide hierarchy map)
    GetFlowTreeUseCase,
    // Task
    CreateTaskUseCase,
    GetTasksUseCase,
    GetTaskUseCase,
    UpdateTaskUseCase,
    DeleteTaskUseCase,
    AddTaskDependencyUseCase,
    RemoveTaskDependencyUseCase,
    ImportBacklogTasksUseCase,
    ImportJiraTasksUseCase,
    // 外部トラッカー Webhook 秘密の管理
    ManageTrackerWebhookUseCase,
    // 外部トラッカー Webhook 受信処理
    ProcessTrackerWebhookUseCase,
    // AI使用量サマリ
    GetLlmUsageSummaryUseCase,
    // Task Comment
    CreateTaskCommentUseCase,
    GetTaskCommentsUseCase,
    UpdateTaskCommentUseCase,
    DeleteTaskCommentUseCase,
    // DFD
    GetFlowDfdUseCase,
    GenerateFlowDfdUseCase,
    GetProjectDfdUseCase,
    GenerateProjectDfdUseCase,
    AddDfdNodeUseCase,
    UpdateDfdNodeUseCase,
    DeleteDfdNodeUseCase,
    AddDfdFlowUseCase,
    UpdateDfdFlowUseCase,
    DeleteDfdFlowUseCase,
    SaveDfdPositionsUseCase,
    // DataObject（オブジェクト関係性マップ・ER図）
    GetObjectGraphUseCase,
    CreateDataObjectUseCase,
    UpdateDataObjectUseCase,
    UpdateDataObjectSubProjectUseCase,
    DeleteDataObjectUseCase,
    CreateObjectRelationUseCase,
    UpdateObjectRelationUseCase,
    DeleteObjectRelationUseCase,
    SaveObjectPositionsUseCase,
    ImportFromDfdUseCase,
    ImportMermaidUseCase,
    GetErGraphUseCase,
    LinkTableToObjectUseCase,
    SaveErPositionsUseCase,
    // InformationType
    GetInformationTypesUseCase,
    CreateInformationTypeUseCase,
    UpdateInformationTypeUseCase,
    DeleteInformationTypeUseCase,
    // System
    GetSystemsUseCase,
    CreateSystemUseCase,
    UpdateSystemUseCase,
    DeleteSystemUseCase,
    // Constraint
    GetConstraintsUseCase,
    CreateConstraintUseCase,
    UpdateConstraintUseCase,
    DeleteConstraintUseCase,
    // Stakeholder
    CreateStakeholderUseCase,
    GetStakeholdersUseCase,
    UpdateStakeholderUseCase,
    DeleteStakeholderUseCase,
    // Meeting
    CreateMeetingUseCase,
    GetMeetingsUseCase,
    UpdateMeetingUseCase,
    DeleteMeetingUseCase,
    SetMeetingStakeholdersUseCase,
    SetMeetingSubProjectsUseCase,
    // Risk
    CreateRiskUseCase,
    GetRisksUseCase,
    UpdateRiskUseCase,
    DeleteRiskUseCase,
    // RiskCategory
    CreateRiskCategoryUseCase,
    GetRiskCategoriesUseCase,
    UpdateRiskCategoryUseCase,
    DeleteRiskCategoryUseCase,
    // Supplier
    CreateSupplierUseCase,
    GetSuppliersUseCase,
    UpdateSupplierUseCase,
    DeleteSupplierUseCase,
    // Product
    CreateProductUseCase,
    GetProductsUseCase,
    UpdateProductUseCase,
    DeleteProductUseCase,
    // DemandData
    CreateDemandDataUseCase,
    GetDemandDataUseCase,
    UpdateDemandDataUseCase,
    DeleteDemandDataUseCase,
    // ReportCalendar
    CreateReportCalendarUseCase,
    GetReportCalendarsUseCase,
    UpdateReportCalendarUseCase,
    DeleteReportCalendarUseCase,
    // InterestMatrixRow
    CreateInterestMatrixRowUseCase,
    GetInterestMatrixRowsUseCase,
    UpdateInterestMatrixRowUseCase,
    DeleteInterestMatrixRowUseCase,
    // AsisMemo
    CreateAsisMemoUseCase,
    GetAsisMemosUseCase,
    UpdateAsisMemoUseCase,
    DeleteAsisMemoUseCase,
    // TobeVision
    CreateTobeVisionUseCase,
    GetTobeVisionsUseCase,
    UpdateTobeVisionUseCase,
    DeleteTobeVisionUseCase,
    // TobeRoadmap
    CreateTobeRoadmapUseCase,
    GetTobeRoadmapsUseCase,
    UpdateTobeRoadmapUseCase,
    DeleteTobeRoadmapUseCase,
    // RoadmapPhase
    CreateRoadmapPhaseUseCase,
    GetRoadmapPhasesUseCase,
    UpdateRoadmapPhaseUseCase,
    DeleteRoadmapPhaseUseCase,
    // KPI（業務KPI・AI精度KPI）
    ListKpisUseCase,
    CreateKpiUseCase,
    UpdateKpiUseCase,
    DeleteKpiUseCase,
    SetKpiInformationTypesUseCase,
    GetFlowIoSummaryUseCase,
    GenerateKpisUseCase,
    // Ingestion（取り込みバッチ/ファイル）
    CreateIngestionBatchUseCase,
    GetIngestionBatchesUseCase,
    GetAllAccessibleIngestionBatchesUseCase,
    GetIngestionBatchDetailUseCase,
    ResumeBatchUseCase,
    CancelBatchUseCase,
    RetryFileUseCase,
    SkipFileUseCase,
    // Knowledge（ナレッジグラフ read + node/document/relation 編集）
    GetKnowledgeGraphUseCase,
    GetKnowledgeNodeUseCase,
    SearchKnowledgeUseCase,
    UpdateKnowledgeNodeUseCase,
    DeleteKnowledgeNodeUseCase,
    MergeKnowledgeNodesUseCase,
    UpdateDocumentPositionUseCase,
    UpdateKnowledgeDocumentUseCase,
    DeleteKnowledgeDocumentUseCase,
    UpdateKnowledgeRelationUseCase,
    DeleteKnowledgeRelationUseCase,
    // KnowledgeSettings（課金ガード設定）
    GetOrCreateSettingsUseCase,
    UpdateSettingsUseCase,

    // ========== Services ==========
    ProjectAccessService,
    // Liveblocks プレゼンス（トークン発行ユースケース + SDK ラッパ）
    IssueLiveblocksTokenUseCase,
    LiveblocksTokenService,
    ProjectBundleService,
    EntityJsonService,
    ClaudeService,
    ApiKeyService,
    CryptoService,
    CompanyKeyService,
    GithubService,
    CodeExtractionService,
    LlmUsageRecorder,
    AttachmentRegisterService,
    SyncService,
    SyncSchedulerService,
    QStashService,
    JobService,
    TaskWebhookService,
    TrackerImportService,
    // ナレッジグラフ バッチ取り込み（Blob 保管 / 型別抽出 / 1ファイルパイプライン）
    BlobStorageService,
    FileExtractionService,
    KnowledgeIngestionService,
    // Google Drive ソースアダプタ（Phase 3）
    DriveService,

    // ========== Global Guards ==========
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    // ========== Global Filters ==========
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },

    // ========== Global Interceptors ==========
    // 書き込み系リクエストの自動変更履歴（fire-and-forget で ChangeLog に記録）
    {
      provide: APP_INTERCEPTOR,
      useClass: ChangeLogInterceptor,
    },
  ],
})
export class AppModule {}
