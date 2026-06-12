import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, HttpCode, Inject,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GetObjectGraphUseCase,
  CreateDataObjectUseCase,
  UpdateDataObjectUseCase,
  DeleteDataObjectUseCase,
  CreateObjectRelationUseCase,
  UpdateObjectRelationUseCase,
  DeleteObjectRelationUseCase,
  SaveObjectPositionsUseCase,
  ImportFromDfdUseCase,
  GetErGraphUseCase,
  LinkTableToObjectUseCase,
  SaveErPositionsUseCase,
} from '../../application';
import { authorizeProject } from '../../application/use-cases/data-object/data-object-authz';
import {
  RelationCardinalityValue,
  RelationHandleValue,
  RelationPathStyleValue,
} from '../../domain/entities/data-object-relation.entity';
import {
  EntityNotFoundError,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  PROJECT_REPOSITORY, ProjectRepository,
} from '../../domain';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';

const CARDINALITIES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'];
const PATH_STYLES = ['straight', 'bezier'];
const HANDLES = ['top', 'right', 'bottom', 'left'];
/** 関係性マップ上の付箋/メモは STICKY/COMMENT のみ（SCOPE/ICON はフロー専用） */
const ANNOTATION_KINDS = ['STICKY', 'COMMENT'];

class CreateDataObjectDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateDataObjectDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class CreateObjectRelationDto {
  @IsString() sourceObjectId!: string;
  @IsString() targetObjectId!: string;
  @IsOptional() @IsIn(CARDINALITIES) cardinality?: RelationCardinalityValue;
  @IsOptional() @IsString() label?: string | null;
  @IsOptional() @IsString() description?: string | null;
  /** 'straight'|'bezier'。null/省略=既定の直線 */
  @IsOptional() @IsIn(PATH_STYLES) pathStyle?: RelationPathStyleValue | null;
  /** 'top'|'right'|'bottom'|'left'。null/省略=自動アンカー */
  @IsOptional() @IsIn(HANDLES) sourceHandle?: RelationHandleValue | null;
  @IsOptional() @IsIn(HANDLES) targetHandle?: RelationHandleValue | null;
}

class UpdateObjectRelationDto {
  @IsOptional() @IsString() sourceObjectId?: string;
  @IsOptional() @IsString() targetObjectId?: string;
  @IsOptional() @IsIn(CARDINALITIES) cardinality?: RelationCardinalityValue;
  @IsOptional() @IsString() label?: string | null;
  @IsOptional() @IsString() description?: string | null;
  /** undefined=変更なし / null=既定の直線へ戻す（@IsOptional は null も素通しする） */
  @IsOptional() @IsIn(PATH_STYLES) pathStyle?: RelationPathStyleValue | null;
  /** undefined=変更なし / null=自動アンカーへ戻す */
  @IsOptional() @IsIn(HANDLES) sourceHandle?: RelationHandleValue | null;
  @IsOptional() @IsIn(HANDLES) targetHandle?: RelationHandleValue | null;
}

class CreateAnnotationDto {
  @IsOptional() @IsIn(ANNOTATION_KINDS) kind?: 'STICKY' | 'COMMENT';
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateAnnotationDto {
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() width?: number | null;
  @IsOptional() @IsNumber() height?: number | null;
  @IsOptional() @IsString() color?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class PositionItemDto {
  @IsString() id!: string;
  @IsNumber() positionX!: number;
  @IsNumber() positionY!: number;
}

class SavePositionsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PositionItemDto)
  positions!: PositionItemDto[];
}

class LinkTableDto {
  /** null で紐づけ解除 */
  @IsOptional() @IsString() dataObjectId?: string | null;
}

@ApiTags('データオブジェクト（オブジェクト関係性マップ・ER図）')
@ApiBearerAuth()
@Controller()
export class DataObjectController {
  constructor(
    private readonly getObjectGraph: GetObjectGraphUseCase,
    private readonly createObject: CreateDataObjectUseCase,
    private readonly updateObject: UpdateDataObjectUseCase,
    private readonly deleteObject: DeleteDataObjectUseCase,
    private readonly createRelation: CreateObjectRelationUseCase,
    private readonly updateRelation: UpdateObjectRelationUseCase,
    private readonly deleteRelation: DeleteObjectRelationUseCase,
    private readonly saveObjectPositions: SaveObjectPositionsUseCase,
    private readonly importFromDfd: ImportFromDfdUseCase,
    private readonly getErGraph: GetErGraphUseCase,
    private readonly linkTable: LinkTableToObjectUseCase,
    private readonly saveErPositions: SaveErPositionsUseCase,
    private readonly prisma: PrismaService,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
  ) {}

  // ===== 付箋/メモ（DataObjectAnnotation）共通ヘルパー =====

  private annotationToResponse(a: {
    id: string; projectId: string; kind: string; text: string;
    positionX: number; positionY: number; width: number | null; height: number | null;
    color: string | null; order: number; createdAt: Date; updatedAt: Date;
  }) {
    return {
      id: a.id,
      projectId: a.projectId,
      kind: a.kind,
      text: a.text,
      positionX: a.positionX,
      positionY: a.positionY,
      width: a.width,
      height: a.height,
      color: a.color,
      order: a.order,
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  /** 注釈IDから所属プロジェクトを引いてメンバー認可し、行を返す */
  private async authorizeAnnotation(id: string, userId: string) {
    const row = await this.prisma.dataObjectAnnotation.findUnique({ where: { id } });
    if (!row) throw new EntityNotFoundError('DataObjectAnnotation', id);
    await authorizeProject(this.projectRepo, this.orgRepo, row.projectId, userId);
    return row;
  }

  // ========== オブジェクト関係性マップ ==========

  @Get('projects/:projectId/data-objects')
  @ApiOperation({ summary: 'オブジェクト関係性マップ取得（objects＋relations）' })
  async getGraph(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.getObjectGraph.execute({ userId: user.id, projectId });
  }

  @Post('projects/:projectId/data-objects')
  @ApiOperation({ summary: 'データオブジェクト作成' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDataObjectDto,
  ) {
    return this.createObject.execute({ userId: user.id, projectId, ...dto });
  }

  @Patch('data-objects/:id')
  @ApiOperation({ summary: 'データオブジェクト更新（name/description/color/order）' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDataObjectDto,
  ) {
    return this.updateObject.execute({ userId: user.id, id, ...dto });
  }

  @Delete('data-objects/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'データオブジェクト削除' })
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteObject.execute({ userId: user.id, id });
  }

  // ========== 関係線 ==========

  @Post('projects/:projectId/data-object-relations')
  @ApiOperation({ summary: 'オブジェクト関係線作成（source=target は拒否）' })
  async createRel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateObjectRelationDto,
  ) {
    return this.createRelation.execute({ userId: user.id, projectId, ...dto });
  }

  @Patch('data-object-relations/:id')
  @ApiOperation({ summary: 'オブジェクト関係線更新' })
  async patchRel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateObjectRelationDto,
  ) {
    return this.updateRelation.execute({ userId: user.id, id, ...dto });
  }

  @Delete('data-object-relations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'オブジェクト関係線削除' })
  async removeRel(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteRelation.execute({ userId: user.id, id });
  }

  // ========== 位置一括保存（マップ） ==========

  @Put('projects/:projectId/data-objects/positions')
  @HttpCode(204)
  @ApiOperation({ summary: 'オブジェクト位置一括保存' })
  async putPositions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: SavePositionsDto,
  ) {
    await this.saveObjectPositions.execute({ userId: user.id, projectId, positions: dto.positions });
  }

  // ========== DFD取り込み ==========

  @Post('projects/:projectId/data-objects/import-from-dfd')
  @ApiOperation({ summary: '第1レベルDFDのデータストアからオブジェクトを取り込み（冪等）' })
  async importDfd(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.importFromDfd.execute({ userId: user.id, projectId });
  }

  // ========== ER図 ==========

  @Get('projects/:projectId/er-graph')
  @ApiOperation({ summary: 'ER図グラフ取得（objects＋tables＋fkEdges＋relations）' })
  async getEr(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.getErGraph.execute({ userId: user.id, projectId });
  }

  @Put('projects/:projectId/er-positions')
  @HttpCode(204)
  @ApiOperation({ summary: 'ER図テーブル位置一括保存' })
  async putErPositions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: SavePositionsDto,
  ) {
    await this.saveErPositions.execute({ userId: user.id, projectId, positions: dto.positions });
  }

  @Put('tables/:tableId/data-object')
  @HttpCode(204)
  @ApiOperation({ summary: 'テーブルをオブジェクトに紐づけ/解除（dataObjectId=null で解除）' })
  async putTableObject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('tableId') tableId: string,
    @Body() dto: LinkTableDto,
  ) {
    await this.linkTable.execute({ userId: user.id, tableId, dataObjectId: dto.dataObjectId ?? null });
  }

  // ========== 付箋/メモ（関係性マップ上の注釈。FlowAnnotation/DfdAnnotation と同型） ==========

  @Get('projects/:projectId/data-object-annotations')
  @ApiOperation({ summary: '関係性マップの付箋/メモ一覧' })
  async getAnnotations(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await authorizeProject(this.projectRepo, this.orgRepo, projectId, user.id);
    const rows = await this.prisma.dataObjectAnnotation.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((a) => this.annotationToResponse(a));
  }

  @Post('projects/:projectId/data-object-annotations')
  @ApiOperation({ summary: '関係性マップに付箋/メモを追加（kind=STICKY|COMMENT）' })
  async createAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateAnnotationDto,
  ) {
    await authorizeProject(this.projectRepo, this.orgRepo, projectId, user.id);
    const row = await this.prisma.dataObjectAnnotation.create({
      data: {
        projectId,
        kind: dto.kind ?? 'STICKY',
        text: dto.text ?? '',
        positionX: dto.positionX ?? 0,
        positionY: dto.positionY ?? 0,
        color: dto.color ?? null,
        order: dto.order ?? 0,
      },
    });
    return this.annotationToResponse(row);
  }

  @Patch('data-object-annotations/:id')
  @ApiOperation({ summary: '付箋/メモ更新（text/position/width/height/color/order）' })
  async patchAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAnnotationDto,
  ) {
    await this.authorizeAnnotation(id, user.id);
    const row = await this.prisma.dataObjectAnnotation.update({
      where: { id },
      data: {
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(dto.positionX !== undefined ? { positionX: dto.positionX } : {}),
        ...(dto.positionY !== undefined ? { positionY: dto.positionY } : {}),
        ...(dto.width !== undefined ? { width: dto.width } : {}),
        ...(dto.height !== undefined ? { height: dto.height } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    return this.annotationToResponse(row);
  }

  @Delete('data-object-annotations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '付箋/メモ削除' })
  async removeAnnotation(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.authorizeAnnotation(id, user.id);
    await this.prisma.dataObjectAnnotation.delete({ where: { id } });
  }
}
