import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';

// DTOs
class UpsertRecordSheetDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsArray()
  rows!: any[];
}

@ApiTags('記録シート')
@ApiBearerAuth()
@Controller('projects/:projectId/record-sheets')
export class RecordSheetController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '記録シート一覧を取得（保存済みのテンプレのみ）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  async list(@Param('projectId') projectId: string) {
    const sheets = await this.prisma.recordSheet.findMany({
      where: { projectId },
      orderBy: { updatedAt: 'desc' },
    });

    return sheets.map((sheet) => ({
      templateKey: sheet.templateKey,
      title: sheet.title,
      updatedAt: sheet.updatedAt,
      rowCount: Array.isArray(sheet.rows) ? (sheet.rows as any[]).length : 0,
    }));
  }

  @Get(':templateKey')
  @ApiOperation({
    summary: '記録シートを取得（未作成でも空のシートを返す＝404にしない）',
  })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiParam({ name: 'templateKey', description: 'テンプレ識別子' })
  async get(
    @Param('projectId') projectId: string,
    @Param('templateKey') templateKey: string,
  ) {
    const sheet = await this.prisma.recordSheet.findUnique({
      where: { projectId_templateKey: { projectId, templateKey } },
    });

    if (!sheet) {
      return { templateKey, title: null, rows: [] };
    }

    return {
      templateKey: sheet.templateKey,
      title: sheet.title,
      rows: Array.isArray(sheet.rows) ? (sheet.rows as any[]) : [],
    };
  }

  @Put(':templateKey')
  @ApiOperation({ summary: '記録シートを保存（upsert）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiParam({ name: 'templateKey', description: 'テンプレ識別子' })
  async upsert(
    @Param('projectId') projectId: string,
    @Param('templateKey') templateKey: string,
    @Body() dto: UpsertRecordSheetDto,
  ) {
    const rows = (dto.rows ?? []) as Prisma.InputJsonValue;

    const sheet = await this.prisma.recordSheet.upsert({
      where: { projectId_templateKey: { projectId, templateKey } },
      create: {
        projectId,
        templateKey,
        title: dto.title ?? null,
        rows,
      },
      update: {
        title: dto.title ?? null,
        rows,
      },
    });

    return {
      templateKey: sheet.templateKey,
      title: sheet.title,
      rows: Array.isArray(sheet.rows) ? (sheet.rows as any[]) : [],
      updatedAt: sheet.updatedAt,
    };
  }

  @Delete(':templateKey')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '記録シートを削除（未作成でも無視）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiParam({ name: 'templateKey', description: 'テンプレ識別子' })
  async delete(
    @Param('projectId') projectId: string,
    @Param('templateKey') templateKey: string,
  ): Promise<void> {
    await this.prisma.recordSheet.deleteMany({
      where: { projectId, templateKey },
    });
  }
}
