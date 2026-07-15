import {
  Controller,
  Get,
  Post,
  Patch,
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
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsInt } from 'class-validator';
import {
  CreateRoadmapPhaseUseCase,
  GetRoadmapPhasesUseCase,
  UpdateRoadmapPhaseUseCase,
  DeleteRoadmapPhaseUseCase,
  RoadmapPhaseOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateRoadmapPhaseDto {
  @ApiProperty({ description: 'フェーズ名', example: '5年以内 (Phase4)' })
  @IsString()
  name: string;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateRoadmapPhaseDto {
  @ApiProperty({ description: 'フェーズ名', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('ロードマップフェーズ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/roadmap-phases')
export class RoadmapPhaseController {
  constructor(
    private readonly createRoadmapPhaseUseCase: CreateRoadmapPhaseUseCase,
    private readonly getRoadmapPhasesUseCase: GetRoadmapPhasesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'プロジェクトのロードマップフェーズ一覧取得（0件なら初期3フェーズをシード）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<RoadmapPhaseOutput[]> {
    return this.getRoadmapPhasesUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ロードマップフェーズ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateRoadmapPhaseDto,
  ): Promise<RoadmapPhaseOutput> {
    return this.createRoadmapPhaseUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      order: dto.order,
    });
  }
}

@ApiTags('ロードマップフェーズ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('roadmap-phases')
export class RoadmapPhaseByIdController {
  constructor(
    private readonly updateRoadmapPhaseUseCase: UpdateRoadmapPhaseUseCase,
    private readonly deleteRoadmapPhaseUseCase: DeleteRoadmapPhaseUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'ロードマップフェーズ更新（改名・並べ替え）' })
  @ApiParam({ name: 'id', description: 'ロードマップフェーズID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ロードマップフェーズが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRoadmapPhaseDto,
  ): Promise<RoadmapPhaseOutput> {
    return this.updateRoadmapPhaseUseCase.execute({
      userId: user.id,
      principal: user,
      roadmapPhaseId: id,
      name: dto.name,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ロードマップフェーズ削除' })
  @ApiParam({ name: 'id', description: 'ロードマップフェーズID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ロードマップフェーズが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteRoadmapPhaseUseCase.execute({
      userId: user.id,
      principal: user,
      roadmapPhaseId: id,
    });
    return { success: true };
  }
}
