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
  ApiProperty,
} from '@nestjs/swagger';
import { IsString, IsOptional, IsInt } from 'class-validator';
import {
  CreateFlowFolderUseCase,
  GetFlowFoldersUseCase,
  RenameFlowFolderUseCase,
  MoveFlowFolderUseCase,
  DeleteFlowFolderUseCase,
  FlowFolderOutput,
} from '../../application';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

// ========== DTOs ==========

class CreateFlowFolderDto {
  @ApiProperty({ description: 'フォルダ名', example: '受発注業務' })
  @IsString()
  name: string;

  @ApiProperty({ description: '親フォルダID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class RenameFlowFolderDto {
  @ApiProperty({ description: '新しいフォルダ名' })
  @IsString()
  name: string;
}

class MoveFlowFolderDto {
  @ApiProperty({
    description: '移動先の親フォルダID（null でルートへ）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

@ApiTags('フローフォルダ')
@ApiBearerAuth()
@Controller('projects/:projectId/flow-folders')
export class FlowFolderController {
  constructor(
    private readonly createFlowFolderUseCase: CreateFlowFolderUseCase,
    private readonly getFlowFoldersUseCase: GetFlowFoldersUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'プロジェクトのフローフォルダ一覧取得（parentId 付きフラット）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<FlowFolderOutput[]> {
    return this.getFlowFoldersUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'フローフォルダ作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateFlowFolderDto,
  ): Promise<FlowFolderOutput> {
    return this.createFlowFolderUseCase.execute({
      userId: user.id,
      projectId,
      parentId: dto.parentId,
      name: dto.name,
      order: dto.order,
    });
  }
}

@ApiTags('フローフォルダ')
@ApiBearerAuth()
@Controller('flow-folders')
export class FlowFolderByIdController {
  constructor(
    private readonly renameFlowFolderUseCase: RenameFlowFolderUseCase,
    private readonly moveFlowFolderUseCase: MoveFlowFolderUseCase,
    private readonly deleteFlowFolderUseCase: DeleteFlowFolderUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'フローフォルダ更新（リネーム / 移動）' })
  @ApiParam({ name: 'id', description: 'フォルダID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'フォルダが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: MoveFlowFolderDto & RenameFlowFolderDto,
  ): Promise<FlowFolderOutput> {
    // name が来た場合はリネーム、parentId/order が来た場合は移動を適用
    let result: FlowFolderOutput | undefined;

    if (dto.name !== undefined) {
      result = await this.renameFlowFolderUseCase.execute({
        userId: user.id,
        folderId: id,
        name: dto.name,
      });
    }

    if (dto.parentId !== undefined || dto.order !== undefined) {
      result = await this.moveFlowFolderUseCase.execute({
        userId: user.id,
        folderId: id,
        parentId: dto.parentId,
        order: dto.order,
      });
    }

    if (!result) {
      // 変更項目が無い場合もリネームユースケース経由で現状を取得しないため、移動で no-op を実行
      result = await this.moveFlowFolderUseCase.execute({
        userId: user.id,
        folderId: id,
      });
    }

    return result;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'フローフォルダ削除（子フォルダはカスケード削除）' })
  @ApiParam({ name: 'id', description: 'フォルダID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'フォルダが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteFlowFolderUseCase.execute({
      userId: user.id,
      folderId: id,
    });
    return { success: true };
  }
}
