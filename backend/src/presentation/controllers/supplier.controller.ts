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
  CreateSupplierUseCase,
  GetSuppliersUseCase,
  UpdateSupplierUseCase,
  DeleteSupplierUseCase,
  SupplierOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateSupplierDto {
  @ApiPropertyOptional({ description: '仕入先コード' })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ description: '仕入先名' })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiPropertyOptional({ description: '担当営業' })
  @IsOptional()
  @IsString()
  salesRep?: string | null;

  @ApiPropertyOptional({ description: '電話番号' })
  @IsOptional()
  @IsString()
  tel?: string | null;

  @ApiPropertyOptional({ description: 'メールアドレス' })
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiPropertyOptional({ description: 'リードタイム（日）' })
  @IsOptional()
  @IsInt()
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateSupplierDto {
  @ApiPropertyOptional({ description: '仕入先コード' })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ description: '仕入先名' })
  @IsOptional()
  @IsString()
  name?: string | null;

  @ApiPropertyOptional({ description: '担当営業' })
  @IsOptional()
  @IsString()
  salesRep?: string | null;

  @ApiPropertyOptional({ description: '電話番号' })
  @IsOptional()
  @IsString()
  tel?: string | null;

  @ApiPropertyOptional({ description: 'メールアドレス' })
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiPropertyOptional({ description: 'リードタイム（日）' })
  @IsOptional()
  @IsInt()
  leadTimeDays?: number | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('仕入先マスタ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/suppliers')
export class SupplierController {
  constructor(
    private readonly createSupplierUseCase: CreateSupplierUseCase,
    private readonly getSuppliersUseCase: GetSuppliersUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: '仕入先一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<SupplierOutput[]> {
    return this.getSuppliersUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '仕入先作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSupplierDto,
  ): Promise<SupplierOutput> {
    return this.createSupplierUseCase.execute({
      userId: user.id,
      projectId,
      code: dto.code,
      name: dto.name,
      salesRep: dto.salesRep,
      tel: dto.tel,
      email: dto.email,
      leadTimeDays: dto.leadTimeDays,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('仕入先マスタ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('suppliers')
export class SupplierByIdController {
  constructor(
    private readonly updateSupplierUseCase: UpdateSupplierUseCase,
    private readonly deleteSupplierUseCase: DeleteSupplierUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '仕入先更新' })
  @ApiParam({ name: 'id', description: '仕入先ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '仕入先が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<SupplierOutput> {
    return this.updateSupplierUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      code: dto.code,
      name: dto.name,
      salesRep: dto.salesRep,
      tel: dto.tel,
      email: dto.email,
      leadTimeDays: dto.leadTimeDays,
      note: dto.note,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '仕入先削除' })
  @ApiParam({ name: 'id', description: '仕入先ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '仕入先が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteSupplierUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
    return { success: true };
  }
}
