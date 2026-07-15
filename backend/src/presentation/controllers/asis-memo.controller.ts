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
  CreateAsisMemoUseCase,
  GetAsisMemosUseCase,
  UpdateAsisMemoUseCase,
  DeleteAsisMemoUseCase,
  AsisMemoOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateAsisMemoDto {
  @ApiPropertyOptional({ description: 'テーマ' })
  @IsOptional()
  @IsString()
  topic?: string | null;

  @ApiPropertyOptional({ description: '現状' })
  @IsOptional()
  @IsString()
  currentState?: string | null;

  @ApiPropertyOptional({ description: '痛み・課題' })
  @IsOptional()
  @IsString()
  pain?: string | null;

  @ApiPropertyOptional({ description: '制約' })
  @IsOptional()
  @IsString()
  restriction?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateAsisMemoDto {
  @ApiPropertyOptional({ description: 'テーマ' })
  @IsOptional()
  @IsString()
  topic?: string | null;

  @ApiPropertyOptional({ description: '現状' })
  @IsOptional()
  @IsString()
  currentState?: string | null;

  @ApiPropertyOptional({ description: '痛み・課題' })
  @IsOptional()
  @IsString()
  pain?: string | null;

  @ApiPropertyOptional({ description: '制約' })
  @IsOptional()
  @IsString()
  restriction?: string | null;

  @ApiPropertyOptional({ description: '備考' })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional({ description: '並び順' })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('ASISメモ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/asis-memos')
export class AsisMemoController {
  constructor(
    private readonly createAsisMemoUseCase: CreateAsisMemoUseCase,
    private readonly getAsisMemosUseCase: GetAsisMemosUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ASISメモ一覧取得（プロジェクト内）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<AsisMemoOutput[]> {
    return this.getAsisMemosUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ASISメモ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateAsisMemoDto,
  ): Promise<AsisMemoOutput> {
    return this.createAsisMemoUseCase.execute({
      userId: user.id,
      projectId,
      topic: dto.topic,
      currentState: dto.currentState,
      pain: dto.pain,
      restriction: dto.restriction,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('ASISメモ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('asis-memos')
export class AsisMemoByIdController {
  constructor(
    private readonly updateAsisMemoUseCase: UpdateAsisMemoUseCase,
    private readonly deleteAsisMemoUseCase: DeleteAsisMemoUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'ASISメモ更新' })
  @ApiParam({ name: 'id', description: 'ASISメモID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ASISメモが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAsisMemoDto,
  ): Promise<AsisMemoOutput> {
    return this.updateAsisMemoUseCase.execute({
      userId: user.id,
      principal: user,
      id,
      topic: dto.topic,
      currentState: dto.currentState,
      pain: dto.pain,
      restriction: dto.restriction,
      note: dto.note,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ASISメモ削除' })
  @ApiParam({ name: 'id', description: 'ASISメモID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ASISメモが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteAsisMemoUseCase.execute({
      userId: user.id,
      principal: user,
      id,
    });
    return { success: true };
  }
}
