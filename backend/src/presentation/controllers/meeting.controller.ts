import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
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
import { IsString, IsOptional, IsInt, IsArray, Min } from 'class-validator';
import {
  CreateMeetingUseCase,
  GetMeetingsUseCase,
  UpdateMeetingUseCase,
  DeleteMeetingUseCase,
  SetMeetingStakeholdersUseCase,
  SetMeetingSubProjectsUseCase,
  MeetingOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateMeetingDto {
  @ApiProperty({ description: '会議体名', example: '定例ステアリング' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '目的' })
  @IsOptional()
  @IsString()
  purpose?: string | null;

  @ApiPropertyOptional({ description: '頻度' })
  @IsOptional()
  @IsString()
  frequency?: string | null;

  @ApiPropertyOptional({ description: '曜日・時間' })
  @IsOptional()
  @IsString()
  dayTime?: string | null;

  @ApiPropertyOptional({ description: '必須出席者' })
  @IsOptional()
  @IsString()
  requiredAttendees?: string | null;

  @ApiPropertyOptional({ description: '任意出席者' })
  @IsOptional()
  @IsString()
  optionalAttendees?: string | null;

  @ApiPropertyOptional({ description: 'アジェンダテンプレート' })
  @IsOptional()
  @IsString()
  agendaTemplate?: string | null;

  @ApiPropertyOptional({ description: '事前資料' })
  @IsOptional()
  @IsString()
  preMaterials?: string | null;

  @ApiPropertyOptional({ description: '議事録担当' })
  @IsOptional()
  @IsString()
  minutesOwner?: string | null;

  @ApiPropertyOptional({
    description: '形式（対面 / オンライン / ハイブリッド）',
  })
  @IsOptional()
  @IsString()
  format?: string | null;

  @ApiPropertyOptional({ description: '所要時間（分）', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ description: '場所 or 会議URL' })
  @IsOptional()
  @IsString()
  locationUrl?: string | null;

  @ApiPropertyOptional({
    description: '主催/ファシリテーター（ステークホルダーID）',
  })
  @IsOptional()
  @IsString()
  ownerStakeholderId?: string | null;

  @ApiPropertyOptional({
    description: 'ステータス（ACTIVE=開催中 / SUSPENDED=休止）',
  })
  @IsOptional()
  @IsString()
  status?: string | null;

  @ApiPropertyOptional({ description: 'この会議のゴール/アウトプット' })
  @IsOptional()
  @IsString()
  goal?: string | null;

  @ApiPropertyOptional({ description: '意思決定者' })
  @IsOptional()
  @IsString()
  decisionMaker?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateMeetingDto {
  @ApiPropertyOptional({ description: '会議体名' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '目的' })
  @IsOptional()
  @IsString()
  purpose?: string | null;

  @ApiPropertyOptional({ description: '頻度' })
  @IsOptional()
  @IsString()
  frequency?: string | null;

  @ApiPropertyOptional({ description: '曜日・時間' })
  @IsOptional()
  @IsString()
  dayTime?: string | null;

  @ApiPropertyOptional({ description: '必須出席者' })
  @IsOptional()
  @IsString()
  requiredAttendees?: string | null;

  @ApiPropertyOptional({ description: '任意出席者' })
  @IsOptional()
  @IsString()
  optionalAttendees?: string | null;

  @ApiPropertyOptional({ description: 'アジェンダテンプレート' })
  @IsOptional()
  @IsString()
  agendaTemplate?: string | null;

  @ApiPropertyOptional({ description: '事前資料' })
  @IsOptional()
  @IsString()
  preMaterials?: string | null;

  @ApiPropertyOptional({ description: '議事録担当' })
  @IsOptional()
  @IsString()
  minutesOwner?: string | null;

  @ApiPropertyOptional({ description: '意思決定者' })
  @IsOptional()
  @IsString()
  decisionMaker?: string | null;

  @ApiPropertyOptional({
    description: '形式（対面 / オンライン / ハイブリッド）',
  })
  @IsOptional()
  @IsString()
  format?: string | null;

  @ApiPropertyOptional({ description: '所要時間（分）', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationMinutes?: number | null;

  @ApiPropertyOptional({ description: '場所 or 会議URL' })
  @IsOptional()
  @IsString()
  locationUrl?: string | null;

  @ApiPropertyOptional({
    description: '主催/ファシリテーター（ステークホルダーID）',
  })
  @IsOptional()
  @IsString()
  ownerStakeholderId?: string | null;

  @ApiPropertyOptional({
    description: 'ステータス（ACTIVE=開催中 / SUSPENDED=休止）',
  })
  @IsOptional()
  @IsString()
  status?: string | null;

  @ApiPropertyOptional({ description: 'この会議のゴール/アウトプット' })
  @IsOptional()
  @IsString()
  goal?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class SetMeetingStakeholdersDto {
  @ApiProperty({
    description: '対象ステークホルダーIDの配列（置き換え）',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  stakeholderIds: string[];
}

class SetMeetingSubProjectsDto {
  @ApiProperty({
    description: '対象サブ領域IDの配列（置き換え）',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  subProjectIds: string[];
}

@ApiTags('会議体')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/meetings')
export class MeetingController {
  constructor(
    private readonly createMeetingUseCase: CreateMeetingUseCase,
    private readonly getMeetingsUseCase: GetMeetingsUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: '会議体一覧取得（プロジェクト内、stakeholderIds含む）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<MeetingOutput[]> {
    return this.getMeetingsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '会議体作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateMeetingDto,
  ): Promise<MeetingOutput> {
    return this.createMeetingUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      purpose: dto.purpose,
      frequency: dto.frequency,
      dayTime: dto.dayTime,
      requiredAttendees: dto.requiredAttendees,
      optionalAttendees: dto.optionalAttendees,
      agendaTemplate: dto.agendaTemplate,
      preMaterials: dto.preMaterials,
      minutesOwner: dto.minutesOwner,
      decisionMaker: dto.decisionMaker,
      format: dto.format,
      durationMinutes: dto.durationMinutes,
      locationUrl: dto.locationUrl,
      ownerStakeholderId: dto.ownerStakeholderId,
      status: dto.status,
      goal: dto.goal,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('会議体')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('meetings')
export class MeetingByIdController {
  constructor(
    private readonly updateMeetingUseCase: UpdateMeetingUseCase,
    private readonly deleteMeetingUseCase: DeleteMeetingUseCase,
    private readonly setMeetingStakeholdersUseCase: SetMeetingStakeholdersUseCase,
    private readonly setMeetingSubProjectsUseCase: SetMeetingSubProjectsUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '会議体更新' })
  @ApiParam({ name: 'id', description: '会議体ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '会議体が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateMeetingDto,
  ): Promise<MeetingOutput> {
    return this.updateMeetingUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      name: dto.name,
      purpose: dto.purpose,
      frequency: dto.frequency,
      dayTime: dto.dayTime,
      requiredAttendees: dto.requiredAttendees,
      optionalAttendees: dto.optionalAttendees,
      agendaTemplate: dto.agendaTemplate,
      preMaterials: dto.preMaterials,
      minutesOwner: dto.minutesOwner,
      decisionMaker: dto.decisionMaker,
      format: dto.format,
      durationMinutes: dto.durationMinutes,
      locationUrl: dto.locationUrl,
      ownerStakeholderId: dto.ownerStakeholderId,
      status: dto.status,
      goal: dto.goal,
      note: dto.note,
      order: dto.order,
    });
  }

  @Put(':id/stakeholders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '会議体の対象ステークホルダーを設定（置き換え）',
  })
  @ApiParam({ name: 'id', description: '会議体ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '会議体が見つかりません' })
  async setStakeholders(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SetMeetingStakeholdersDto,
  ): Promise<MeetingOutput> {
    return this.setMeetingStakeholdersUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      stakeholderIds: dto.stakeholderIds,
    });
  }

  @Put(':id/sub-projects')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '会議体の対象サブ領域を設定（置き換え）',
  })
  @ApiParam({ name: 'id', description: '会議体ID' })
  @ApiResponse({ status: 200, description: '更新成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '会議体が見つかりません' })
  async setSubProjects(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SetMeetingSubProjectsDto,
  ): Promise<MeetingOutput> {
    return this.setMeetingSubProjectsUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      subProjectIds: dto.subProjectIds,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '会議体削除' })
  @ApiParam({ name: 'id', description: '会議体ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '会議体が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteMeetingUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
    return { success: true };
  }
}
