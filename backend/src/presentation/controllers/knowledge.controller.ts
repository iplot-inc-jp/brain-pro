import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
  ApiQuery,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber } from 'class-validator';
import {
  GetKnowledgeGraphUseCase,
  GetKnowledgeNodeUseCase,
  SearchKnowledgeUseCase,
  UpdateKnowledgeNodeUseCase,
  DeleteKnowledgeNodeUseCase,
  UpdateDocumentPositionUseCase,
  KnowledgeGraphOutput,
  KnowledgeNodeDetailOutput,
  KnowledgeNodeOutput,
  KnowledgeDocumentOutput,
  KnowledgeSearchOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class UpdateKnowledgeNodeDto {
  @ApiPropertyOptional({ description: 'ラベル' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: '説明' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ description: '色' })
  @IsOptional()
  @IsString()
  color?: string | null;

  @ApiPropertyOptional({ description: 'X座標' })
  @IsOptional()
  @IsNumber()
  positionX?: number | null;

  @ApiPropertyOptional({ description: 'Y座標' })
  @IsOptional()
  @IsNumber()
  positionY?: number | null;
}

class UpdateDocumentPositionDto {
  @ApiPropertyOptional({ description: 'X座標' })
  @IsOptional()
  @IsNumber()
  positionX?: number | null;

  @ApiPropertyOptional({ description: 'Y座標' })
  @IsOptional()
  @IsNumber()
  positionY?: number | null;
}

@ApiTags('ナレッジグラフ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/knowledge')
export class KnowledgeProjectController {
  constructor(
    private readonly getKnowledgeGraphUseCase: GetKnowledgeGraphUseCase,
    private readonly searchKnowledgeUseCase: SearchKnowledgeUseCase,
  ) {}

  @Get('graph')
  @ApiOperation({ summary: 'ナレッジグラフ取得（nodes + edges + documents）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async graph(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<KnowledgeGraphOutput> {
    return this.getKnowledgeGraphUseCase.execute({ userId: user.id, projectId });
  }

  @Get('search')
  @ApiOperation({ summary: 'ナレッジ検索（ラベル/タイトル部分一致）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({ name: 'q', description: '検索クエリ', required: false })
  async search(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('q') q: string,
  ): Promise<KnowledgeSearchOutput> {
    return this.searchKnowledgeUseCase.execute({
      userId: user.id,
      projectId,
      query: q ?? '',
    });
  }
}

@ApiTags('ナレッジグラフ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('knowledge-nodes')
export class KnowledgeNodeController {
  constructor(
    private readonly getKnowledgeNodeUseCase: GetKnowledgeNodeUseCase,
    private readonly updateKnowledgeNodeUseCase: UpdateKnowledgeNodeUseCase,
    private readonly deleteKnowledgeNodeUseCase: DeleteKnowledgeNodeUseCase,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'ナレッジノード詳細取得（mentions 込み）' })
  @ApiParam({ name: 'id', description: 'ノードID' })
  @ApiResponse({ status: 404, description: 'ノードが見つかりません' })
  async detail(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<KnowledgeNodeDetailOutput> {
    return this.getKnowledgeNodeUseCase.execute({ userId: user.id, id });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'ナレッジノード更新（label/description/color/position）' })
  @ApiParam({ name: 'id', description: 'ノードID' })
  @ApiResponse({ status: 404, description: 'ノードが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeNodeDto,
  ): Promise<KnowledgeNodeOutput> {
    return this.updateKnowledgeNodeUseCase.execute({
      userId: user.id,
      id,
      label: dto.label,
      description: dto.description,
      color: dto.color,
      positionX: dto.positionX,
      positionY: dto.positionY,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ナレッジノード削除' })
  @ApiParam({ name: 'id', description: 'ノードID' })
  @ApiResponse({ status: 404, description: 'ノードが見つかりません' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteKnowledgeNodeUseCase.execute({ userId: user.id, id });
    return { success: true };
  }
}

@ApiTags('ナレッジグラフ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('knowledge-documents')
export class KnowledgeDocumentController {
  constructor(
    private readonly updateDocumentPositionUseCase: UpdateDocumentPositionUseCase,
  ) {}

  @Patch(':id/position')
  @ApiOperation({ summary: '文書ノードの位置更新（キャンバスのドラッグ位置永続化）' })
  @ApiParam({ name: 'id', description: '文書ID' })
  @ApiResponse({ status: 404, description: '文書が見つかりません' })
  async updatePosition(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentPositionDto,
  ): Promise<KnowledgeDocumentOutput> {
    return this.updateDocumentPositionUseCase.execute({
      userId: user.id,
      id,
      positionX: dto.positionX,
      positionY: dto.positionY,
    });
  }
}
