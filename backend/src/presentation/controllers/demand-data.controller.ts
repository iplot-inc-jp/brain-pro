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
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsInt } from 'class-validator';
import {
  CreateDemandDataUseCase,
  GetDemandDataUseCase,
  UpdateDemandDataUseCase,
  DeleteDemandDataUseCase,
  DemandDataOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateDemandDataDto {
  @ApiPropertyOptional({ description: '商品' })
  @IsOptional()
  @IsString()
  productName?: string | null;

  @ApiPropertyOptional({ description: '期間（月/年月）' })
  @IsOptional()
  @IsString()
  period?: string | null;

  @ApiPropertyOptional({ description: '需要数' })
  @IsOptional()
  @IsInt()
  quantity?: number | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateDemandDataDto {
  @ApiPropertyOptional({ description: '商品' })
  @IsOptional()
  @IsString()
  productName?: string | null;

  @ApiPropertyOptional({ description: '期間（月/年月）' })
  @IsOptional()
  @IsString()
  period?: string | null;

  @ApiPropertyOptional({ description: '需要数' })
  @IsOptional()
  @IsInt()
  quantity?: number | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('過去需要データ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/demand-data')
export class DemandDataController {
  constructor(
    private readonly createDemandDataUseCase: CreateDemandDataUseCase,
    private readonly getDemandDataUseCase: GetDemandDataUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: '需要データ一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<DemandDataOutput[]> {
    return this.getDemandDataUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '需要データ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDemandDataDto,
  ): Promise<DemandDataOutput> {
    return this.createDemandDataUseCase.execute({
      userId: user.id,
      projectId,
      productName: dto.productName,
      period: dto.period,
      quantity: dto.quantity,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('過去需要データ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('demand-data')
export class DemandDataByIdController {
  constructor(
    private readonly updateDemandDataUseCase: UpdateDemandDataUseCase,
    private readonly deleteDemandDataUseCase: DeleteDemandDataUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '需要データ更新' })
  @ApiParam({ name: 'id', description: '需要データID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '需要データが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDemandDataDto,
  ): Promise<DemandDataOutput> {
    return this.updateDemandDataUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      productName: dto.productName,
      period: dto.period,
      quantity: dto.quantity,
      note: dto.note,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '需要データ削除' })
  @ApiParam({ name: 'id', description: '需要データID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '需要データが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteDemandDataUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
    return { success: true };
  }
}
