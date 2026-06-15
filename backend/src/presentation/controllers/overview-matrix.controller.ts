import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// ========== DTOs ==========

class CreateOverviewMatrixDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  purpose?: string | null;
}

class PatchOverviewMatrixDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  purpose?: string | null;

  @ApiPropertyOptional({ description: 'TEXT | TAGS | SYMBOL' })
  @IsOptional()
  @IsString()
  cellMode?: string;

  // tagOptions は任意の JSON（[{key,label,color}]）。型は緩く受ける。
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  tagOptions?: unknown;
}

class OverviewAxisItemDto {
  // クライアントが安定 id を採番して送る（cells がこの id を参照するため）。
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order?: number;

  @ApiPropertyOptional({ description: 'FREE|ROLE|DATA_OBJECT|TABLE|SYSTEM|STATUS' })
  @IsOptional()
  @IsString()
  sourceType?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  sourceId?: string | null;
}

class OverviewAxisDto {
  @ApiProperty()
  @IsNumber()
  axisIndex: number;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: "'ROW' | 'COL'" })
  @IsOptional()
  @IsString()
  side?: string;

  @ApiProperty({ type: [OverviewAxisItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverviewAxisItemDto)
  items: OverviewAxisItemDto[];
}

class OverviewCellDto {
  @ApiProperty()
  @IsString()
  rowItemId: string;

  @ApiProperty()
  @IsString()
  colItemId: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  layerItemId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  value?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isApplicable?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  reason?: string | null;
}

class ReplaceOverviewMatrixDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  purpose?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cellMode?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  tagOptions?: unknown;

  @ApiProperty({ type: [OverviewAxisDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverviewAxisDto)
  axes: OverviewAxisDto[];

  @ApiProperty({ type: [OverviewCellDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverviewCellDto)
  cells: OverviewCellDto[];
}

// ========================================================================
// プロジェクト配下ルート（一覧 / 新規作成）
//   :projectId を含むので ProjectAccessGuard が projectId を解決し認可する。
// ========================================================================
@ApiTags('俯瞰思考')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/overview-matrices')
export class OverviewMatrixController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'プロジェクトの俯瞰マトリクス一覧' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async list(@Param('projectId') projectId: string) {
    const matrices = await this.prisma.overviewMatrix.findMany({
      where: { projectId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { axes: true } } },
    });
    return matrices.map((m) => ({
      id: m.id,
      name: m.name,
      purpose: m.purpose,
      cellMode: m.cellMode,
      axisCount: m._count.axes,
      updatedAt: m.updatedAt,
    }));
  }

  @Post()
  @ApiOperation({
    summary: '俯瞰マトリクスを新規作成（2軸の空ひな形を生成）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateOverviewMatrixDto,
  ) {
    const matrix = await this.prisma.$transaction(async (tx) => {
      const created = await tx.overviewMatrix.create({
        data: {
          projectId,
          name: dto.name,
          purpose: dto.purpose ?? null,
        },
      });
      // 2軸の空ひな形（行=ROW / 列=COL、項目なし）。
      await tx.overviewMatrixAxis.createMany({
        data: [
          { matrixId: created.id, axisIndex: 0, name: '行', side: 'ROW' },
          { matrixId: created.id, axisIndex: 1, name: '列', side: 'COL' },
        ],
      });
      return created;
    });

    return getOverviewMatrixSnapshot(this.prisma, matrix.id);
  }
}

// ========================================================================
// 単一マトリクスルート（:matrixId）
//   params に projectId が無いため ProjectAccessGuard は projectId を解決できず
//   素通りする。よって CRUOA 同様に、対象 matrix をロードして projectId を求め、
//   ProjectAccessService.assertProjectAccess で明示的に認可する。
//
// replace-all の id 戦略:
//   クライアントが軸項目の安定 id を採番して送り（cells はその id を参照）、
//   サーバは $transaction 内で既存 axes（cascade で items 削除）と cells を全削除し、
//   送られてきた id をそのまま使って axes/items/cells を createMany で再作成する。
//   これにより rowItemId/colItemId/layerItemId が常に有効なまま保たれ、
//   消滅した項目に紐づくセルは全削除で掃除される（CRUOA replace-all と同規律）。
// ========================================================================
@ApiTags('俯瞰思考')
@ApiBearerAuth()
@Controller('overview-matrices')
export class OverviewMatrixByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get(':matrixId')
  @ApiOperation({ summary: '俯瞰マトリクスのスナップショット取得' })
  @ApiParam({ name: 'matrixId', description: '俯瞰マトリクスID' })
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Param('matrixId') matrixId: string,
  ) {
    await this.assertAccess(matrixId, user.id, 'view');
    return this.getSnapshot(matrixId);
  }

  @Put(':matrixId')
  @ApiOperation({
    summary: '俯瞰マトリクスを一括置換（axes+items+cells を全削除→再作成）',
  })
  @ApiParam({ name: 'matrixId', description: '俯瞰マトリクスID' })
  async replace(
    @CurrentUser() user: CurrentUserPayload,
    @Param('matrixId') matrixId: string,
    @Body() dto: ReplaceOverviewMatrixDto,
  ) {
    await this.assertAccess(matrixId, user.id, 'edit');

    const axes = dto.axes ?? [];
    const cells = dto.cells ?? [];

    await this.prisma.$transaction(async (tx) => {
      // 1. 既存 cells と axes（cascade で items 削除）を全削除。
      await tx.overviewMatrixCell.deleteMany({ where: { matrixId } });
      await tx.overviewMatrixAxis.deleteMany({ where: { matrixId } });

      // 2. matrix のスカラ更新（送られたフィールドのみ）。
      const matrixUpdate: Prisma.OverviewMatrixUpdateInput = {};
      if (dto.name !== undefined) matrixUpdate.name = dto.name;
      if (dto.purpose !== undefined) matrixUpdate.purpose = dto.purpose;
      if (dto.cellMode !== undefined) matrixUpdate.cellMode = dto.cellMode;
      if (dto.tagOptions !== undefined) {
        matrixUpdate.tagOptions =
          dto.tagOptions === null
            ? Prisma.JsonNull
            : (dto.tagOptions as Prisma.InputJsonValue);
      }
      if (Object.keys(matrixUpdate).length > 0) {
        await tx.overviewMatrix.update({
          where: { id: matrixId },
          data: matrixUpdate,
        });
      }

      // 3. axes を再作成（クライアント採番 id を尊重、無ければ生成）。
      const axisItems: Prisma.OverviewMatrixAxisItemCreateManyInput[] = [];
      for (const [axisIdx, axis] of axes.entries()) {
        const created = await tx.overviewMatrixAxis.create({
          data: {
            matrixId,
            axisIndex: axis.axisIndex ?? axisIdx,
            name: axis.name,
            side: axis.side ?? 'COL',
          },
        });
        for (const [itemIdx, item] of (axis.items ?? []).entries()) {
          axisItems.push({
            ...(item.id ? { id: item.id } : {}),
            axisId: created.id,
            label: item.label,
            order: item.order ?? itemIdx,
            sourceType: item.sourceType ?? 'FREE',
            sourceId: item.sourceId ?? null,
          });
        }
      }

      // 4. items / cells を createMany で一括作成。
      if (axisItems.length > 0) {
        await tx.overviewMatrixAxisItem.createMany({ data: axisItems });
      }
      if (cells.length > 0) {
        await tx.overviewMatrixCell.createMany({
          data: cells.map((c) => ({
            matrixId,
            rowItemId: c.rowItemId,
            colItemId: c.colItemId,
            layerItemId: c.layerItemId ?? null,
            value: c.value ?? null,
            note: c.note ?? null,
            isApplicable: c.isApplicable ?? true,
            reason: c.reason ?? null,
          })),
        });
      }
    });

    return this.getSnapshot(matrixId);
  }

  @Patch(':matrixId')
  @ApiOperation({
    summary: '俯瞰マトリクスのメタ更新（name/purpose/cellMode/tagOptions）',
  })
  @ApiParam({ name: 'matrixId', description: '俯瞰マトリクスID' })
  async patch(
    @CurrentUser() user: CurrentUserPayload,
    @Param('matrixId') matrixId: string,
    @Body() dto: PatchOverviewMatrixDto,
  ) {
    await this.assertAccess(matrixId, user.id, 'edit');

    const data: Prisma.OverviewMatrixUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.purpose !== undefined) data.purpose = dto.purpose;
    if (dto.cellMode !== undefined) data.cellMode = dto.cellMode;
    if (dto.tagOptions !== undefined) {
      data.tagOptions =
        dto.tagOptions === null
          ? Prisma.JsonNull
          : (dto.tagOptions as Prisma.InputJsonValue);
    }

    await this.prisma.overviewMatrix.update({
      where: { id: matrixId },
      data,
    });
    return this.getSnapshot(matrixId);
  }

  @Delete(':matrixId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '俯瞰マトリクスを削除（cascade）' })
  @ApiParam({ name: 'matrixId', description: '俯瞰マトリクスID' })
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('matrixId') matrixId: string,
  ) {
    await this.assertAccess(matrixId, user.id, 'edit');
    await this.prisma.overviewMatrix.delete({ where: { id: matrixId } });
  }

  /** matrix をロードして projectId を求め、明示的に認可する。 */
  private async assertAccess(
    matrixId: string,
    userId: string,
    required: 'view' | 'edit',
  ): Promise<void> {
    const matrix = await this.prisma.overviewMatrix.findUnique({
      where: { id: matrixId },
      select: { projectId: true },
    });
    if (!matrix) {
      throw new NotFoundException('俯瞰マトリクスが見つかりません');
    }
    await this.projectAccess.assertProjectAccess(
      matrix.projectId,
      userId,
      required,
    );
  }

  private getSnapshot(matrixId: string) {
    return getOverviewMatrixSnapshot(this.prisma, matrixId);
  }
}

// 共有スナップショット整形。一覧/作成（projectId スコープ側）と :matrixId 側の両方から使う。
async function getOverviewMatrixSnapshot(
  prisma: PrismaService,
  matrixId: string,
) {
  const matrix = await prisma.overviewMatrix.findUnique({
    where: { id: matrixId },
    include: {
      axes: {
        orderBy: { axisIndex: 'asc' },
        include: { items: { orderBy: { order: 'asc' } } },
      },
      cells: true,
    },
  });
  if (!matrix) {
    throw new NotFoundException('俯瞰マトリクスが見つかりません');
  }
  return {
    matrix: {
      id: matrix.id,
      projectId: matrix.projectId,
      name: matrix.name,
      purpose: matrix.purpose,
      cellMode: matrix.cellMode,
      tagOptions: matrix.tagOptions,
      order: matrix.order,
      createdAt: matrix.createdAt,
      updatedAt: matrix.updatedAt,
    },
    axes: matrix.axes.map((a) => ({
      id: a.id,
      axisIndex: a.axisIndex,
      name: a.name,
      side: a.side,
      items: a.items.map((it) => ({
        id: it.id,
        label: it.label,
        order: it.order,
        sourceType: it.sourceType,
        sourceId: it.sourceId,
      })),
    })),
    cells: matrix.cells.map((c) => ({
      rowItemId: c.rowItemId,
      colItemId: c.colItemId,
      layerItemId: c.layerItemId,
      value: c.value,
      note: c.note,
      isApplicable: c.isApplicable,
      reason: c.reason,
    })),
  };
}
