import {
  Controller,
  Get,
  Put,
  Body,
  Param,
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
  IsNumber,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';

// ========== Pareto ==========
class ParetoRowDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  code?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  count?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  amount?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class ReplaceParetoDto {
  @ApiProperty({ type: [ParetoRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParetoRowDto)
  rows: ParetoRowDto[];
}

// ========== Sensitivity ==========
class SensitivityRowDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  measure?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  stars?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  difficulty?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class ReplaceSensitivityDto {
  @ApiProperty({ type: [SensitivityRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SensitivityRowDto)
  rows: SensitivityRowDto[];
}

// ========== Gap ==========
class GapRowDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  metric?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  self?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  benchmark?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  factor?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  contribution?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  hasAction?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class ReplaceGapDto {
  @ApiProperty({ type: [GapRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GapRowDto)
  rows: GapRowDto[];
}

// ========== Leak ==========
class LeakRowDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  stage?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  passCount?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  hypothesis?: string | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  order?: number;
}

class ReplaceLeakDto {
  @ApiProperty({ type: [LeakRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeakRowDto)
  rows: LeakRowDto[];
}

@ApiTags('GAP分析')
@ApiBearerAuth()
@Controller('projects/:projectId')
export class AnalysisController {
  constructor(private readonly prisma: PrismaService) {}

  // ========== Pareto ==========

  @Get('analysis-pareto')
  @ApiOperation({ summary: 'パレート分析の行一覧を取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async getPareto(@Param('projectId') projectId: string) {
    const rows = await this.prisma.analysisParetoRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        code: r.code,
        count: r.count,
        amount: r.amount,
        order: r.order,
      })),
    };
  }

  @Put('analysis-pareto')
  @ApiOperation({ summary: 'パレート分析の行を一括置換（全削除→再作成）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async replacePareto(
    @Param('projectId') projectId: string,
    @Body() dto: ReplaceParetoDto,
  ) {
    const incoming = dto.rows ?? [];
    await this.prisma.$transaction([
      this.prisma.analysisParetoRow.deleteMany({ where: { projectId } }),
      ...incoming.map((row, index) =>
        this.prisma.analysisParetoRow.create({
          data: {
            projectId,
            code: row.code ?? null,
            count: row.count ?? null,
            amount: row.amount ?? null,
            order: index,
          },
        }),
      ),
    ]);

    const rows = await this.prisma.analysisParetoRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        code: r.code,
        count: r.count,
        amount: r.amount,
        order: r.order,
      })),
    };
  }

  // ========== Sensitivity ==========

  @Get('analysis-sensitivity')
  @ApiOperation({ summary: '感度分析の行一覧を取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async getSensitivity(@Param('projectId') projectId: string) {
    const rows = await this.prisma.analysisSensitivityRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        measure: r.measure,
        stars: r.stars,
        difficulty: r.difficulty,
        order: r.order,
      })),
    };
  }

  @Put('analysis-sensitivity')
  @ApiOperation({ summary: '感度分析の行を一括置換（全削除→再作成）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async replaceSensitivity(
    @Param('projectId') projectId: string,
    @Body() dto: ReplaceSensitivityDto,
  ) {
    const incoming = dto.rows ?? [];
    await this.prisma.$transaction([
      this.prisma.analysisSensitivityRow.deleteMany({ where: { projectId } }),
      ...incoming.map((row, index) =>
        this.prisma.analysisSensitivityRow.create({
          data: {
            projectId,
            measure: row.measure ?? null,
            stars: row.stars ?? null,
            difficulty: row.difficulty ?? null,
            order: index,
          },
        }),
      ),
    ]);

    const rows = await this.prisma.analysisSensitivityRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        measure: r.measure,
        stars: r.stars,
        difficulty: r.difficulty,
        order: r.order,
      })),
    };
  }

  // ========== Gap ==========

  @Get('analysis-gap')
  @ApiOperation({ summary: 'ギャップ分析の行一覧を取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async getGap(@Param('projectId') projectId: string) {
    const rows = await this.prisma.analysisGapRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        metric: r.metric,
        self: r.self,
        benchmark: r.benchmark,
        factor: r.factor,
        contribution: r.contribution,
        hasAction: r.hasAction,
        order: r.order,
      })),
    };
  }

  @Put('analysis-gap')
  @ApiOperation({ summary: 'ギャップ分析の行を一括置換（全削除→再作成）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async replaceGap(
    @Param('projectId') projectId: string,
    @Body() dto: ReplaceGapDto,
  ) {
    const incoming = dto.rows ?? [];
    await this.prisma.$transaction([
      this.prisma.analysisGapRow.deleteMany({ where: { projectId } }),
      ...incoming.map((row, index) =>
        this.prisma.analysisGapRow.create({
          data: {
            projectId,
            metric: row.metric ?? null,
            self: row.self ?? null,
            benchmark: row.benchmark ?? null,
            factor: row.factor ?? null,
            contribution: row.contribution ?? null,
            hasAction: row.hasAction ?? null,
            order: index,
          },
        }),
      ),
    ]);

    const rows = await this.prisma.analysisGapRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        metric: r.metric,
        self: r.self,
        benchmark: r.benchmark,
        factor: r.factor,
        contribution: r.contribution,
        hasAction: r.hasAction,
        order: r.order,
      })),
    };
  }

  // ========== Leak ==========

  @Get('analysis-leak')
  @ApiOperation({ summary: '漏れ分析の行一覧を取得' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async getLeak(@Param('projectId') projectId: string) {
    const rows = await this.prisma.analysisLeakRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        stage: r.stage,
        passCount: r.passCount,
        hypothesis: r.hypothesis,
        order: r.order,
      })),
    };
  }

  @Put('analysis-leak')
  @ApiOperation({ summary: '漏れ分析の行を一括置換（全削除→再作成）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async replaceLeak(
    @Param('projectId') projectId: string,
    @Body() dto: ReplaceLeakDto,
  ) {
    const incoming = dto.rows ?? [];
    await this.prisma.$transaction([
      this.prisma.analysisLeakRow.deleteMany({ where: { projectId } }),
      ...incoming.map((row, index) =>
        this.prisma.analysisLeakRow.create({
          data: {
            projectId,
            stage: row.stage ?? null,
            passCount: row.passCount ?? null,
            hypothesis: row.hypothesis ?? null,
            order: index,
          },
        }),
      ),
    ]);

    const rows = await this.prisma.analysisLeakRow.findMany({
      where: { projectId },
      orderBy: { order: 'asc' },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        stage: r.stage,
        passCount: r.passCount,
        hypothesis: r.hypothesis,
        order: r.order,
      })),
    };
  }
}
