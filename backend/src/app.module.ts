import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
  JwtAuthGuard,
  DomainExceptionFilter,
} from './presentation';
import { HealthController } from './presentation/controllers/health.controller';
import { RequirementController } from './presentation/controllers/requirement.controller';
import { UserSettingsController } from './presentation/controllers/user-settings.controller';
import { ApiKeyController } from './presentation/controllers/api-key.controller';
import { GithubConnectionController } from './presentation/controllers/github-connection.controller';
import { CodeCatalogController } from './presentation/controllers/code-catalog.controller';
import { DatabaseConnectionController } from './presentation/controllers/database-connection.controller';
import { AttachmentController } from './presentation/controllers/attachment.controller';
import { SubProjectController } from './presentation/controllers/sub-project.controller';
import { RecordSheetController } from './presentation/controllers/record-sheet.controller';
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
    RecordSheetController,
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
  ],
})
export class AppModule {}
