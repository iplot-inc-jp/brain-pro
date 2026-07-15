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
import { IsString, IsOptional, IsInt, IsIn } from 'class-validator';
import {
  CreateInformationTypeUseCase,
  GetInformationTypesUseCase,
  UpdateInformationTypeUseCase,
  DeleteInformationTypeUseCase,
  InformationTypeOutput,
} from '../../application';
import { InformationCategoryValue } from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

const INFORMATION_CATEGORIES = ['INFORMATION', 'OBJECT', 'DOCUMENT'];

// ========== DTOs ==========

class CreateInformationTypeDto {
  @ApiProperty({ description: '情報種別名', example: '受注書' })
  @IsString()
  name: string;

  @ApiProperty({
    description: '情報カテゴリ',
    required: false,
    enum: INFORMATION_CATEGORIES,
  })
  @IsOptional()
  @IsIn(INFORMATION_CATEGORIES)
  category?: InformationCategoryValue;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({
    description: '紐づくサブ領域ID（共通マスタ基盤。任意）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

class UpdateInformationTypeDto {
  @ApiProperty({ description: '情報種別名', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: '情報カテゴリ',
    required: false,
    enum: INFORMATION_CATEGORIES,
  })
  @IsOptional()
  @IsIn(INFORMATION_CATEGORIES)
  category?: InformationCategoryValue;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({
    description: '紐づくサブ領域ID（共通マスタ基盤。任意）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

@ApiTags('情報種別')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/information-types')
export class InformationTypeController {
  constructor(
    private readonly createInformationTypeUseCase: CreateInformationTypeUseCase,
    private readonly getInformationTypesUseCase: GetInformationTypesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトの情報種別一覧取得（添付件数付き）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<InformationTypeOutput[]> {
    return this.getInformationTypesUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '情報種別作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateInformationTypeDto,
  ): Promise<InformationTypeOutput> {
    return this.createInformationTypeUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      category: dto.category,
      description: dto.description,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }
}

@ApiTags('情報種別')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('information-types')
export class InformationTypeByIdController {
  constructor(
    private readonly updateInformationTypeUseCase: UpdateInformationTypeUseCase,
    private readonly deleteInformationTypeUseCase: DeleteInformationTypeUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '情報種別更新' })
  @ApiParam({ name: 'id', description: '情報種別ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '情報種別が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateInformationTypeDto,
  ): Promise<InformationTypeOutput> {
    return this.updateInformationTypeUseCase.execute({
      userId: user.id,
      principal: user,
      informationTypeId: id,
      name: dto.name,
      category: dto.category,
      description: dto.description,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '情報種別削除（具体帳票はカスケード削除）' })
  @ApiParam({ name: 'id', description: '情報種別ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '情報種別が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteInformationTypeUseCase.execute({
      userId: user.id,
      principal: user,
      informationTypeId: id,
    });
    return { success: true };
  }
}
