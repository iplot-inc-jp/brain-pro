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
import { IsString, IsOptional, IsInt, IsIn } from 'class-validator';
import {
  CreateConstraintUseCase,
  GetConstraintsUseCase,
  UpdateConstraintUseCase,
  DeleteConstraintUseCase,
  ConstraintOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateConstraintDto {
  @ApiProperty({ description: '制約条件タイトル', example: '予算は1000万円以内' })
  @IsString()
  title: string;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ description: 'カテゴリ', required: false, nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({
    description: '種別（CONSTRAINT=制約 / ASSUMPTION=前提条件）',
    required: false,
    enum: ['CONSTRAINT', 'ASSUMPTION'],
  })
  @IsOptional()
  @IsIn(['CONSTRAINT', 'ASSUMPTION'])
  kind?: string;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

class UpdateConstraintDto {
  @ApiProperty({ description: '制約条件タイトル', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ description: 'カテゴリ', required: false, nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({
    description: '種別（CONSTRAINT=制約 / ASSUMPTION=前提条件）',
    required: false,
    enum: ['CONSTRAINT', 'ASSUMPTION'],
  })
  @IsOptional()
  @IsIn(['CONSTRAINT', 'ASSUMPTION'])
  kind?: string;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

@ApiTags('制約条件')
@ApiBearerAuth()
@Controller('projects/:projectId/constraints')
export class ConstraintController {
  constructor(
    private readonly createConstraintUseCase: CreateConstraintUseCase,
    private readonly getConstraintsUseCase: GetConstraintsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトの制約条件一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<ConstraintOutput[]> {
    return this.getConstraintsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '制約条件作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateConstraintDto,
  ): Promise<ConstraintOutput> {
    return this.createConstraintUseCase.execute({
      userId: user.id,
      projectId,
      title: dto.title,
      description: dto.description,
      category: dto.category,
      kind: dto.kind,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }
}

@ApiTags('制約条件')
@ApiBearerAuth()
@Controller('constraints')
export class ConstraintByIdController {
  constructor(
    private readonly updateConstraintUseCase: UpdateConstraintUseCase,
    private readonly deleteConstraintUseCase: DeleteConstraintUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '制約条件更新' })
  @ApiParam({ name: 'id', description: '制約条件ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '制約条件が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateConstraintDto,
  ): Promise<ConstraintOutput> {
    return this.updateConstraintUseCase.execute({
      userId: user.id,
      constraintId: id,
      title: dto.title,
      description: dto.description,
      category: dto.category,
      kind: dto.kind,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '制約条件削除' })
  @ApiParam({ name: 'id', description: '制約条件ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '制約条件が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteConstraintUseCase.execute({
      userId: user.id,
      constraintId: id,
    });
    return { success: true };
  }
}
