import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { CreatePhaseUseCase } from '../../application/use-cases/project-phase/create-phase.use-case';
import { GetPhasesUseCase } from '../../application/use-cases/project-phase/get-phases.use-case';
import { GetPhaseUseCase } from '../../application/use-cases/project-phase/get-phase.use-case';
import { InitializePhasesUseCase } from '../../application/use-cases/project-phase/initialize-phases.use-case';
import { UpdatePhaseUseCase } from '../../application/use-cases/project-phase/update-phase.use-case';
import { TransitionPhaseUseCase } from '../../application/use-cases/project-phase/transition-phase.use-case';
import { DeletePhaseUseCase } from '../../application/use-cases/project-phase/delete-phase.use-case';
import {
  CreatePhaseRequestDto,
  PhaseResponseDto,
} from '../dto/project-phase/create-phase.dto';
import { UpdatePhaseRequestDto } from '../dto/project-phase/update-phase.dto';
import { TransitionPhaseRequestDto } from '../dto/project-phase/transition-phase.dto';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('プロジェクトフェーズ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/phases')
export class ProjectPhaseController {
  constructor(
    private readonly createPhaseUseCase: CreatePhaseUseCase,
    private readonly getPhasesUseCase: GetPhasesUseCase,
    private readonly initializePhasesUseCase: InitializePhasesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトのフェーズ一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '成功', type: [PhaseResponseDto] })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<PhaseResponseDto[]> {
    return this.getPhasesUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'フェーズ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功', type: PhaseResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  @ApiResponse({ status: 409, description: 'フェーズ種別が既に存在します' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreatePhaseRequestDto,
  ): Promise<PhaseResponseDto> {
    return this.createPhaseUseCase.execute({
      userId: user.id,
      projectId,
      kind: dto.kind,
      order: dto.order,
      status: dto.status,
      summary: dto.summary,
      metadata: dto.metadata,
    });
  }

  @Post('initialize')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'カノニカルな全8フェーズ（Ph.0〜7）を初期化（冪等）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '初期化成功', type: [PhaseResponseDto] })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async initialize(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<PhaseResponseDto[]> {
    return this.initializePhasesUseCase.execute({
      userId: user.id,
      projectId,
    });
  }
}

@ApiTags('プロジェクトフェーズ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('phases')
export class PhaseByIdController {
  constructor(
    private readonly getPhaseUseCase: GetPhaseUseCase,
    private readonly updatePhaseUseCase: UpdatePhaseUseCase,
    private readonly transitionPhaseUseCase: TransitionPhaseUseCase,
    private readonly deletePhaseUseCase: DeletePhaseUseCase,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'フェーズ詳細取得' })
  @ApiParam({ name: 'id', description: 'フェーズID' })
  @ApiResponse({ status: 200, description: '成功', type: PhaseResponseDto })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'フェーズが見つかりません' })
  async findById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<PhaseResponseDto> {
    return this.getPhaseUseCase.execute({
      userId: user.id,
      phaseId: id,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'フェーズ更新（summary / status / order）' })
  @ApiParam({ name: 'id', description: 'フェーズID' })
  @ApiResponse({ status: 200, description: '更新成功', type: PhaseResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'フェーズが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePhaseRequestDto,
  ): Promise<PhaseResponseDto> {
    return this.updatePhaseUseCase.execute({
      userId: user.id,
      principal: user,
      phaseId: id,
      status: dto.status,
      order: dto.order,
      summary: dto.summary,
      detail: dto.detail,
    });
  }

  @Post(':id/transition')
  @ApiOperation({ summary: 'フェーズ状態遷移' })
  @ApiParam({ name: 'id', description: 'フェーズID' })
  @ApiResponse({ status: 200, description: '遷移成功', type: PhaseResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'フェーズが見つかりません' })
  async transition(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: TransitionPhaseRequestDto,
  ): Promise<PhaseResponseDto> {
    return this.transitionPhaseUseCase.execute({
      userId: user.id,
      principal: user,
      phaseId: id,
      status: dto.status,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'フェーズ削除' })
  @ApiParam({ name: 'id', description: 'フェーズID' })
  @ApiResponse({ status: 204, description: '削除成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'フェーズが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.deletePhaseUseCase.execute({
      userId: user.id,
      principal: user,
      phaseId: id,
    });
  }
}
