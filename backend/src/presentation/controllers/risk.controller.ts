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
import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import {
  CreateRiskUseCase,
  GetRisksUseCase,
  UpdateRiskUseCase,
  DeleteRiskUseCase,
  RiskOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateRiskDto {
  @ApiPropertyOptional({ description: 'リスクID（表示用）' })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ description: '種別（リスク/ボトルネック）' })
  @IsOptional()
  @IsString()
  type?: string | null;

  @ApiPropertyOptional({ description: '事象内容' })
  @IsOptional()
  @IsString()
  event?: string | null;

  @ApiPropertyOptional({ description: '原因区分（人/情報/決裁/技術/外部）' })
  @IsOptional()
  @IsString()
  causeCategory?: string | null;

  @ApiPropertyOptional({ description: '発生確率（高/中/低）' })
  @IsOptional()
  @IsString()
  probability?: string | null;

  @ApiPropertyOptional({ description: '影響度（高/中/低）' })
  @IsOptional()
  @IsString()
  impact?: string | null;

  @ApiPropertyOptional({ description: '優先度' })
  @IsOptional()
  @IsString()
  priority?: string | null;

  @ApiPropertyOptional({ description: '対応策（予防・軽減）' })
  @IsOptional()
  @IsString()
  countermeasure?: string | null;

  @ApiPropertyOptional({ description: '対応MTG（要/不要）' })
  @IsOptional()
  @IsString()
  needsMtg?: string | null;

  @ApiPropertyOptional({ description: 'MTG設定日' })
  @IsOptional()
  @IsString()
  mtgDate?: string | null;

  @ApiPropertyOptional({ description: '期限' })
  @IsOptional()
  @IsString()
  deadline?: string | null;

  @ApiPropertyOptional({ description: '担当' })
  @IsOptional()
  @IsString()
  owner?: string | null;

  @ApiPropertyOptional({ description: 'ステータス' })
  @IsOptional()
  @IsString()
  status?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;

  // --- PMBOK準拠の追加項目（全て optional・後方互換） ---

  @ApiPropertyOptional({ description: 'RBSカテゴリID（null で未分類）' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: '対象サブ領域（サブプロジェクト）ID' })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiPropertyOptional({ description: 'リスクオーナー（ステークホルダー）ID' })
  @IsOptional()
  @IsString()
  ownerStakeholderId?: string | null;

  @ApiPropertyOptional({ description: 'レビュー会議体（ミーティング）ID' })
  @IsOptional()
  @IsString()
  reviewMeetingId?: string | null;

  @ApiPropertyOptional({ description: '発生確率スコア（1-5）', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  probabilityScore?: number | null;

  @ApiPropertyOptional({ description: '影響度スコア（1-5）', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  impactScore?: number | null;

  @ApiPropertyOptional({ description: 'リスク種別（THREAT / OPPORTUNITY）' })
  @IsOptional()
  @IsString()
  riskType?: string | null;

  @ApiPropertyOptional({
    description: '対応戦略（回避/転嫁/軽減/受容/活用/共有/強化）',
  })
  @IsOptional()
  @IsString()
  strategy?: string | null;

  @ApiPropertyOptional({ description: '対応計画' })
  @IsOptional()
  @IsString()
  responsePlan?: string | null;

  @ApiPropertyOptional({ description: 'コンティンジェンシー計画' })
  @IsOptional()
  @IsString()
  contingencyPlan?: string | null;

  @ApiPropertyOptional({ description: 'トリガー条件' })
  @IsOptional()
  @IsString()
  trigger?: string | null;

  @ApiPropertyOptional({
    description:
      'ライフサイクル（IDENTIFIED / ANALYZED / RESPONDING / MONITORING / OCCURRED / CLOSED）',
  })
  @IsOptional()
  @IsString()
  lifecycle?: string | null;
}

class UpdateRiskDto {
  @ApiPropertyOptional({ description: 'リスクID（表示用）' })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiPropertyOptional({ description: '種別（リスク/ボトルネック）' })
  @IsOptional()
  @IsString()
  type?: string | null;

  @ApiPropertyOptional({ description: '事象内容' })
  @IsOptional()
  @IsString()
  event?: string | null;

  @ApiPropertyOptional({ description: '原因区分（人/情報/決裁/技術/外部）' })
  @IsOptional()
  @IsString()
  causeCategory?: string | null;

  @ApiPropertyOptional({ description: '発生確率（高/中/低）' })
  @IsOptional()
  @IsString()
  probability?: string | null;

  @ApiPropertyOptional({ description: '影響度（高/中/低）' })
  @IsOptional()
  @IsString()
  impact?: string | null;

  @ApiPropertyOptional({ description: '優先度' })
  @IsOptional()
  @IsString()
  priority?: string | null;

  @ApiPropertyOptional({ description: '対応策（予防・軽減）' })
  @IsOptional()
  @IsString()
  countermeasure?: string | null;

  @ApiPropertyOptional({ description: '対応MTG（要/不要）' })
  @IsOptional()
  @IsString()
  needsMtg?: string | null;

  @ApiPropertyOptional({ description: 'MTG設定日' })
  @IsOptional()
  @IsString()
  mtgDate?: string | null;

  @ApiPropertyOptional({ description: '期限' })
  @IsOptional()
  @IsString()
  deadline?: string | null;

  @ApiPropertyOptional({ description: '担当' })
  @IsOptional()
  @IsString()
  owner?: string | null;

  @ApiPropertyOptional({ description: 'ステータス' })
  @IsOptional()
  @IsString()
  status?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;

  // --- PMBOK準拠の追加項目（全て optional・後方互換） ---

  @ApiPropertyOptional({ description: 'RBSカテゴリID（null で未分類）' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: '対象サブ領域（サブプロジェクト）ID' })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiPropertyOptional({ description: 'リスクオーナー（ステークホルダー）ID' })
  @IsOptional()
  @IsString()
  ownerStakeholderId?: string | null;

  @ApiPropertyOptional({ description: 'レビュー会議体（ミーティング）ID' })
  @IsOptional()
  @IsString()
  reviewMeetingId?: string | null;

  @ApiPropertyOptional({ description: '発生確率スコア（1-5）', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  probabilityScore?: number | null;

  @ApiPropertyOptional({ description: '影響度スコア（1-5）', minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  impactScore?: number | null;

  @ApiPropertyOptional({ description: 'リスク種別（THREAT / OPPORTUNITY）' })
  @IsOptional()
  @IsString()
  riskType?: string | null;

  @ApiPropertyOptional({
    description: '対応戦略（回避/転嫁/軽減/受容/活用/共有/強化）',
  })
  @IsOptional()
  @IsString()
  strategy?: string | null;

  @ApiPropertyOptional({ description: '対応計画' })
  @IsOptional()
  @IsString()
  responsePlan?: string | null;

  @ApiPropertyOptional({ description: 'コンティンジェンシー計画' })
  @IsOptional()
  @IsString()
  contingencyPlan?: string | null;

  @ApiPropertyOptional({ description: 'トリガー条件' })
  @IsOptional()
  @IsString()
  trigger?: string | null;

  @ApiPropertyOptional({
    description:
      'ライフサイクル（IDENTIFIED / ANALYZED / RESPONDING / MONITORING / OCCURRED / CLOSED）',
  })
  @IsOptional()
  @IsString()
  lifecycle?: string | null;
}

@ApiTags('リスク・ボトルネック')
@ApiBearerAuth()
@Controller('projects/:projectId/risks')
export class RiskController {
  constructor(
    private readonly createRiskUseCase: CreateRiskUseCase,
    private readonly getRisksUseCase: GetRisksUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'リスク一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<RiskOutput[]> {
    return this.getRisksUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'リスク作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateRiskDto,
  ): Promise<RiskOutput> {
    return this.createRiskUseCase.execute({
      userId: user.id,
      projectId,
      code: dto.code,
      type: dto.type,
      event: dto.event,
      causeCategory: dto.causeCategory,
      probability: dto.probability,
      impact: dto.impact,
      priority: dto.priority,
      countermeasure: dto.countermeasure,
      needsMtg: dto.needsMtg,
      mtgDate: dto.mtgDate,
      deadline: dto.deadline,
      owner: dto.owner,
      status: dto.status,
      note: dto.note,
      order: dto.order,
      categoryId: dto.categoryId,
      subProjectId: dto.subProjectId,
      ownerStakeholderId: dto.ownerStakeholderId,
      reviewMeetingId: dto.reviewMeetingId,
      probabilityScore: dto.probabilityScore,
      impactScore: dto.impactScore,
      riskType: dto.riskType,
      strategy: dto.strategy,
      responsePlan: dto.responsePlan,
      contingencyPlan: dto.contingencyPlan,
      trigger: dto.trigger,
      lifecycle: dto.lifecycle,
    });
  }
}

@ApiTags('リスク・ボトルネック')
@ApiBearerAuth()
@Controller('risks')
export class RiskByIdController {
  constructor(
    private readonly updateRiskUseCase: UpdateRiskUseCase,
    private readonly deleteRiskUseCase: DeleteRiskUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'リスク更新' })
  @ApiParam({ name: 'id', description: 'リスクID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'リスクが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateRiskDto,
  ): Promise<RiskOutput> {
    return this.updateRiskUseCase.execute({
      userId: user.id,
      id,
      code: dto.code,
      type: dto.type,
      event: dto.event,
      causeCategory: dto.causeCategory,
      probability: dto.probability,
      impact: dto.impact,
      priority: dto.priority,
      countermeasure: dto.countermeasure,
      needsMtg: dto.needsMtg,
      mtgDate: dto.mtgDate,
      deadline: dto.deadline,
      owner: dto.owner,
      status: dto.status,
      note: dto.note,
      order: dto.order,
      categoryId: dto.categoryId,
      subProjectId: dto.subProjectId,
      ownerStakeholderId: dto.ownerStakeholderId,
      reviewMeetingId: dto.reviewMeetingId,
      probabilityScore: dto.probabilityScore,
      impactScore: dto.impactScore,
      riskType: dto.riskType,
      strategy: dto.strategy,
      responsePlan: dto.responsePlan,
      contingencyPlan: dto.contingencyPlan,
      trigger: dto.trigger,
      lifecycle: dto.lifecycle,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'リスク削除' })
  @ApiParam({ name: 'id', description: 'リスクID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'リスクが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteRiskUseCase.execute({
      userId: user.id,
      id,
    });
    return { success: true };
  }
}
