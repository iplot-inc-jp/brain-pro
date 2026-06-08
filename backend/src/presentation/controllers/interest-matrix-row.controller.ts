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
import { IsString, IsOptional, IsInt } from 'class-validator';
import {
  CreateInterestMatrixRowUseCase,
  GetInterestMatrixRowsUseCase,
  UpdateInterestMatrixRowUseCase,
  DeleteInterestMatrixRowUseCase,
  InterestMatrixRowOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateInterestMatrixRowDto {
  @ApiPropertyOptional({ description: 'フェーズ' })
  @IsOptional()
  @IsString()
  phase?: string | null;

  @ApiPropertyOptional({ description: '期間目安' })
  @IsOptional()
  @IsString()
  duration?: string | null;

  @ApiPropertyOptional({ description: '主要ミーティング体' })
  @IsOptional()
  @IsString()
  mainMeetings?: string | null;

  @ApiPropertyOptional({ description: '現場（実務担当）' })
  @IsOptional()
  @IsString()
  fieldStaff?: string | null;

  @ApiPropertyOptional({ description: '先方プロマネ' })
  @IsOptional()
  @IsString()
  clientPm?: string | null;

  @ApiPropertyOptional({ description: '役員（経営層）' })
  @IsOptional()
  @IsString()
  executive?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateInterestMatrixRowDto {
  @ApiPropertyOptional({ description: 'フェーズ' })
  @IsOptional()
  @IsString()
  phase?: string | null;

  @ApiPropertyOptional({ description: '期間目安' })
  @IsOptional()
  @IsString()
  duration?: string | null;

  @ApiPropertyOptional({ description: '主要ミーティング体' })
  @IsOptional()
  @IsString()
  mainMeetings?: string | null;

  @ApiPropertyOptional({ description: '現場（実務担当）' })
  @IsOptional()
  @IsString()
  fieldStaff?: string | null;

  @ApiPropertyOptional({ description: '先方プロマネ' })
  @IsOptional()
  @IsString()
  clientPm?: string | null;

  @ApiPropertyOptional({ description: '役員（経営層）' })
  @IsOptional()
  @IsString()
  executive?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('関心ごとマトリクス')
@ApiBearerAuth()
@Controller('projects/:projectId/interest-rows')
export class InterestMatrixRowController {
  constructor(
    private readonly createInterestMatrixRowUseCase: CreateInterestMatrixRowUseCase,
    private readonly getInterestMatrixRowsUseCase: GetInterestMatrixRowsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: '関心ごとマトリクス行一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<InterestMatrixRowOutput[]> {
    return this.getInterestMatrixRowsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '関心ごとマトリクス行作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateInterestMatrixRowDto,
  ): Promise<InterestMatrixRowOutput> {
    return this.createInterestMatrixRowUseCase.execute({
      userId: user.id,
      projectId,
      phase: dto.phase,
      duration: dto.duration,
      mainMeetings: dto.mainMeetings,
      fieldStaff: dto.fieldStaff,
      clientPm: dto.clientPm,
      executive: dto.executive,
      order: dto.order,
    });
  }
}

@ApiTags('関心ごとマトリクス')
@ApiBearerAuth()
@Controller('interest-rows')
export class InterestMatrixRowByIdController {
  constructor(
    private readonly updateInterestMatrixRowUseCase: UpdateInterestMatrixRowUseCase,
    private readonly deleteInterestMatrixRowUseCase: DeleteInterestMatrixRowUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '関心ごとマトリクス行更新' })
  @ApiParam({ name: 'id', description: '行ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '行が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateInterestMatrixRowDto,
  ): Promise<InterestMatrixRowOutput> {
    return this.updateInterestMatrixRowUseCase.execute({
      userId: user.id,
      id,
      phase: dto.phase,
      duration: dto.duration,
      mainMeetings: dto.mainMeetings,
      fieldStaff: dto.fieldStaff,
      clientPm: dto.clientPm,
      executive: dto.executive,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '関心ごとマトリクス行削除' })
  @ApiParam({ name: 'id', description: '行ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '行が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteInterestMatrixRowUseCase.execute({
      userId: user.id,
      id,
    });
    return { success: true };
  }
}
