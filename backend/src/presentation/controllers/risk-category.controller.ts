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
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsInt } from 'class-validator';
import {
  CreateRiskCategoryUseCase,
  GetRiskCategoriesUseCase,
  UpdateRiskCategoryUseCase,
  DeleteRiskCategoryUseCase,
  RiskCategoryOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateRiskCategoryDto {
  @ApiProperty({ description: 'カテゴリ名', example: '技術' })
  @IsString()
  name: string;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateRiskCategoryDto {
  @ApiProperty({ description: 'カテゴリ名', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('リスクカテゴリ（RBS）')
@ApiBearerAuth()
@Controller('projects/:projectId/risk-categories')
export class RiskCategoryController {
  constructor(
    private readonly createRiskCategoryUseCase: CreateRiskCategoryUseCase,
    private readonly getRiskCategoriesUseCase: GetRiskCategoriesUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'プロジェクトのリスクカテゴリ一覧取得（0件なら PMBOK RBS 初期カテゴリをシード）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<RiskCategoryOutput[]> {
    return this.getRiskCategoriesUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'リスクカテゴリ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateRiskCategoryDto,
  ): Promise<RiskCategoryOutput> {
    return this.createRiskCategoryUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      order: dto.order,
    });
  }
}

@ApiTags('リスクカテゴリ（RBS）')
@ApiBearerAuth()
@Controller('risk-categories')
export class RiskCategoryByIdController {
  constructor(
    private readonly updateRiskCategoryUseCase: UpdateRiskCategoryUseCase,
    private readonly deleteRiskCategoryUseCase: DeleteRiskCategoryUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'リスクカテゴリ更新（改名・並べ替え）' })
  @ApiParam({ name: 'id', description: 'リスクカテゴリID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'リスクカテゴリが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRiskCategoryDto,
  ): Promise<RiskCategoryOutput> {
    return this.updateRiskCategoryUseCase.execute({
      userId: user.id,
      riskCategoryId: id,
      name: dto.name,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'リスクカテゴリ削除（紐付くリスクは未分類に戻る）',
  })
  @ApiParam({ name: 'id', description: 'リスクカテゴリID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'リスクカテゴリが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteRiskCategoryUseCase.execute({
      userId: user.id,
      riskCategoryId: id,
    });
    return { success: true };
  }
}
