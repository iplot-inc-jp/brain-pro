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
  CreateProductUseCase,
  GetProductsUseCase,
  UpdateProductUseCase,
  DeleteProductUseCase,
  ProductOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateProductDto {
  @ApiPropertyOptional({ description: '商品コード' })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ description: '商品名' })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiPropertyOptional({ description: '仕入先ID（FK）' })
  @IsOptional()
  @IsString()
  supplierId?: string | null;

  @ApiPropertyOptional({ description: '仕入先（フリーテキスト）' })
  @IsOptional()
  @IsString()
  supplierName?: string | null;

  @ApiPropertyOptional({ description: '最小ロット（個）' })
  @IsOptional()
  @IsInt()
  minLot?: number | null;

  @ApiPropertyOptional({ description: '単価（円）' })
  @IsOptional()
  @IsInt()
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateProductDto {
  @ApiPropertyOptional({ description: '商品コード' })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ description: '商品名' })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiPropertyOptional({ description: '仕入先ID（FK）' })
  @IsOptional()
  @IsString()
  supplierId?: string | null;

  @ApiPropertyOptional({ description: '仕入先（フリーテキスト）' })
  @IsOptional()
  @IsString()
  supplierName?: string | null;

  @ApiPropertyOptional({ description: '最小ロット（個）' })
  @IsOptional()
  @IsInt()
  minLot?: number | null;

  @ApiPropertyOptional({ description: '単価（円）' })
  @IsOptional()
  @IsInt()
  unitPrice?: number | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('商品マスタ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/products')
export class ProductController {
  constructor(
    private readonly createProductUseCase: CreateProductUseCase,
    private readonly getProductsUseCase: GetProductsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: '商品一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<ProductOutput[]> {
    return this.getProductsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '商品作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProductDto,
  ): Promise<ProductOutput> {
    return this.createProductUseCase.execute({
      userId: user.id,
      projectId,
      code: dto.code,
      name: dto.name,
      supplierId: dto.supplierId,
      supplierName: dto.supplierName,
      minLot: dto.minLot,
      unitPrice: dto.unitPrice,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('商品マスタ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('products')
export class ProductByIdController {
  constructor(
    private readonly updateProductUseCase: UpdateProductUseCase,
    private readonly deleteProductUseCase: DeleteProductUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '商品更新' })
  @ApiParam({ name: 'id', description: '商品ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '商品が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductOutput> {
    return this.updateProductUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      code: dto.code,
      name: dto.name,
      supplierId: dto.supplierId,
      supplierName: dto.supplierName,
      minLot: dto.minLot,
      unitPrice: dto.unitPrice,
      note: dto.note,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '商品削除' })
  @ApiParam({ name: 'id', description: '商品ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '商品が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteProductUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
    return { success: true };
  }
}
