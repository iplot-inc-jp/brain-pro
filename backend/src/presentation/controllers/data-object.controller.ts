import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, HttpCode, Inject,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  GetObjectGraphUseCase,
  CreateDataObjectUseCase,
  UpdateDataObjectUseCase,
  UpdateDataObjectSubProjectUseCase,
  DeleteDataObjectUseCase,
  CreateObjectRelationUseCase,
  UpdateObjectRelationUseCase,
  DeleteObjectRelationUseCase,
  SaveObjectPositionsUseCase,
  ImportFromDfdUseCase,
  ImportMermaidUseCase,
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
  EntityNotFoundError, ValidationError,
  ORGANIZATION_REPOSITORY, OrganizationRepository,
  PROJECT_REPOSITORY, ProjectRepository,
} from '../../domain';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { AccessPrincipal, ProjectAccessService } from '../../infrastructure/services/project-access.service';

const CARDINALITIES = ['ONE_TO_ONE', 'ONE_TO_MANY', 'MANY_TO_MANY'];
const PATH_STYLES = ['straight', 'bezier'];
const HANDLES = ['top', 'right', 'bottom', 'left'];
/** 関係性マップ上の注釈は STICKY/COMMENT/SCOPE（ICON はフロー専用） */
const ANNOTATION_KINDS = ['STICKY', 'COMMENT', 'SCOPE'];
/** SCOPE 囲みの枠線スタイル */
const BORDER_STYLES = ['dashed', 'solid'];
/** SCOPE 矩形の既定サイズ（width/height 未設定時の仮定） */
const DEFAULT_SCOPE_WIDTH = 320;
const DEFAULT_SCOPE_HEIGHT = 200;
/**
 * オブジェクトカードの描画サイズ（フロント object-map-shared.ts の CARD_W/CARD_H と一致）。
 * positionX/positionY はカード左上原点なので、中心は (positionX+CARD_W/2, positionY+CARD_H/2)。
 */
const CARD_W = 200;
const CARD_H = 92;

class CreateDataObjectDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() color?: string | null;
  /** 所属領域（SubProject）。null=未分類 */
  @IsOptional() @IsString() subProjectId?: string | null;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateDataObjectDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() color?: string | null;
  /** null=未分類へ */
  @IsOptional() @IsString() subProjectId?: string | null;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateDataObjectSubProjectDto {
  /** null で未分類へ */
  @IsOptional() @IsString() subProjectId?: string | null;
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
  @IsOptional() @IsIn(ANNOTATION_KINDS) kind?: 'STICKY' | 'COMMENT' | 'SCOPE';
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() width?: number | null;
  @IsOptional() @IsNumber() height?: number | null;
  @IsOptional() @IsString() color?: string | null;
  /** SCOPE 枠線 'dashed'|'solid' */
  @IsOptional() @IsIn(BORDER_STYLES) borderStyle?: 'dashed' | 'solid' | null;
  /** SCOPE 背景塗りの不透明度 0-1 */
  @IsOptional() @IsNumber() fillOpacity?: number | null;
  /** SCOPE が表す領域（SubProject）。null=領域なし */
  @IsOptional() @IsString() subProjectId?: string | null;
  /** 囲みの表示/非表示 */
  @IsOptional() @IsBoolean() visible?: boolean;
  @IsOptional() @IsNumber() order?: number;
}

class UpdateAnnotationDto {
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsNumber() positionX?: number;
  @IsOptional() @IsNumber() positionY?: number;
  @IsOptional() @IsNumber() width?: number | null;
  @IsOptional() @IsNumber() height?: number | null;
  @IsOptional() @IsString() color?: string | null;
  /** SCOPE 枠線 'dashed'|'solid' */
  @IsOptional() @IsIn(BORDER_STYLES) borderStyle?: 'dashed' | 'solid' | null;
  /** SCOPE 背景塗りの不透明度 0-1 */
  @IsOptional() @IsNumber() fillOpacity?: number | null;
  /** SCOPE が表す領域（SubProject）。null=領域なし */
  @IsOptional() @IsString() subProjectId?: string | null;
  /** 囲みの表示/非表示 */
  @IsOptional() @IsBoolean() visible?: boolean;
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

class ImportMermaidDto {
  @IsString() mermaid!: string;
}

@ApiTags('データオブジェクト（オブジェクト関係性マップ・ER図）')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class DataObjectController {
  constructor(
    private readonly getObjectGraph: GetObjectGraphUseCase,
    private readonly createObject: CreateDataObjectUseCase,
    private readonly updateObject: UpdateDataObjectUseCase,
    private readonly updateObjectSubProject: UpdateDataObjectSubProjectUseCase,
    private readonly deleteObject: DeleteDataObjectUseCase,
    private readonly createRelation: CreateObjectRelationUseCase,
    private readonly updateRelation: UpdateObjectRelationUseCase,
    private readonly deleteRelation: DeleteObjectRelationUseCase,
    private readonly saveObjectPositions: SaveObjectPositionsUseCase,
    private readonly importFromDfd: ImportFromDfdUseCase,
    private readonly importMermaid: ImportMermaidUseCase,
    private readonly getErGraph: GetErGraphUseCase,
    private readonly linkTable: LinkTableToObjectUseCase,
    private readonly saveErPositions: SaveErPositionsUseCase,
    private readonly prisma: PrismaService,
    @Inject(PROJECT_REPOSITORY) private readonly projectRepo: ProjectRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly orgRepo: OrganizationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  // ===== 付箋/メモ（DataObjectAnnotation）共通ヘルパー =====

  private annotationToResponse(a: {
    id: string; projectId: string; kind: string; text: string;
    positionX: number; positionY: number; width: number | null; height: number | null;
    color: string | null; borderStyle: string | null; fillOpacity: number | null;
    subProjectId: string | null; visible: boolean;
    order: number; createdAt: Date; updatedAt: Date;
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
      borderStyle: a.borderStyle,
      fillOpacity: a.fillOpacity,
      subProjectId: a.subProjectId,
      visible: a.visible,
      order: a.order,
      updatedAt: a.updatedAt.toISOString(),
    };
  }

  /**
   * 注釈IDから所属プロジェクトを引いてメンバー認可し、行を返す。
   * 併せてプロジェクト単位 RBAC（VIEW/EDIT）を強制する（既定 view、書込は edit）。
   */
  private async authorizeAnnotation(
    id: string,
    principal: AccessPrincipal,
    required: 'view' | 'edit' = 'view',
  ) {
    const row = await this.prisma.dataObjectAnnotation.findUnique({ where: { id } });
    if (!row) throw new EntityNotFoundError('DataObjectAnnotation', id);
    await authorizeProject(
      this.projectRepo,
      this.orgRepo,
      row.projectId,
      principal,
      this.projectAccess,
      required,
    );
    return row;
  }

  /** subProjectId が存在し同一プロジェクトに属することを検証（不一致は 400） */
  private async assertSubProjectInProject(projectId: string, subProjectId: string) {
    const sp = await this.prisma.subProject.findUnique({
      where: { id: subProjectId },
      select: { projectId: true },
    });
    if (!sp) throw new EntityNotFoundError('SubProject', subProjectId);
    if (sp.projectId !== projectId) {
      throw new BadRequestException('Sub project does not belong to this project');
    }
  }

  // ========== オブジェクト関係性マップ ==========

  @Get('projects/:projectId/data-objects')
  @ApiOperation({ summary: 'オブジェクト関係性マップ取得（objects＋relations）' })
  async getGraph(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.getObjectGraph.execute({ userId: user.id, principal: user, projectId });
  }

  @Post('projects/:projectId/data-objects')
  @ApiOperation({ summary: 'データオブジェクト作成' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDataObjectDto,
  ) {
    // 未選択 <select> が出す "" は「未分類」（null）として扱う（FK へ "" を書くと P2003/500）
    return this.createObject.execute({
      userId: user.id,
      principal: user,
      projectId,
      ...dto,
      subProjectId: dto.subProjectId || null,
    });
  }

  @Patch('data-objects/:id')
  @ApiOperation({ summary: 'データオブジェクト更新（name/description/color/subProjectId/order）' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDataObjectDto,
  ) {
    // subProjectId: undefined=変更なし / ""（未選択 <select>）=未分類へ → null に正規化
    return this.updateObject.execute({
      userId: user.id,
      principal: user,
      id,
      ...dto,
      ...(dto.subProjectId !== undefined
        ? { subProjectId: dto.subProjectId || null }
        : {}),
    });
  }

  @Put('data-objects/:id/sub-project')
  @ApiOperation({ summary: 'データオブジェクトを領域（SubProject）へ紐付け/解除（subProjectId=null で未分類）' })
  async putObjectSubProject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDataObjectSubProjectDto,
  ) {
    return this.updateObjectSubProject.execute({
      userId: user.id,
      principal: user,
      id,
      // ""（未選択 <select>）/null/undefined はいずれも未分類（null）へ
      subProjectId: dto.subProjectId || null,
    });
  }

  @Delete('data-objects/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'データオブジェクト削除' })
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteObject.execute({ userId: user.id, principal: user, id });
  }

  // ========== 関係線 ==========

  @Post('projects/:projectId/data-object-relations')
  @ApiOperation({ summary: 'オブジェクト関係線作成（source=target は拒否）' })
  async createRel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateObjectRelationDto,
  ) {
    return this.createRelation.execute({ userId: user.id, principal: user, projectId, ...dto });
  }

  @Patch('data-object-relations/:id')
  @ApiOperation({ summary: 'オブジェクト関係線更新' })
  async patchRel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateObjectRelationDto,
  ) {
    return this.updateRelation.execute({ userId: user.id, principal: user, id, ...dto });
  }

  @Delete('data-object-relations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'オブジェクト関係線削除' })
  async removeRel(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.deleteRelation.execute({ userId: user.id, principal: user, id });
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
    await this.saveObjectPositions.execute({ userId: user.id, principal: user, projectId, positions: dto.positions });
  }

  // ========== DFD取り込み ==========

  @Post('projects/:projectId/data-objects/import-from-dfd')
  @ApiOperation({ summary: '第1レベルDFDのデータストアからオブジェクトを取り込み（冪等）' })
  async importDfd(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.importFromDfd.execute({ userId: user.id, principal: user, projectId });
  }

  @Post('projects/:projectId/data-objects/import-mermaid')
  @ApiOperation({ summary: 'Mermaid（erDiagram/classDiagram/flowchart）をAIで解析して関係性マップに取り込み' })
  async importMermaidGraph(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: ImportMermaidDto,
  ) {
    try {
      return await this.importMermaid.execute({
        userId: user.id,
        principal: user,
        projectId,
        mermaid: dto.mermaid,
      });
    } catch (e) {
      // 鍵未設定・空入力などは 400 に変換（Mermaid 解析失敗もユーザー入力起因）
      if (e instanceof ValidationError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }
  }

  // ========== ER図 ==========

  @Get('projects/:projectId/er-graph')
  @ApiOperation({ summary: 'ER図グラフ取得（objects＋tables＋fkEdges＋relations）' })
  async getEr(@CurrentUser() user: CurrentUserPayload, @Param('projectId') projectId: string) {
    return this.getErGraph.execute({ userId: user.id, principal: user, projectId });
  }

  @Put('projects/:projectId/er-positions')
  @HttpCode(204)
  @ApiOperation({ summary: 'ER図テーブル位置一括保存' })
  async putErPositions(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: SavePositionsDto,
  ) {
    await this.saveErPositions.execute({ userId: user.id, principal: user, projectId, positions: dto.positions });
  }

  @Put('tables/:tableId/data-object')
  @HttpCode(204)
  @ApiOperation({ summary: 'テーブルをオブジェクトに紐づけ/解除（dataObjectId=null で解除）' })
  async putTableObject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('tableId') tableId: string,
    @Body() dto: LinkTableDto,
  ) {
    await this.linkTable.execute({ userId: user.id, principal: user, tableId, dataObjectId: dto.dataObjectId ?? null });
  }

  // ========== 付箋/メモ（関係性マップ上の注釈。FlowAnnotation/DfdAnnotation と同型） ==========

  @Get('projects/:projectId/data-object-annotations')
  @ApiOperation({ summary: '関係性マップの付箋/メモ一覧' })
  async getAnnotations(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await authorizeProject(this.projectRepo, this.orgRepo, projectId, user, this.projectAccess, 'view');
    const rows = await this.prisma.dataObjectAnnotation.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((a) => this.annotationToResponse(a));
  }

  @Post('projects/:projectId/data-object-annotations')
  @ApiOperation({ summary: '関係性マップに注釈を追加（kind=STICKY|COMMENT|SCOPE）' })
  async createAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateAnnotationDto,
  ) {
    await authorizeProject(this.projectRepo, this.orgRepo, projectId, user, this.projectAccess, 'edit');
    // SCOPE の subProjectId は同一プロジェクトの SubProject か検証
    if (dto.subProjectId) {
      await this.assertSubProjectInProject(projectId, dto.subProjectId);
    }
    const row = await this.prisma.dataObjectAnnotation.create({
      data: {
        projectId,
        kind: dto.kind ?? 'STICKY',
        text: dto.text ?? '',
        positionX: dto.positionX ?? 0,
        positionY: dto.positionY ?? 0,
        width: dto.width ?? null,
        height: dto.height ?? null,
        color: dto.color ?? null,
        borderStyle: dto.borderStyle ?? null,
        fillOpacity: dto.fillOpacity ?? null,
        // ""（未選択 <select>）は「領域なし」（null）。FK へ "" を書くと P2003/500
        subProjectId: dto.subProjectId || null,
        visible: dto.visible ?? true,
        order: dto.order ?? 0,
      },
    });
    return this.annotationToResponse(row);
  }

  @Patch('data-object-annotations/:id')
  @ApiOperation({ summary: '注釈更新（text/position/width/height/color/borderStyle/fillOpacity/subProjectId/visible/order）' })
  async patchAnnotation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAnnotationDto,
  ) {
    const row = await this.authorizeAnnotation(id, user, 'edit');
    if (dto.subProjectId) {
      await this.assertSubProjectInProject(row.projectId, dto.subProjectId);
    }
    const updated = await this.prisma.dataObjectAnnotation.update({
      where: { id },
      data: {
        ...(dto.text !== undefined ? { text: dto.text } : {}),
        ...(dto.positionX !== undefined ? { positionX: dto.positionX } : {}),
        ...(dto.positionY !== undefined ? { positionY: dto.positionY } : {}),
        ...(dto.width !== undefined ? { width: dto.width } : {}),
        ...(dto.height !== undefined ? { height: dto.height } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.borderStyle !== undefined ? { borderStyle: dto.borderStyle } : {}),
        ...(dto.fillOpacity !== undefined ? { fillOpacity: dto.fillOpacity } : {}),
        ...(dto.subProjectId !== undefined
          ? { subProjectId: dto.subProjectId || null }
          : {}),
        ...(dto.visible !== undefined ? { visible: dto.visible } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });
    return this.annotationToResponse(updated);
  }

  @Delete('data-object-annotations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: '付箋/メモ削除' })
  async removeAnnotation(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.authorizeAnnotation(id, user, 'edit');
    await this.prisma.dataObjectAnnotation.delete({ where: { id } });
  }

  @Post('data-object-annotations/:id/apply-scope-links')
  @ApiOperation({
    summary: 'SCOPE 囲みの矩形に中心が含まれるオブジェクトを、その領域（SubProject）へ自動紐付け',
  })
  async applyScopeLinks(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const row = await this.authorizeAnnotation(id, user, 'edit');
    if (row.kind !== 'SCOPE' || !row.subProjectId) {
      throw new BadRequestException(
        'この注釈は領域（SubProject）が設定された SCOPE ではありません',
      );
    }
    // 注釈と SubProject の整合（同一プロジェクト）を担保
    await this.assertSubProjectInProject(row.projectId, row.subProjectId);

    const width = row.width ?? DEFAULT_SCOPE_WIDTH;
    const height = row.height ?? DEFAULT_SCOPE_HEIGHT;
    const minX = row.positionX;
    const maxX = row.positionX + width;
    const minY = row.positionY;
    const maxY = row.positionY + height;

    // プロジェクト内オブジェクトのうち、位置（中心代表点）が矩形に含まれるものを抽出
    const objects = await this.prisma.dataObject.findMany({
      where: { projectId: row.projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    // positionX/positionY はカード左上原点。中心 (positionX+CARD_W/2, positionY+CARD_H/2)
    // が矩形に含まれるかで判定する（コメントどおりの「中心」セマンティクス）
    const inside = objects.filter((o) => {
      const centerX = o.positionX + CARD_W / 2;
      const centerY = o.positionY + CARD_H / 2;
      return (
        centerX >= minX &&
        centerX <= maxX &&
        centerY >= minY &&
        centerY <= maxY
      );
    });

    if (inside.length > 0) {
      await this.prisma.dataObject.updateMany({
        where: { id: { in: inside.map((o) => o.id) }, projectId: row.projectId },
        data: { subProjectId: row.subProjectId },
      });
    }

    return {
      subProjectId: row.subProjectId,
      updated: inside.length,
      objectIds: inside.map((o) => o.id),
    };
  }
}
