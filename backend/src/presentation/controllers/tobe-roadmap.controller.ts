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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsInt } from 'class-validator';
import {
  CreateTobeRoadmapUseCase,
  GetTobeRoadmapsUseCase,
  UpdateTobeRoadmapUseCase,
  DeleteTobeRoadmapUseCase,
  TobeRoadmapOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateTobeRoadmapDto {
  @ApiPropertyOptional({ description: 'フェーズ' })
  @IsOptional()
  @IsString()
  phase?: string | null;

  @ApiPropertyOptional({ description: '施策' })
  @IsOptional()
  @IsString()
  measure?: string | null;

  @ApiPropertyOptional({ description: 'ROI' })
  @IsOptional()
  @IsString()
  roi?: string | null;

  @ApiPropertyOptional({ description: 'コスト' })
  @IsOptional()
  @IsString()
  cost?: string | null;

  @ApiPropertyOptional({ description: '回収期間' })
  @IsOptional()
  @IsString()
  payback?: string | null;

  @ApiPropertyOptional({ description: '範囲' })
  @IsOptional()
  @IsString()
  scope?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ description: '領域（サブプロジェクト）ID', nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiPropertyOptional({ description: '元になったTOBEビジョンID', nullable: true })
  @IsOptional()
  @IsString()
  tobeVisionId?: string | null;
}

class UpdateTobeRoadmapDto {
  @ApiPropertyOptional({ description: 'フェーズ' })
  @IsOptional()
  @IsString()
  phase?: string | null;

  @ApiPropertyOptional({ description: '施策' })
  @IsOptional()
  @IsString()
  measure?: string | null;

  @ApiPropertyOptional({ description: 'ROI' })
  @IsOptional()
  @IsString()
  roi?: string | null;

  @ApiPropertyOptional({ description: 'コスト' })
  @IsOptional()
  @IsString()
  cost?: string | null;

  @ApiPropertyOptional({ description: '回収期間' })
  @IsOptional()
  @IsString()
  payback?: string | null;

  @ApiPropertyOptional({ description: '範囲' })
  @IsOptional()
  @IsString()
  scope?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ description: '領域（サブプロジェクト）ID', nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiPropertyOptional({ description: '元になったTOBEビジョンID', nullable: true })
  @IsOptional()
  @IsString()
  tobeVisionId?: string | null;
}

@ApiTags('TOBEロードマップ')
@ApiBearerAuth()
@Controller('projects/:projectId/tobe-roadmaps')
export class TobeRoadmapController {
  constructor(
    private readonly createTobeRoadmapUseCase: CreateTobeRoadmapUseCase,
    private readonly getTobeRoadmapsUseCase: GetTobeRoadmapsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'TOBEロードマップ一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<TobeRoadmapOutput[]> {
    return this.getTobeRoadmapsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'TOBEロードマップ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateTobeRoadmapDto,
  ): Promise<TobeRoadmapOutput> {
    return this.createTobeRoadmapUseCase.execute({
      userId: user.id,
      projectId,
      phase: dto.phase,
      measure: dto.measure,
      roi: dto.roi,
      cost: dto.cost,
      payback: dto.payback,
      scope: dto.scope,
      order: dto.order,
      subProjectId: dto.subProjectId,
      tobeVisionId: dto.tobeVisionId,
    });
  }
}

@ApiTags('TOBEロードマップ')
@ApiBearerAuth()
@Controller('tobe-roadmaps')
export class TobeRoadmapByIdController {
  constructor(
    private readonly updateTobeRoadmapUseCase: UpdateTobeRoadmapUseCase,
    private readonly deleteTobeRoadmapUseCase: DeleteTobeRoadmapUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'TOBEロードマップ更新' })
  @ApiParam({ name: 'id', description: 'TOBEロードマップID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'TOBEロードマップが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTobeRoadmapDto,
  ): Promise<TobeRoadmapOutput> {
    return this.updateTobeRoadmapUseCase.execute({
      userId: user.id,
      id,
      phase: dto.phase,
      measure: dto.measure,
      roi: dto.roi,
      cost: dto.cost,
      payback: dto.payback,
      scope: dto.scope,
      order: dto.order,
      subProjectId: dto.subProjectId,
      tobeVisionId: dto.tobeVisionId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'TOBEロードマップ削除' })
  @ApiParam({ name: 'id', description: 'TOBEロードマップID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'TOBEロードマップが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteTobeRoadmapUseCase.execute({
      userId: user.id,
      id,
    });
    return { success: true };
  }
}
