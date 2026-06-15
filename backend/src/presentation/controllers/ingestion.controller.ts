import {
  Controller,
  Get,
  Post,
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
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsObject,
  IsIn,
  IsInt,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  CreateIngestionBatchUseCase,
  GetIngestionBatchesUseCase,
  GetIngestionBatchDetailUseCase,
  ResumeBatchUseCase,
  CancelBatchUseCase,
  IngestionBatchOutput,
  IngestionBatchDetailOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateIngestionFileDto {
  @ApiProperty({ description: 'ソース種別', enum: ['UPLOAD', 'ATTACHMENT', 'DRIVE'] })
  @IsIn(['UPLOAD', 'ATTACHMENT', 'DRIVE'])
  sourceType!: 'UPLOAD' | 'ATTACHMENT' | 'DRIVE';

  @ApiPropertyOptional({ description: 'attachmentId / driveFileId（UPLOAD は null）' })
  @IsOptional()
  @IsString()
  sourceRef?: string | null;

  @ApiProperty({ description: 'ファイル名' })
  @IsString()
  filename!: string;

  @ApiPropertyOptional({ description: '表示名' })
  @IsOptional()
  @IsString()
  displayName?: string | null;

  @ApiPropertyOptional({ description: 'MIMEタイプ' })
  @IsOptional()
  @IsString()
  mimeType?: string | null;

  @ApiPropertyOptional({ description: 'サイズ（bytes）' })
  @IsOptional()
  @IsInt()
  size?: number | null;

  @ApiPropertyOptional({ description: '原本の Blob URL（UPLOAD 済の場合）' })
  @IsOptional()
  @IsString()
  blobUrl?: string | null;
}

class CreateIngestionBatchDto {
  @ApiPropertyOptional({
    description: 'バッチ名（未指定なら「取り込み <件数>件」を補完）',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '取り込むファイル群', type: [CreateIngestionFileDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateIngestionFileDto)
  files!: CreateIngestionFileDto[];

  @ApiPropertyOptional({
    description: '抽出オプション（バッチ単位でプロジェクト設定を上書き）',
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown> | null;
}

@ApiTags('取り込みバッチ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/ingestion-batches')
export class IngestionBatchProjectController {
  constructor(
    private readonly createIngestionBatchUseCase: CreateIngestionBatchUseCase,
    private readonly getIngestionBatchesUseCase: GetIngestionBatchesUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: '取り込みバッチ一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<IngestionBatchOutput[]> {
    return this.getIngestionBatchesUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '取り込みバッチ作成（ソース指定 → ジョブ投入）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateIngestionBatchDto,
  ): Promise<IngestionBatchDetailOutput> {
    return this.createIngestionBatchUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name ?? null,
      files: dto.files,
      options: dto.options,
    });
  }
}

@ApiTags('取り込みバッチ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('ingestion-batches')
export class IngestionBatchByIdController {
  constructor(
    private readonly getIngestionBatchDetailUseCase: GetIngestionBatchDetailUseCase,
    private readonly resumeBatchUseCase: ResumeBatchUseCase,
    private readonly cancelBatchUseCase: CancelBatchUseCase,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: '取り込みバッチ詳細取得（files 込み）' })
  @ApiParam({ name: 'id', description: 'バッチID' })
  @ApiResponse({ status: 404, description: 'バッチが見つかりません' })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<IngestionBatchDetailOutput> {
    return this.getIngestionBatchDetailUseCase.execute({ userId: user.id, id });
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'バッチ再開（PENDING/FAILED/stale を再投入）' })
  @ApiParam({ name: 'id', description: 'バッチID' })
  async resume(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<IngestionBatchDetailOutput> {
    return this.resumeBatchUseCase.execute({ userId: user.id, id });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'バッチキャンセル（未実行ファイルを SKIPPED）' })
  @ApiParam({ name: 'id', description: 'バッチID' })
  async cancel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<IngestionBatchDetailOutput> {
    return this.cancelBatchUseCase.execute({ userId: user.id, id });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'バッチキャンセル（DELETE エイリアス）' })
  @ApiParam({ name: 'id', description: 'バッチID' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.cancelBatchUseCase.execute({ userId: user.id, id });
    return { success: true };
  }
}
