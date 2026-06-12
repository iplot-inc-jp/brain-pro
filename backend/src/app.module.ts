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
  DeleteDataObjectUseCase,
  CreateObjectRelationUseCase,
  UpdateObjectRelationUseCase,
  DeleteObjectRelationUseCase,
  SaveObjectPositionsUseCase,
  ImportFromDfdUseCase,
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
  BcryptPasswordHashService,
  JwtTokenService,
} from './infrastructure';

// Presentation
import {
  AuthController,
  OrganizationController,
  ProjectController,
  ProjectByIdController,
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
  JwtAuthGuard,
  DomainExceptionFilter,
} from './presentation';
import { ChangeLogInterceptor } from './presentation/interceptors/change-log.interceptor';
import { HealthController } from './presentation/controllers/health.controller';
import { RequirementController } from './presentation/controllers/requirement.controller';
import { UserSettingsController } from './presentation/controllers/user-settings.controller';
import { ApiKeyController } from './presentation/controllers/api-key.controller';
import { GithubConnectionController } from './presentation/controllers/github-connection.controller';
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
import { SyncService } from './infrastructure/services/sync.service';
import { SyncSchedulerService } from './infrastructure/services/sync-scheduler.service';

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
    AuthController,
    OrganizationController,
    ProjectController,
    ProjectByIdController,
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
    DeleteDataObjectUseCase,
    CreateObjectRelationUseCase,
    UpdateObjectRelationUseCase,
    DeleteObjectRelationUseCase,
    SaveObjectPositionsUseCase,
    ImportFromDfdUseCase,
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

    // ========== Services ==========
    ClaudeService,
    ApiKeyService,
    CryptoService,
    CompanyKeyService,
    GithubService,
    CodeExtractionService,
    SyncService,
    SyncSchedulerService,

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
