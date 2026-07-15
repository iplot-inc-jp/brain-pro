import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import {
  CreateGapItemUseCase,
  GetGapItemsUseCase,
  GetGapItemUseCase,
  UpdateGapItemUseCase,
  ResolveGapItemUseCase,
  ReopenGapItemUseCase,
  DeleteGapItemUseCase,
} from '../../application';
import {
  CreateGapItemRequestDto,
  UpdateGapItemRequestDto,
  GapItemResponseDto,
} from '../dto';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

@ApiTags('GAP')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/gap-items')
export class GapItemController {
  constructor(
    private readonly createGapItemUseCase: CreateGapItemUseCase,
    private readonly getGapItemsUseCase: GetGapItemsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'GAP一覧取得（プロジェクト内、フィルタ可能）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({ name: 'phaseId', required: false, description: 'フェーズIDで絞り込み' })
  @ApiQuery({
    name: 'priority',
    required: false,
    enum: ['HIGH', 'MEDIUM', 'LOW'],
    description: '優先度で絞り込み',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['OPEN', 'RESOLVED'],
    description: 'ステータスで絞り込み',
  })
  @ApiResponse({ status: 200, description: '成功', type: [GapItemResponseDto] })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async findAll(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('phaseId') phaseId?: string,
    @Query('priority') priority?: 'HIGH' | 'MEDIUM' | 'LOW',
    @Query('status') status?: 'OPEN' | 'RESOLVED',
  ): Promise<GapItemResponseDto[]> {
    return this.getGapItemsUseCase.execute({
      userId: user.id,
      projectId,
      phaseId,
      priority,
      status,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'GAP作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功', type: GapItemResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateGapItemRequestDto,
  ): Promise<GapItemResponseDto> {
    return this.createGapItemUseCase.execute({
      userId: user.id,
      projectId,
      phaseId: dto.phaseId,
      businessArea: dto.businessArea,
      asisDescription: dto.asisDescription,
      tobeDescription: dto.tobeDescription,
      gapDescription: dto.gapDescription,
      priority: dto.priority,
      ownerName: dto.ownerName,
      order: dto.order,
      asisFlowId: dto.asisFlowId,
      asisNodeId: dto.asisNodeId,
      tobeFlowId: dto.tobeFlowId,
      tobeNodeId: dto.tobeNodeId,
      issueTreeId: dto.issueTreeId,
    });
  }
}

@ApiTags('GAP')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('gap-items')
export class GapItemByIdController {
  constructor(
    private readonly getGapItemUseCase: GetGapItemUseCase,
    private readonly updateGapItemUseCase: UpdateGapItemUseCase,
    private readonly resolveGapItemUseCase: ResolveGapItemUseCase,
    private readonly reopenGapItemUseCase: ReopenGapItemUseCase,
    private readonly deleteGapItemUseCase: DeleteGapItemUseCase,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'GAP詳細取得' })
  @ApiParam({ name: 'id', description: 'GAP ID' })
  @ApiResponse({ status: 200, description: '成功', type: GapItemResponseDto })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'GAPが見つかりません' })
  async findById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<GapItemResponseDto> {
    return this.getGapItemUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
  }

  @Put(':id')
  @ApiOperation({ summary: 'GAP更新' })
  @ApiParam({ name: 'id', description: 'GAP ID' })
  @ApiResponse({ status: 200, description: '更新成功', type: GapItemResponseDto })
  @ApiResponse({ status: 400, description: 'バリデーションエラー' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'GAPが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGapItemRequestDto,
  ): Promise<GapItemResponseDto> {
    return this.updateGapItemUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      businessArea: dto.businessArea,
      phaseId: dto.phaseId,
      asisDescription: dto.asisDescription,
      tobeDescription: dto.tobeDescription,
      gapDescription: dto.gapDescription,
      priority: dto.priority,
      ownerName: dto.ownerName,
      order: dto.order,
      outOfScope: dto.outOfScope,
      asisFlowId: dto.asisFlowId,
      asisNodeId: dto.asisNodeId,
      tobeFlowId: dto.tobeFlowId,
      tobeNodeId: dto.tobeNodeId,
      issueTreeId: dto.issueTreeId,
    });
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'GAP解決（status -> RESOLVED）' })
  @ApiParam({ name: 'id', description: 'GAP ID' })
  @ApiResponse({ status: 200, description: '解決成功', type: GapItemResponseDto })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'GAPが見つかりません' })
  async resolve(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<GapItemResponseDto> {
    return this.resolveGapItemUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'GAP再オープン（status -> OPEN）' })
  @ApiParam({ name: 'id', description: 'GAP ID' })
  @ApiResponse({ status: 200, description: '再オープン成功', type: GapItemResponseDto })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'GAPが見つかりません' })
  async reopen(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<GapItemResponseDto> {
    return this.reopenGapItemUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'GAP削除' })
  @ApiParam({ name: 'id', description: 'GAP ID' })
  @ApiResponse({ status: 204, description: '削除成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'GAPが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    await this.deleteGapItemUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
  }
}
