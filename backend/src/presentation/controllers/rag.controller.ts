import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JobService } from '../../infrastructure/services/job.service';
import {
  RAG_FEATURE_TYPES,
  RagFeatureType,
} from '../../infrastructure/rag/rag.types';
import { RagIndexService } from '../../infrastructure/rag/rag-index.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

class GenerateRagDto {
  @ApiProperty({ enum: RAG_FEATURE_TYPES, description: '索引化する機能' })
  @IsIn(RAG_FEATURE_TYPES)
  featureType!: RagFeatureType;

  @ApiPropertyOptional({ description: '個別フロー／ツリー等の対象ID' })
  @IsOptional()
  @IsString()
  targetId?: string;
}

const SCOPE_LEVELS = ['OVERVIEW', 'COMPONENT'] as const;
type ScopeLevel = (typeof SCOPE_LEVELS)[number];

@ApiTags('RAG索引')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/rag')
export class RagController {
  constructor(
    private readonly jobs: JobService,
    private readonly index: RagIndexService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '機能データをClaudeで圧縮するRAG索引ジョブを起票' })
  async generate(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: GenerateRagDto,
  ): Promise<{ jobId: string; status: string }> {
    const job = await this.jobs.enqueue(
      'AI_RAG_SUMMARIZE',
      { featureType: dto.featureType, targetId: dto.targetId },
      { projectId, createdById: user.id },
    );
    return { jobId: job.id, status: job.status };
  }

  @Get('status')
  @ApiOperation({ summary: 'RAG索引の生成状態・鮮度を取得' })
  status(
    @Param('projectId') projectId: string,
    @Query('featureType') featureType: string,
    @Query('targetId') targetId?: string,
  ) {
    return this.index.status(projectId, this.feature(featureType, true)!, targetId);
  }

  @Get('documents')
  @ApiOperation({ summary: 'RAG索引文書を一覧' })
  documents(
    @Param('projectId') projectId: string,
    @Query('featureType') featureType?: string,
    @Query('scopeLevel') scopeLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.index.list(projectId, {
      featureType: this.feature(featureType),
      scopeLevel: this.scope(scopeLevel),
      limit: this.number(limit),
    });
  }

  @Get('search')
  @ApiOperation({ summary: 'RAG索引を日本語キーワードで検索' })
  search(
    @Param('projectId') projectId: string,
    @Query('q') q?: string,
    @Query('featureType') featureType?: string,
    @Query('scopeLevel') scopeLevel?: string,
    @Query('limit') limit?: string,
  ) {
    return this.index.search(projectId, {
      q: q ?? '',
      featureType: this.feature(featureType),
      scopeLevel: this.scope(scopeLevel),
      limit: this.number(limit),
    });
  }

  private feature(value?: string, required = false): RagFeatureType | undefined {
    if (!value) {
      if (required) throw new BadRequestException('featureType が必要です');
      return undefined;
    }
    if (!(RAG_FEATURE_TYPES as readonly string[]).includes(value)) {
      throw new BadRequestException(`不正な featureType です: ${value}`);
    }
    return value as RagFeatureType;
  }

  private scope(value?: string): ScopeLevel | undefined {
    if (!value) return undefined;
    if (!(SCOPE_LEVELS as readonly string[]).includes(value)) {
      throw new BadRequestException(`不正な scopeLevel です: ${value}`);
    }
    return value as ScopeLevel;
  }

  private number(value?: string): number | undefined {
    if (!value) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
