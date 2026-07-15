import { Controller, Get, Put, Body, Param, Inject } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiProperty,
} from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import {
  EntityNotFoundError,
  ForbiddenError,
  ValidationError,
  ORGANIZATION_REPOSITORY,
  OrganizationRepository,
} from '../../domain';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';

class CruoaColDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  label?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  roleId?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class CruoaRowDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  info?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class CruoaCellDto {
  @ApiProperty()
  @IsString()
  rowId: string;

  @ApiProperty()
  @IsString()
  colId: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  value?: string | null;
}

class ReplaceCruoaDto {
  @ApiProperty({ type: [CruoaColDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CruoaColDto)
  cols: CruoaColDto[];

  @ApiProperty({ type: [CruoaRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CruoaRowDto)
  rows: CruoaRowDto[];

  @ApiProperty({ type: [CruoaCellDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CruoaCellDto)
  cells: CruoaCellDto[];
}

@ApiTags('CRUOA情報の地図')
@ApiBearerAuth()
@Controller('business-flows/:flowId/cruoa')
export class CruoaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly orgRepo: OrganizationRepository,
  ) {}

  /**
   * flowId -> project -> organization メンバーシップ + プロジェクト RBAC（view|edit）を強制する。
   * このルートは params が :flowId のため ProjectAccessGuard が projectId を解決できない（素通り）。
   * 各ハンドラで対象フロー→projectId を引いてから明示的にスコープ認可する（クロステナントIDOR防止）。
   * @returns 認可済みフローの projectId
   */
  private async assertFlowAccess(
    flowId: string,
    principal: CurrentUserPayload,
    required: 'view' | 'edit',
  ): Promise<string> {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id: flowId },
      select: { projectId: true },
    });
    if (!flow) throw new EntityNotFoundError('BusinessFlow', flowId);

    const project = await this.prisma.project.findUnique({
      where: { id: flow.projectId },
      select: { organizationId: true },
    });
    if (!project) throw new EntityNotFoundError('Project', flow.projectId);
    if (!(await this.orgRepo.isMember(project.organizationId, principal.id))) {
      throw new ForbiddenError('You are not a member of this organization');
    }
    await this.projectAccess.assertPrincipalAccess(
      principal,
      flow.projectId,
      required,
    );
    return flow.projectId;
  }

  @Get()
  @ApiOperation({ summary: 'CRUOA 情報の地図（列/行/セル）を取得' })
  @ApiParam({ name: 'flowId', description: '業務フローID' })
  async getCruoa(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
  ) {
    await this.assertFlowAccess(flowId, user, 'view');

    const [cols, rows] = await Promise.all([
      this.prisma.cruoaCol.findMany({
        where: { flowId },
        orderBy: { order: 'asc' },
      }),
      this.prisma.cruoaRow.findMany({
        where: { flowId },
        orderBy: { order: 'asc' },
        include: { cells: true },
      }),
    ]);

    return {
      cols: cols.map((c) => ({
        id: c.id,
        label: c.label,
        roleId: c.roleId,
        order: c.order,
      })),
      rows: rows.map((r) => ({
        id: r.id,
        info: r.info,
        order: r.order,
      })),
      cells: rows.flatMap((r) =>
        r.cells.map((cell) => ({
          rowId: cell.rowId,
          colId: cell.colId,
          value: cell.value,
        })),
      ),
    };
  }

  @Put()
  @ApiOperation({
    summary: 'CRUOA 情報の地図を一括置換（全削除→再作成）',
  })
  @ApiParam({ name: 'flowId', description: '業務フローID' })
  async replaceCruoa(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @Body() dto: ReplaceCruoaDto,
  ) {
    // 認可: フロー→projectId を引いて edit スコープを強制（トランザクション前）。
    await this.assertFlowAccess(flowId, user, 'edit');

    const cols = dto.cols ?? [];
    const rows = dto.rows ?? [];
    const cells = dto.cells ?? [];

    // 他フローの id 混入を弾く: セルの rowId/colId は、この置換で作られる
    // （＝この flow に属する）行/列の id にのみ属していなければならない。
    // CruoaCell.colId には FK が無く、rowId の FK も他フローの行で満たされてしまうため、
    // ここで検証しないと別フローの行/列を指すセルを注入できてしまう（クロステナント書込IDOR）。
    const rowIds = new Set(rows.map((r) => r.id));
    const colIds = new Set(cols.map((c) => c.id));
    for (const cell of cells) {
      if (!rowIds.has(cell.rowId) || !colIds.has(cell.colId)) {
        throw new ValidationError(
          'CRUOA cell references a rowId/colId that does not belong to this flow',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      // このフローに属する行に紐づくセルを先に削除
      const existingRows = await tx.cruoaRow.findMany({
        where: { flowId },
        select: { id: true },
      });
      const existingRowIds = existingRows.map((r) => r.id);
      if (existingRowIds.length > 0) {
        await tx.cruoaCell.deleteMany({
          where: { rowId: { in: existingRowIds } },
        });
      }
      await tx.cruoaRow.deleteMany({ where: { flowId } });
      await tx.cruoaCol.deleteMany({ where: { flowId } });

      if (cols.length > 0) {
        await tx.cruoaCol.createMany({
          data: cols.map((c, index) => ({
            id: c.id,
            flowId,
            label: c.label ?? null,
            roleId: c.roleId ?? null,
            order: c.order ?? index,
          })),
        });
      }
      if (rows.length > 0) {
        await tx.cruoaRow.createMany({
          data: rows.map((r, index) => ({
            id: r.id,
            flowId,
            info: r.info ?? null,
            order: r.order ?? index,
          })),
        });
      }
      if (cells.length > 0) {
        await tx.cruoaCell.createMany({
          data: cells.map((cell) => ({
            rowId: cell.rowId,
            colId: cell.colId,
            value: cell.value ?? null,
          })),
        });
      }
    });

    return this.getCruoa(user, flowId);
  }
}
