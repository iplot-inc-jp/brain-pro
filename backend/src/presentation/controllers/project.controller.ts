import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus, Inject,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import {
  CreateProjectUseCase,
  GetProjectsUseCase,
} from '../../application';
import {
  CreateProjectRequestDto,
  ProjectResponseDto,
} from '../dto';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import {
  PROJECT_REPOSITORY,
  ProjectRepository,
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
  ForbiddenError,
} from '../../domain';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('プロジェクト')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects')
export class ProjectByIdController {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'プロジェクト詳細取得' })
  @ApiParam({ name: 'id', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '成功', type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async findById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<ProjectResponseDto | null> {
    const project = await this.projectRepository.findById(id);
    if (!project) {
      return null;
    }
    // 組織メンバー（または全体管理者）のみ閲覧可。isMember は super-admin を許可する。
    const isMember = await this.organizationRepository.isMember(
      project.organizationId,
      user.id,
    );
    if (!isMember) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    return {
      id: project.id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }
}

@ApiTags('プロジェクト')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('organizations/:organizationId/projects')
export class ProjectController {
  constructor(
    private readonly createProjectUseCase: CreateProjectUseCase,
    private readonly getProjectsUseCase: GetProjectsUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'プロジェクト作成' })
  @ApiParam({ name: 'organizationId', description: '組織ID' })
  @ApiResponse({ status: 201, description: '作成成功', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 409, description: 'スラッグが既に使用されています' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateProjectRequestDto,
  ): Promise<ProjectResponseDto> {
    const result = await this.createProjectUseCase.execute({
      userId: user.id,
      principal: user,
      organizationId,
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
    });
    return result;
  }

  @Get()
  @ApiOperation({ summary: 'プロジェクト一覧取得' })
  @ApiParam({ name: 'organizationId', description: '組織ID' })
  @ApiResponse({ status: 200, description: '成功', type: [ProjectResponseDto] })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Param('organizationId') organizationId: string,
  ): Promise<ProjectResponseDto[]> {
    const result = await this.getProjectsUseCase.execute({
      userId: user.id,
      principal: user,
      organizationId,
    });
    return result;
  }
}

