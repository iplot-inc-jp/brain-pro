import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import {
  IsArray, IsIn, IsNumber, IsOptional, IsString,
} from 'class-validator';
import {
  ListKpisUseCase,
  CreateKpiUseCase,
  UpdateKpiUseCase,
  DeleteKpiUseCase,
  SetKpiInformationTypesUseCase,
  GetFlowIoSummaryUseCase,
  GenerateKpisUseCase,
} from '../../application';
import {
  KpiCategoryValue,
  KpiDirectionValue,
  KpiFrequencyValue,
  KpiStatusValue,
  KPI_CATEGORIES,
  KPI_DIRECTIONS,
  KPI_FREQUENCIES,
  KPI_STATUSES,
} from '../../domain';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

class CreateKpiDto {
  @IsString() name!: string;
  @IsOptional() @IsIn([...KPI_CATEGORIES]) category?: KpiCategoryValue;
  @IsOptional() @IsString() flowId?: string | null;
  @IsOptional() @IsString() asisFlowId?: string | null;
  @IsOptional() @IsString() tobeFlowId?: string | null;
  @IsOptional() @IsString() systemId?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() definition?: string | null;
  @IsOptional() @IsString() unit?: string | null;
  @IsOptional() @IsNumber() baselineValue?: number | null;
  @IsOptional() @IsNumber() targetValue?: number | null;
  @IsOptional() @IsNumber() currentValue?: number | null;
  @IsOptional() @IsIn([...KPI_DIRECTIONS]) direction?: KpiDirectionValue;
  @IsOptional() @IsIn([...KPI_FREQUENCIES]) frequency?: KpiFrequencyValue;
  @IsOptional() @IsString() measurementMethod?: string | null;
  @IsOptional() @IsString() ownerRoleId?: string | null;
  @IsOptional() @IsNumber() smartSpecific?: number | null;
  @IsOptional() @IsNumber() smartMeasurable?: number | null;
  @IsOptional() @IsNumber() smartAchievable?: number | null;
  @IsOptional() @IsNumber() smartRelevant?: number | null;
  @IsOptional() @IsNumber() smartTimeBound?: number | null;
  @IsOptional() @IsString() smartComment?: string | null;
  @IsOptional() @IsIn([...KPI_STATUSES]) status?: KpiStatusValue;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateKpiDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn([...KPI_CATEGORIES]) category?: KpiCategoryValue;
  @IsOptional() @IsString() flowId?: string | null;
  @IsOptional() @IsString() asisFlowId?: string | null;
  @IsOptional() @IsString() tobeFlowId?: string | null;
  @IsOptional() @IsString() systemId?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() definition?: string | null;
  @IsOptional() @IsString() unit?: string | null;
  @IsOptional() @IsNumber() baselineValue?: number | null;
  @IsOptional() @IsNumber() targetValue?: number | null;
  @IsOptional() @IsNumber() currentValue?: number | null;
  @IsOptional() @IsIn([...KPI_DIRECTIONS]) direction?: KpiDirectionValue;
  @IsOptional() @IsIn([...KPI_FREQUENCIES]) frequency?: KpiFrequencyValue;
  @IsOptional() @IsString() measurementMethod?: string | null;
  @IsOptional() @IsString() ownerRoleId?: string | null;
  @IsOptional() @IsNumber() smartSpecific?: number | null;
  @IsOptional() @IsNumber() smartMeasurable?: number | null;
  @IsOptional() @IsNumber() smartAchievable?: number | null;
  @IsOptional() @IsNumber() smartRelevant?: number | null;
  @IsOptional() @IsNumber() smartTimeBound?: number | null;
  @IsOptional() @IsString() smartComment?: string | null;
  @IsOptional() @IsIn([...KPI_STATUSES]) status?: KpiStatusValue;
  @IsOptional() @IsNumber() order?: number;
}

class SetKpiInformationTypesDto {
  @IsArray() @IsString({ each: true })
  informationTypeIds!: string[];
}

class GenerateKpisDto {
  @IsIn([...KPI_CATEGORIES]) category!: KpiCategoryValue;
  @IsOptional() @IsString() flowId?: string | null;
  @IsOptional() @IsString() systemId?: string | null;
  @IsArray() @IsString({ each: true })
  informationTypeIds!: string[];
  @IsOptional() @IsString() instructions?: string | null;
  @IsOptional() @IsNumber() count?: number;
}

@ApiTags('KPI（業務KPI・AI精度KPI）')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class KpiController {
  constructor(
    private readonly listKpis: ListKpisUseCase,
    private readonly createKpi: CreateKpiUseCase,
    private readonly updateKpi: UpdateKpiUseCase,
    private readonly deleteKpi: DeleteKpiUseCase,
    private readonly setInformationTypes: SetKpiInformationTypesUseCase,
    private readonly getIoSummary: GetFlowIoSummaryUseCase,
    private readonly generateKpis: GenerateKpisUseCase,
  ) {}

  @Get('projects/:projectId/kpis')
  @ApiOperation({ summary: 'KPI一覧（任意フィルタ category/flowId/systemId）' })
  @ApiQuery({ name: 'category', required: false, enum: [...KPI_CATEGORIES] })
  @ApiQuery({ name: 'flowId', required: false })
  @ApiQuery({ name: 'systemId', required: false })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('category') category?: string,
    @Query('flowId') flowId?: string,
    @Query('systemId') systemId?: string,
  ) {
    return this.listKpis.execute({
      userId: user.id,
      projectId,
      category: (KPI_CATEGORIES as readonly string[]).includes(category ?? '')
        ? (category as KpiCategoryValue)
        : undefined,
      flowId: flowId || undefined,
      systemId: systemId || undefined,
    });
  }

  @Post('projects/:projectId/kpis')
  @ApiOperation({ summary: 'KPI作成' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateKpiDto,
  ) {
    return this.createKpi.execute({ userId: user.id, projectId, ...dto });
  }

  @Patch('kpis/:id')
  @ApiOperation({ summary: 'KPI更新（全編集可能フィールド）' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateKpiDto,
  ) {
    return this.updateKpi.execute({ userId: user.id, id, ...dto });
  }

  @Delete('kpis/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'KPI削除' })
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteKpi.execute({ userId: user.id, id });
  }

  @Put('kpis/:id/information-types')
  @ApiOperation({ summary: 'KPIの測定対象情報種別を全置換（同一プロジェクト検証）' })
  async putInformationTypes(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SetKpiInformationTypesDto,
  ) {
    return this.setInformationTypes.execute({
      userId: user.id,
      kpiId: id,
      informationTypeIds: dto.informationTypeIds,
    });
  }

  @Get('business-flows/:flowId/io-summary')
  @ApiOperation({ summary: 'フローの入出力情報種別サマリ（重複排除＋出現元付き）' })
  async ioSummary(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
  ) {
    return this.getIoSummary.execute({ userId: user.id, flowId });
  }

  @Post('projects/:projectId/kpis/generate')
  @ApiOperation({ summary: 'AIでKPI候補を生成（status=DRAFT・aiGenerated=true で保存）' })
  async generate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: GenerateKpisDto,
  ) {
    return this.generateKpis.execute({
      userId: user.id,
      projectId,
      category: dto.category,
      flowId: dto.flowId ?? null,
      systemId: dto.systemId ?? null,
      informationTypeIds: dto.informationTypeIds,
      instructions: dto.instructions ?? null,
      count: dto.count,
    });
  }
}
