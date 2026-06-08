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
  CreateReportCalendarUseCase,
  GetReportCalendarsUseCase,
  UpdateReportCalendarUseCase,
  DeleteReportCalendarUseCase,
  ReportCalendarOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateReportCalendarDto {
  @ApiPropertyOptional({ description: '報告対象（誰に）ステークホルダーID' })
  @IsOptional()
  @IsString()
  stakeholderId?: string | null;

  @ApiPropertyOptional({ description: '報告対象（フリーテキスト）' })
  @IsOptional()
  @IsString()
  reportTo?: string | null;

  @ApiPropertyOptional({ description: '関連会議ID' })
  @IsOptional()
  @IsString()
  meetingId?: string | null;

  @ApiPropertyOptional({ description: '報告内容（何を）' })
  @IsOptional()
  @IsString()
  reportContent?: string | null;

  @ApiPropertyOptional({ description: '頻度' })
  @IsOptional()
  @IsString()
  frequency?: string | null;

  @ApiPropertyOptional({ description: '曜日・時刻' })
  @IsOptional()
  @IsString()
  dayTime?: string | null;

  @ApiPropertyOptional({ description: '形式' })
  @IsOptional()
  @IsString()
  format?: string | null;

  @ApiPropertyOptional({ description: '媒体' })
  @IsOptional()
  @IsString()
  medium?: string | null;

  @ApiPropertyOptional({ description: '起票担当' })
  @IsOptional()
  @IsString()
  drafter?: string | null;

  @ApiPropertyOptional({ description: '承認者' })
  @IsOptional()
  @IsString()
  approver?: string | null;

  @ApiPropertyOptional({ description: 'テンプレ・参考' })
  @IsOptional()
  @IsString()
  templateRef?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateReportCalendarDto {
  @ApiPropertyOptional({ description: '報告対象（誰に）ステークホルダーID' })
  @IsOptional()
  @IsString()
  stakeholderId?: string | null;

  @ApiPropertyOptional({ description: '報告対象（フリーテキスト）' })
  @IsOptional()
  @IsString()
  reportTo?: string | null;

  @ApiPropertyOptional({ description: '関連会議ID' })
  @IsOptional()
  @IsString()
  meetingId?: string | null;

  @ApiPropertyOptional({ description: '報告内容（何を）' })
  @IsOptional()
  @IsString()
  reportContent?: string | null;

  @ApiPropertyOptional({ description: '頻度' })
  @IsOptional()
  @IsString()
  frequency?: string | null;

  @ApiPropertyOptional({ description: '曜日・時刻' })
  @IsOptional()
  @IsString()
  dayTime?: string | null;

  @ApiPropertyOptional({ description: '形式' })
  @IsOptional()
  @IsString()
  format?: string | null;

  @ApiPropertyOptional({ description: '媒体' })
  @IsOptional()
  @IsString()
  medium?: string | null;

  @ApiPropertyOptional({ description: '起票担当' })
  @IsOptional()
  @IsString()
  drafter?: string | null;

  @ApiPropertyOptional({ description: '承認者' })
  @IsOptional()
  @IsString()
  approver?: string | null;

  @ApiPropertyOptional({ description: 'テンプレ・参考' })
  @IsOptional()
  @IsString()
  templateRef?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('報告・連絡カレンダー')
@ApiBearerAuth()
@Controller('projects/:projectId/report-calendars')
export class ReportCalendarController {
  constructor(
    private readonly createReportCalendarUseCase: CreateReportCalendarUseCase,
    private readonly getReportCalendarsUseCase: GetReportCalendarsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: '報告カレンダー一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<ReportCalendarOutput[]> {
    return this.getReportCalendarsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '報告カレンダー作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateReportCalendarDto,
  ): Promise<ReportCalendarOutput> {
    return this.createReportCalendarUseCase.execute({
      userId: user.id,
      projectId,
      stakeholderId: dto.stakeholderId,
      reportTo: dto.reportTo,
      meetingId: dto.meetingId,
      reportContent: dto.reportContent,
      frequency: dto.frequency,
      dayTime: dto.dayTime,
      format: dto.format,
      medium: dto.medium,
      drafter: dto.drafter,
      approver: dto.approver,
      templateRef: dto.templateRef,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('報告・連絡カレンダー')
@ApiBearerAuth()
@Controller('report-calendars')
export class ReportCalendarByIdController {
  constructor(
    private readonly updateReportCalendarUseCase: UpdateReportCalendarUseCase,
    private readonly deleteReportCalendarUseCase: DeleteReportCalendarUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '報告カレンダー更新' })
  @ApiParam({ name: 'id', description: '報告カレンダーID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '報告カレンダーが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateReportCalendarDto,
  ): Promise<ReportCalendarOutput> {
    return this.updateReportCalendarUseCase.execute({
      userId: user.id,
      id,
      stakeholderId: dto.stakeholderId,
      reportTo: dto.reportTo,
      meetingId: dto.meetingId,
      reportContent: dto.reportContent,
      frequency: dto.frequency,
      dayTime: dto.dayTime,
      format: dto.format,
      medium: dto.medium,
      drafter: dto.drafter,
      approver: dto.approver,
      templateRef: dto.templateRef,
      note: dto.note,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '報告カレンダー削除' })
  @ApiParam({ name: 'id', description: '報告カレンダーID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '報告カレンダーが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteReportCalendarUseCase.execute({
      userId: user.id,
      id,
    });
    return { success: true };
  }
}
