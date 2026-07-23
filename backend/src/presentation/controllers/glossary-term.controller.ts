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
  ApiProperty,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GetGlossaryTermsUseCase,
  CreateGlossaryTermUseCase,
  UpdateGlossaryTermUseCase,
  DeleteGlossaryTermUseCase,
  ManageGlossaryTermMappingUseCase,
  GlossaryTermOutput,
  GlossaryTermMappingOutput,
} from '../../application';
import {
  GLOSSARY_TERM_STATUSES,
  GLOSSARY_MAPPING_CONTEXTS,
} from '../../domain';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class GlossaryTermMappingBodyDto {
  @ApiProperty({
    description:
      '文脈（ALIAS=現場の言い方 / ENGLISH / DB=テーブル.カラム / SCREEN=画面項目 / INTERFACE=電文フィールド / CODE / FORBIDDEN=使ってはいけない言い方 / OTHER）',
    required: false,
    enum: GLOSSARY_MAPPING_CONTEXTS,
  })
  @IsOptional()
  @IsIn(GLOSSARY_MAPPING_CONTEXTS as unknown as string[])
  context?: string;

  @ApiProperty({
    description: 'どのシステム・電文での呼び名か（例: 基幹DB / WMS電文 / EDI）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  systemName?: string | null;

  @ApiProperty({ description: '実際の名前', example: 'customer.customer_cd' })
  @IsString()
  value: string;

  @ApiProperty({ description: '補足', required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class CreateGlossaryTermDto {
  @ApiProperty({
    description: '概念コード（例: CPT-001）。プロジェクト内で一意',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  termCode?: string | null;

  @ApiProperty({ description: '正式用語', example: '得意先' })
  @IsString()
  name: string;

  @ApiProperty({
    description: '意味（それは何か）',
    required: false,
    nullable: true,
    example: '商品を販売する相手。請求・与信・単価・締時間の単位',
  })
  @IsOptional()
  @IsString()
  definition?: string | null;

  @ApiProperty({
    description: '正（source of truth）: 値が食い違ったときにどこを信じるか',
    required: false,
    nullable: true,
    example: '基幹システム（customer テーブル）',
  })
  @IsOptional()
  @IsString()
  sourceOfTruth?: string | null;

  @ApiProperty({
    description: '正の補足（更新経路・更新できる人など）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  sourceOfTruthNote?: string | null;

  @ApiProperty({
    description: 'ドメイン分類（取引先 / 商品 / 在庫 など。自由文字列）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({
    description: '状態',
    required: false,
    enum: GLOSSARY_TERM_STATUSES,
  })
  @IsOptional()
  @IsIn(GLOSSARY_TERM_STATUSES as unknown as string[])
  status?: string;

  @ApiProperty({
    description: '備考（紛らわしい別概念との違いなど）',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({
    description: '領域（サブプロジェクト）ID',
    required: false,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;

  @ApiProperty({
    description: '用語対応をまとめて登録する場合',
    required: false,
    type: [GlossaryTermMappingBodyDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GlossaryTermMappingBodyDto)
  mappings?: GlossaryTermMappingBodyDto[];
}

class UpdateGlossaryTermDto {
  @ApiProperty({ description: '概念コード', required: false, nullable: true })
  @IsOptional()
  @IsString()
  termCode?: string | null;

  @ApiProperty({ description: '正式用語', required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: '意味', required: false, nullable: true })
  @IsOptional()
  @IsString()
  definition?: string | null;

  @ApiProperty({ description: '正（source of truth）', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sourceOfTruth?: string | null;

  @ApiProperty({ description: '正の補足', required: false, nullable: true })
  @IsOptional()
  @IsString()
  sourceOfTruthNote?: string | null;

  @ApiProperty({ description: 'ドメイン分類', required: false, nullable: true })
  @IsOptional()
  @IsString()
  category?: string | null;

  @ApiProperty({ description: '状態', required: false, enum: GLOSSARY_TERM_STATUSES })
  @IsOptional()
  @IsIn(GLOSSARY_TERM_STATUSES as unknown as string[])
  status?: string;

  @ApiProperty({ description: '備考', required: false, nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;

  @ApiProperty({ description: '領域（サブプロジェクト）ID', required: false, nullable: true })
  @IsOptional()
  @IsString()
  subProjectId?: string | null;
}

class UpdateGlossaryTermMappingDto {
  @ApiProperty({ description: '文脈', required: false, enum: GLOSSARY_MAPPING_CONTEXTS })
  @IsOptional()
  @IsIn(GLOSSARY_MAPPING_CONTEXTS as unknown as string[])
  context?: string;

  @ApiProperty({ description: 'どのシステム・電文での呼び名か', required: false, nullable: true })
  @IsOptional()
  @IsString()
  systemName?: string | null;

  @ApiProperty({ description: '実際の名前', required: false })
  @IsOptional()
  @IsString()
  value?: string;

  @ApiProperty({ description: '補足', required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiProperty({ description: '並び順', required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

// ========== Controllers ==========

@ApiTags('用語集')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/glossary-terms')
export class GlossaryTermController {
  constructor(
    private readonly getGlossaryTermsUseCase: GetGlossaryTermsUseCase,
    private readonly createGlossaryTermUseCase: CreateGlossaryTermUseCase,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'プロジェクトの用語集一覧取得（用語対応つき）',
    description:
      '各用語は「意味（definition）」「正（sourceOfTruth）」「名前の対応（mappings）」を持つ。',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<GlossaryTermOutput[]> {
    return this.getGlossaryTermsUseCase.execute({
      userId: user.id,
      projectId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '用語作成',
    description: 'mappings を同時に渡すと用語対応もまとめて登録できる。',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'プロジェクトが見つかりません' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateGlossaryTermDto,
  ): Promise<GlossaryTermOutput> {
    return this.createGlossaryTermUseCase.execute({
      userId: user.id,
      projectId,
      termCode: dto.termCode,
      name: dto.name,
      definition: dto.definition,
      sourceOfTruth: dto.sourceOfTruth,
      sourceOfTruthNote: dto.sourceOfTruthNote,
      category: dto.category,
      status: dto.status,
      notes: dto.notes,
      order: dto.order,
      subProjectId: dto.subProjectId,
      mappings: dto.mappings,
    });
  }
}

@ApiTags('用語集')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('glossary-terms')
export class GlossaryTermByIdController {
  constructor(
    private readonly updateGlossaryTermUseCase: UpdateGlossaryTermUseCase,
    private readonly deleteGlossaryTermUseCase: DeleteGlossaryTermUseCase,
    private readonly manageMappingUseCase: ManageGlossaryTermMappingUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '用語更新' })
  @ApiParam({ name: 'id', description: '用語ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '用語が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGlossaryTermDto,
  ): Promise<GlossaryTermOutput> {
    return this.updateGlossaryTermUseCase.execute({
      userId: user.id,
      principal: user,
      termId: id,
      termCode: dto.termCode,
      name: dto.name,
      definition: dto.definition,
      sourceOfTruth: dto.sourceOfTruth,
      sourceOfTruthNote: dto.sourceOfTruthNote,
      category: dto.category,
      status: dto.status,
      notes: dto.notes,
      order: dto.order,
      subProjectId: dto.subProjectId,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用語削除（用語対応も連鎖削除）' })
  @ApiParam({ name: 'id', description: '用語ID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: '用語が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.deleteGlossaryTermUseCase.execute({
      userId: user.id,
      principal: user,
      termId: id,
    });
    return { success: true };
  }

  @Post(':id/mappings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用語対応の追加' })
  @ApiParam({ name: 'id', description: '用語ID' })
  @ApiResponse({ status: 201, description: '作成成功' })
  async createMapping(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') termId: string,
    @Body() dto: GlossaryTermMappingBodyDto,
  ): Promise<GlossaryTermMappingOutput> {
    return this.manageMappingUseCase.create({
      userId: user.id,
      principal: user,
      termId,
      context: dto.context,
      systemName: dto.systemName,
      value: dto.value,
      note: dto.note,
      order: dto.order,
    });
  }
}

@ApiTags('用語集')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('glossary-term-mappings')
export class GlossaryTermMappingController {
  constructor(
    private readonly manageMappingUseCase: ManageGlossaryTermMappingUseCase,
  ) {}

  @Patch(':id')
  @ApiOperation({ summary: '用語対応の更新' })
  @ApiParam({ name: 'id', description: '用語対応ID' })
  @ApiResponse({ status: 404, description: '用語対応が見つかりません' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGlossaryTermMappingDto,
  ): Promise<GlossaryTermMappingOutput> {
    return this.manageMappingUseCase.update({
      userId: user.id,
      principal: user,
      mappingId: id,
      context: dto.context,
      systemName: dto.systemName,
      value: dto.value,
      note: dto.note,
      order: dto.order,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用語対応の削除' })
  @ApiParam({ name: 'id', description: '用語対応ID' })
  @ApiResponse({ status: 404, description: '用語対応が見つかりません' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    await this.manageMappingUseCase.delete({
      userId: user.id,
      principal: user,
      mappingId: id,
    });
    return { success: true };
  }
}
