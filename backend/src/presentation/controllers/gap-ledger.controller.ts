import { Controller, Get, Put, Body, Param,
  UseGuards,
} from '@nestjs/common';
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
  IsArray,
  IsInt,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { EntityNotFoundError, ForbiddenError } from '../../domain';

class GapLedgerRowDto {
  @ApiProperty()
  @IsString()
  gapId: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  impact?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  difficulty?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  phase?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  toComplete?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  target?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  order?: number;
}

class UpsertGapLedgerDto {
  @ApiProperty({ type: [GapLedgerRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GapLedgerRowDto)
  rows: GapLedgerRowDto[];
}

@ApiTags('GAP台帳')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/gap-ledgers')
export class GapLedgerController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'GAP台帳オーバーレイの一覧を取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async getLedgers(@Param('projectId') projectId: string) {
    const rows = await this.prisma.gapLedger.findMany({
      where: { projectId },
    });
    return rows.map((r) => ({
      id: r.id,
      gapId: r.gapId,
      impact: r.impact,
      difficulty: r.difficulty,
      phase: r.phase,
      toComplete: r.toComplete,
      target: r.target,
      note: r.note,
      order: r.order,
    }));
  }

  @Put()
  @ApiOperation({
    summary:
      'GAP台帳オーバーレイを行ごとに UPSERT（指定キーのみ更新するマージ方式）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async upsertLedgers(
    @Param('projectId') projectId: string,
    @Body() dto: UpsertGapLedgerDto,
  ) {
    const incoming = dto.rows ?? [];

    // ── body-id IDOR 封鎖 ──────────────────────────────────────────────
    // ガードは URL の projectId に edit を強制するが、下の upsert は
    // where:{gapId}（gapId は global unique）で URL の projectId を参照しない。
    // そのままだと、A プロジェクトへの edit 権限で body に他プロジェクト B の
    // gapId を混ぜると、B の GapLedger を上書き（更新時）／B の GAP を指す台帳を
    // A に生成（作成時）できてしまう。
    // → 各 gapId の所有者（GapItem.projectId）を先にロードし、URL の projectId と
    //   一致するものだけを許可する。存在しなければ 404、他プロジェクト所有なら 403。
    const gapIds = Array.from(new Set(incoming.map((r) => r.gapId)));
    if (gapIds.length > 0) {
      const gaps = await this.prisma.gapItem.findMany({
        where: { id: { in: gapIds } },
        select: { id: true, projectId: true },
      });
      const ownerByGapId = new Map(gaps.map((g) => [g.id, g.projectId]));
      for (const gapId of gapIds) {
        const ownerProjectId = ownerByGapId.get(gapId);
        if (ownerProjectId === undefined) {
          // GapLedger.gapId は GapItem への FK。存在しない gapId は upsert 対象外。
          throw new EntityNotFoundError('GapItem', gapId);
        }
        if (ownerProjectId !== projectId) {
          throw new ForbiddenError(
            'You cannot modify a gap ledger that belongs to another project',
          );
        }
      }
    }

    for (const row of incoming) {
      // update には呼び出し側が「明示的に渡したキーのみ」を含める
      // （roadmap UI は {gapId, phase} だけ送り、ledger UI は全項目送る。互いに上書きしないため）
      const updateData: Prisma.GapLedgerUpdateInput = {};
      if (row.impact !== undefined) updateData.impact = row.impact;
      if (row.difficulty !== undefined) updateData.difficulty = row.difficulty;
      if (row.phase !== undefined) updateData.phase = row.phase;
      if (row.toComplete !== undefined) updateData.toComplete = row.toComplete;
      if (row.target !== undefined) updateData.target = row.target;
      if (row.note !== undefined) updateData.note = row.note;
      if (row.order !== undefined) updateData.order = row.order;

      await this.prisma.gapLedger.upsert({
        where: { gapId: row.gapId },
        create: {
          projectId,
          gapId: row.gapId,
          impact: row.impact ?? null,
          difficulty: row.difficulty ?? null,
          phase: row.phase ?? null,
          toComplete: row.toComplete ?? null,
          target: row.target ?? null,
          note: row.note ?? null,
          order: row.order ?? 0,
        },
        update: updateData,
      });
    }

    const rows = await this.prisma.gapLedger.findMany({
      where: { projectId },
    });
    return rows.map((r) => ({
      id: r.id,
      gapId: r.gapId,
      impact: r.impact,
      difficulty: r.difficulty,
      phase: r.phase,
      toComplete: r.toComplete,
      target: r.target,
      note: r.note,
      order: r.order,
    }));
  }
}
