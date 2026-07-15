import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { ColumnDataType } from '@prisma/client';
import { Client } from 'pg';
import { createConnection } from 'mysql2/promise';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { EntityNotFoundError } from '../../domain';

// ========== DTOs ==========
class CreateDatabaseConnectionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  dialect?: string; // postgres / mysql / ...（既定: postgres）

  @IsString()
  connString: string; // 接続文字列（平文で受け取り暗号化して保存）
}

class UpdateDatabaseConnectionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  dialect?: string;

  @IsOptional()
  @IsString()
  connString?: string;
}

// information_schema.columns の1行（必要な列のみ）
interface InformationSchemaColumn {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string; // 'YES' | 'NO'
  column_default: string | null;
  ordinal_position: number;
  // mysql のみ: 長さ/精度付きの完全な型（例: tinyint(1), char(36)）。
  // tinyint(1)→BOOLEAN, char(36)→UUID の判定に使う。postgres では undefined。
  column_type?: string | null;
}

@ApiTags('DB接続')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class DatabaseConnectionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('projects/:projectId/database-connections')
  @ApiOperation({ summary: 'プロジェクトのDB接続一覧（接続文字列は返さない）' })
  async list(@Param('projectId') projectId: string) {
    const connections = await this.prisma.databaseConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((c) => this.toResponse(c));
  }

  @Post('projects/:projectId/database-connections')
  @ApiOperation({ summary: 'DB接続を作成（接続文字列を暗号化して保存）' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateDatabaseConnectionDto,
  ) {
    const connStringEnc = this.cryptoService.encrypt(dto.connString);

    const connection = await this.prisma.databaseConnection.create({
      data: {
        projectId,
        name: dto.name,
        dialect: dto.dialect ?? 'postgres',
        connStringEnc,
      },
    });

    return this.toResponse(connection);
  }

  @Put('database-connections/:id')
  @ApiOperation({
    summary: 'DB接続を更新（connStringが渡された場合のみ再暗号化）',
  })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDatabaseConnectionDto,
  ) {
    const existing = await this.prisma.databaseConnection.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new EntityNotFoundError('DatabaseConnection', id);
    }
    // 越境IDOR防止: 対象接続のプロジェクトへの edit 権限を強制（更新の副作用より前）
    await this.projectAccess.assertPrincipalAccess(
      user,
      existing.projectId,
      'edit',
    );

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.dialect !== undefined) data.dialect = dto.dialect;
    if (dto.connString !== undefined && dto.connString !== '') {
      data.connStringEnc = this.cryptoService.encrypt(dto.connString);
    }

    const connection = await this.prisma.databaseConnection.update({
      where: { id },
      data,
    });

    return this.toResponse(connection);
  }

  @Delete('database-connections/:id')
  @ApiOperation({ summary: 'DB接続を削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const existing = await this.prisma.databaseConnection.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new EntityNotFoundError('DatabaseConnection', id);
    }
    // 越境IDOR防止: 対象接続のプロジェクトへの edit 権限を強制（削除の副作用より前）
    await this.projectAccess.assertPrincipalAccess(
      user,
      existing.projectId,
      'edit',
    );
    await this.prisma.databaseConnection.delete({ where: { id } });
    return { success: true };
  }

  @Post('database-connections/:id/introspect')
  @ApiOperation({
    summary:
      'DBに接続してスキーマを取得し、テーブル/カラムをカタログにupsert（postgres/mysql）',
  })
  async introspect(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const connection = await this.prisma.databaseConnection.findUnique({
      where: { id },
    });
    if (!connection) {
      throw new EntityNotFoundError('DatabaseConnection', id);
    }
    // 越境IDOR防止: 復号・外部DB接続の前に対象プロジェクトへの edit 権限を強制
    await this.projectAccess.assertPrincipalAccess(
      user,
      connection.projectId,
      'edit',
    );

    if (connection.dialect !== 'postgres' && connection.dialect !== 'mysql') {
      throw new HttpException(
        '未対応のDB種別です（postgres / mysql のみ対応）',
        HttpStatus.BAD_REQUEST,
      );
    }

    const connString = this.cryptoService.decrypt(connection.connStringEnc);

    // BASE TABLE とそのカラムを取得（postgres / mysql 共通のフォーマットへ正規化）
    const tableNames: string[] = [];
    const columnRows: InformationSchemaColumn[] = [];

    if (connection.dialect === 'postgres') {
      // public スキーマの BASE TABLE とそのカラムを取得
      const client = new Client({ connectionString: connString });
      try {
        await client.connect();

        const tablesResult = await client.query<{ table_name: string }>(
          `SELECT table_name
             FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name`,
        );
        for (const row of tablesResult.rows) {
          tableNames.push(row.table_name);
        }

        const columnsResult = await client.query<InformationSchemaColumn>(
          `SELECT table_name,
                  column_name,
                  data_type,
                  is_nullable,
                  column_default,
                  ordinal_position
             FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position`,
        );
        columnRows.push(...columnsResult.rows);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpException(
          `DBへの接続またはスキーマ取得に失敗しました: ${message}`,
          HttpStatus.BAD_REQUEST,
        );
      } finally {
        // 接続は必ずクローズ（接続失敗時の end() エラーは握りつぶす）
        await client.end().catch(() => undefined);
      }
    } else {
      // mysql: 現在のデータベース（DATABASE()）の BASE TABLE とそのカラムを取得
      const conn = await createConnection(connString);
      try {
        const [tableRows] = await conn.query(
          `SELECT table_name AS table_name
             FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_type = 'BASE TABLE'
            ORDER BY table_name`,
        );
        for (const row of tableRows as Array<{ table_name: string }>) {
          tableNames.push(row.table_name);
        }

        const [colRows] = await conn.query(
          `SELECT table_name AS table_name,
                  column_name AS column_name,
                  data_type AS data_type,
                  column_type AS column_type,
                  is_nullable AS is_nullable,
                  column_default AS column_default,
                  ordinal_position AS ordinal_position
             FROM information_schema.columns
            WHERE table_schema = DATABASE()
            ORDER BY table_name, ordinal_position`,
        );
        for (const row of colRows as Array<Record<string, unknown>>) {
          columnRows.push({
            table_name: String(row.table_name),
            column_name: String(row.column_name),
            data_type: String(row.data_type),
            column_type:
              row.column_type == null ? null : String(row.column_type),
            is_nullable: String(row.is_nullable),
            column_default:
              row.column_default == null ? null : String(row.column_default),
            ordinal_position: Number(row.ordinal_position),
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new HttpException(
          `DBへの接続またはスキーマ取得に失敗しました: ${message}`,
          HttpStatus.BAD_REQUEST,
        );
      } finally {
        // 接続は必ずクローズ
        await conn.end();
      }
    }

    // テーブルを upsert（[projectId, name]）し、name → tableId を作る
    const tableIdByName = new Map<string, string>();
    for (const tableName of tableNames) {
      const table = await this.prisma.table.upsert({
        where: {
          projectId_name: { projectId: connection.projectId, name: tableName },
        },
        create: {
          projectId: connection.projectId,
          name: tableName,
        },
        update: {},
      });
      tableIdByName.set(tableName, table.id);
    }

    // カラムを upsert（[tableId, name]）
    let columnCount = 0;
    for (const col of columnRows) {
      const tableId = tableIdByName.get(col.table_name);
      // BASE TABLE 以外（ビュー等）のカラムは対象テーブルが無いのでスキップ
      if (!tableId) continue;

      const dataType = this.mapSqlType(col.data_type, col.column_type);
      const isNullable = col.is_nullable === 'YES';

      await this.prisma.column.upsert({
        where: { tableId_name: { tableId, name: col.column_name } },
        create: {
          tableId,
          name: col.column_name,
          dataType,
          isNullable,
          defaultValue: col.column_default ?? undefined,
          order: col.ordinal_position ?? 0,
        },
        update: {
          dataType,
          isNullable,
          defaultValue: col.column_default ?? undefined,
          order: col.ordinal_position ?? 0,
        },
      });
      columnCount += 1;
    }

    await this.prisma.databaseConnection.update({
      where: { id },
      data: { lastIntrospectedAt: new Date() },
    });

    return { tables: tableNames.length, columns: columnCount };
  }

  // ========== Private Methods ==========

  // connStringEnc は決して返さない
  private toResponse(c: {
    id: string;
    name: string;
    dialect: string;
    lastIntrospectedAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: c.id,
      name: c.name,
      dialect: c.dialect,
      lastIntrospectedAt: c.lastIntrospectedAt,
      createdAt: c.createdAt,
    };
  }

  /**
   * Postgres / MySQL の information_schema.columns.data_type を ColumnDataType enum に
   * ベストエフォートでマッピングする。
   *
   * @param sqlType    information_schema.columns.data_type（長さ/精度なし）
   * @param fullType   MySQL のみ: column_type（長さ/精度付き。例: tinyint(1), char(36)）。
   *                   tinyint(1)→BOOLEAN, char(36)→UUID の判定に使う。
   */
  private mapSqlType(
    sqlType: string,
    fullType?: string | null,
  ): ColumnDataType {
    const t = sqlType.toLowerCase();
    const full = (fullType ?? '').toLowerCase();

    // MySQL: tinyint(1) は慣習的に boolean
    if (full.startsWith('tinyint(1)')) return ColumnDataType.BOOLEAN;

    // MySQL: char(36) は UUID 格納に使われることが多い
    if (full.startsWith('char(36)')) return ColumnDataType.UUID;

    // uuid（postgres ネイティブ型）
    if (t === 'uuid') return ColumnDataType.UUID;

    // json / jsonb
    if (t.includes('json')) return ColumnDataType.JSON;

    // boolean（postgres bool / mysql boolean エイリアス）
    if (t.includes('bool')) return ColumnDataType.BOOLEAN;

    // 整数系（integer, smallint, bigint, int, serial,
    //         mysql: tinyint/smallint/mediumint/bigint/int）
    if (t.includes('int') || t.includes('serial')) {
      return ColumnDataType.INTEGER;
    }

    // 浮動小数・数値系
    // （numeric, decimal, real, double precision, double, float, money）
    if (
      t.includes('numeric') ||
      t.includes('decimal') ||
      t.includes('real') ||
      t.includes('double') ||
      t.includes('float') ||
      t.includes('money')
    ) {
      return ColumnDataType.FLOAT;
    }

    // 日時系（timestamp / mysql datetime は DATETIME、date は DATE）
    if (
      t.includes('timestamp') ||
      t === 'datetime' ||
      t === 'time' ||
      t.startsWith('time ')
    ) {
      return ColumnDataType.DATETIME;
    }
    if (t === 'date') return ColumnDataType.DATE;

    // テキスト系: text 系（text/tinytext/mediumtext/longtext）は TEXT、
    //             varchar/char 等は STRING
    if (t.includes('text')) return ColumnDataType.TEXT;
    if (
      t.includes('char') ||
      t.includes('varchar') ||
      t.includes('character')
    ) {
      return ColumnDataType.STRING;
    }

    // それ以外は STRING
    return ColumnDataType.STRING;
  }
}
