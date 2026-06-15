import {
  Controller,
  Get,
  Put,
  Body,
  Param,
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
import { IsBoolean, IsOptional, IsString, IsIn, IsInt } from 'class-validator';
import {
  GetOrCreateSettingsUseCase,
  UpdateSettingsUseCase,
  ProjectKnowledgeSettingsOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class UpdateKnowledgeSettingsDto {
  @ApiPropertyOptional({ description: 'AI抽出を有効化（$）' })
  @IsOptional()
  @IsBoolean()
  aiExtractionEnabled?: boolean;

  @ApiPropertyOptional({ description: 'OCR/画像解析を有効化（$$）' })
  @IsOptional()
  @IsBoolean()
  ocrEnabled?: boolean;

  @ApiPropertyOptional({ description: '既定モデル（未設定なら EXTRACTION_MODEL）' })
  @IsOptional()
  @IsString()
  defaultModel?: string | null;

  @ApiPropertyOptional({
    description: 'Office→画像化の方針',
    enum: ['auto', 'always', 'never'],
  })
  @IsOptional()
  @IsIn(['auto', 'always', 'never'])
  imagingMode?: 'auto' | 'always' | 'never';

  @ApiPropertyOptional({ description: '1バッチの最大ファイル数' })
  @IsOptional()
  @IsInt()
  maxFilesPerBatch?: number;
}

@ApiTags('ナレッジ設定')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/knowledge/settings')
export class KnowledgeSettingsController {
  constructor(
    private readonly getOrCreateSettingsUseCase: GetOrCreateSettingsUseCase,
    private readonly updateSettingsUseCase: UpdateSettingsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ナレッジ設定取得（get-or-create 既定）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<ProjectKnowledgeSettingsOutput> {
    return this.getOrCreateSettingsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Put()
  @ApiOperation({ summary: 'ナレッジ設定更新（課金ガード）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateKnowledgeSettingsDto,
  ): Promise<ProjectKnowledgeSettingsOutput> {
    return this.updateSettingsUseCase.execute({
      userId: user.id,
      projectId,
      aiExtractionEnabled: dto.aiExtractionEnabled,
      ocrEnabled: dto.ocrEnabled,
      defaultModel: dto.defaultModel,
      imagingMode: dto.imagingMode,
      maxFilesPerBatch: dto.maxFilesPerBatch,
    });
  }
}
