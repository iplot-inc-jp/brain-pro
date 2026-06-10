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
import { IsString, IsOptional, IsInt, IsIn } from 'class-validator';
import {
  CreateSystemUseCase,
  GetSystemsUseCase,
  UpdateSystemUseCase,
  DeleteSystemUseCase,
  SystemOutput,
} from '../../application';
import { SystemKindValue } from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';

const SYSTEM_KINDS = ['PERIPHERAL', 'TARGET'];

// ========== DTOs ==========

class CreateSystemDto {
  @ApiProperty({ description: 'システム名', example: '受注管理システム' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'システム種別',
    required: false,
    enum: SYSTEM_KINDS,
  })
  @IsOptional()
  @IsIn(SYSTEM_KINDS)
  kind?: SystemKindValue;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

class UpdateSystemDto {
  @ApiProperty({ description: 'システム名', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({
    description: 'システム種別',
    required: false,
    enum: SYSTEM_KINDS,
  })
  @IsOptional()
  @IsIn(SYSTEM_KINDS)
  kind?: SystemKindValue;

  @ApiProperty({ description: '説明', required: false, nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

@ApiTags('システム')
@ApiBearerAuth()
@Controller('projects/:projectId/systems')
export class SystemController {
  constructor(
    private readonly createSystemUseCase: CreateSystemUseCase,
    private readonly getSystemsUseCase: GetSystemsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトのシステム一覧取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<SystemOutput[]> {
    return this.getSystemsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'システム作成' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSystemDto,
  ): Promise<SystemOutput> {
    return this.createSystemUseCase.execute({
      userId: user.id,
      projectId,
      name: dto.name,
      kind: dto.kind,
      description: dto.description,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }
}

@ApiTags('システム')
@ApiBearerAuth()
@Controller('systems')
export class SystemByIdController {
  constructor(
    private readonly updateSystemUseCase: UpdateSystemUseCase,
    private readonly deleteSystemUseCase: DeleteSystemUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: 'システム更新' })
  @ApiParam({ name: 'id', description: 'システムID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'システムが見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSystemDto,
  ): Promise<SystemOutput> {
    return this.updateSystemUseCase.execute({
      userId: user.id,
      systemId: id,
      name: dto.name,
      kind: dto.kind,
      description: dto.description,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'システム削除' })
  @ApiParam({ name: 'id', description: 'システムID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'システムが見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteSystemUseCase.execute({
      userId: user.id,
      systemId: id,
    });
    return { success: true };
  }
}
