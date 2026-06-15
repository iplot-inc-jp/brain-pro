import {
  Controller,
  Post,
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
import { IsString, IsOptional } from 'class-validator';
import {
  RetryFileUseCase,
  SkipFileUseCase,
  IngestionFileOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class SkipFileDto {
  @ApiPropertyOptional({ description: 'スキップ理由' })
  @IsOptional()
  @IsString()
  reason?: string | null;
}

@ApiTags('取り込みファイル')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('ingestion-files')
export class IngestionFileController {
  constructor(
    private readonly retryFileUseCase: RetryFileUseCase,
    private readonly skipFileUseCase: SkipFileUseCase,
  ) {}

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '個別ファイルの手動リトライ（ジョブ再投入）' })
  @ApiParam({ name: 'id', description: '取り込みファイルID' })
  @ApiResponse({ status: 404, description: 'ファイルが見つかりません' })
  async retry(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<IngestionFileOutput> {
    return this.retryFileUseCase.execute({ userId: user.id, id });
  }

  @Post(':id/skip')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '個別ファイルの手動スキップ（SKIPPED）' })
  @ApiParam({ name: 'id', description: '取り込みファイルID' })
  @ApiResponse({ status: 404, description: 'ファイルが見つかりません' })
  async skip(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: SkipFileDto,
  ): Promise<IngestionFileOutput> {
    return this.skipFileUseCase.execute({
      userId: user.id,
      id,
      reason: dto.reason,
    });
  }
}
