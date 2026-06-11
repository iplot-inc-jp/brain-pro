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
  CreateTobeVisionUseCase,
  GetTobeVisionsUseCase,
  UpdateTobeVisionUseCase,
  DeleteTobeVisionUseCase,
  TobeVisionOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateTobeVisionDto {
  @ApiPropertyOptional({ description: '領域' })
  @IsOptional()
  @IsString()
  area?: string | null;

  @ApiPropertyOptional({ description: 'ビジョン・あるべき姿' })
  @IsOptional()
  @IsString()
  vision?: string | null;

  @ApiPropertyOptional({ description: '施策・対応' })
  @IsOptional()
  @IsString()
  countermeasure?: string | null;

  @ApiPropertyOptional({ description: '効果' })
  @IsOptional()
  @IsString()
  effect?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ description: '領域（サブプロジェクト）ID', nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

class UpdateTobeVisionDto {
  @ApiPropertyOptional({ description: '領域' })
  @IsOptional()
  @IsString()
  area?: string | null;

  @ApiPropertyOptional({ description: 'ビジョン・あるべき姿' })
  @IsOptional()
  @IsString()
  vision?: string | null;

  @ApiPropertyOptional({ description: '施策・対応' })
  @IsOptional()
  @IsString()
  countermeasure?: string | null;

  @ApiPropertyOptional({ description: '効果' })
  @IsOptional()
  @IsString()
  effect?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiPropertyOptional({ description: '領域（サブプロジェクト）ID', nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

@ApiTags('TOBEビジョン')
@ApiBearerAuth()
@Controller('projects/:projectId/tobe-visions')
export class TobeVisionController {
  constructor(
    private readonly createTobeVisionUseCase: CreateTobeVisionUseCase,
    private readonly getTobeVisionsUseCase: GetTobeVisionsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'TOBEビジョン一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<TobeVisionOutput[]> {
    return this.getTobeVisionsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'TOBEビジョン作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateTobeVisionDto,
  ): Promise<TobeVisionOutput> {
    return this.createTobeVisionUseCase.execute({
      userId: user.id,
      projectId,
      area: dto.area,
      vision: dto.vision,
      countermeasure: dto.countermeasure,
      effect: dto.effect,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }
}

@ApiTags('TOBEビジョン')
@ApiBearerAuth()
@Controller('tobe-visions')
export class TobeVisionByIdController {
  constructor(
    private readonly updateTobeVisionUseCase: UpdateTobeVisionUseCase,
    private readonly deleteTobeVisionUseCase: DeleteTobeVisionUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'TOBEビジョン更新' })
  @ApiParam({ name: 'id', description: 'TOBEビジョンID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'TOBEビジョンが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTobeVisionDto,
  ): Promise<TobeVisionOutput> {
    return this.updateTobeVisionUseCase.execute({
      userId: user.id,
      id,
      area: dto.area,
      vision: dto.vision,
      countermeasure: dto.countermeasure,
      effect: dto.effect,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'TOBEビジョン削除' })
  @ApiParam({ name: 'id', description: 'TOBEビジョンID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'TOBEビジョンが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteTobeVisionUseCase.execute({
      userId: user.id,
      id,
    });
    return { success: true };
  }
}
