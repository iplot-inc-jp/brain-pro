import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsArray, IsIn } from 'class-validator';
import {
  TABLE_REPOSITORY,
  ITableRepository,
  COLUMN_REPOSITORY,
  IColumnRepository,
  CRUD_MAPPING_REPOSITORY,
  ICrudMappingRepository,
  Table,
  Column,
} from '../../domain';
import { v4 as uuid } from 'uuid';

// DTOs
class CreateTableDto {
  @IsString()
  projectId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // 紐づく情報種別マスタ（共通マスタ基盤。任意）
  @IsOptional()
  @IsString()
  informationTypeId?: string | null;
}

class UpdateTableDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // 紐づく情報種別マスタ（共通マスタ基盤。任意。null で解除）
  @IsOptional()
  @IsString()
  informationTypeId?: string | null;
}

class CreateColumnDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  dataType?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPrimaryKey?: boolean;

  @IsOptional()
  @IsBoolean()
  isForeignKey?: boolean;

  @IsOptional()
  @IsBoolean()
  isNullable?: boolean;

  @IsOptional()
  @IsBoolean()
  isUnique?: boolean;

  @IsOptional()
  @IsString()
  defaultValue?: string;

  @IsOptional()
  @IsString()
  foreignKeyTable?: string;

  @IsOptional()
  @IsString()
  foreignKeyColumn?: string;

  @IsOptional()
  @IsNumber()
  order?: number;
}

class CreateCrudMappingDto {
  @IsString()
  columnId: string;

  @IsIn(['CREATE', 'READ', 'UPDATE', 'DELETE'])
  operation: 'CREATE' | 'READ' | 'UPDATE' | 'DELETE';

  @IsString()
  roleId: string;

  @IsOptional()
  @IsString()
  flowId?: string;

  @IsOptional()
  @IsString()
  flowNodeId?: string;

  @IsOptional()
  @IsString()
  how?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

// CSVインポートDTO
class ImportCsvDto {
  @IsString()
  projectId: string;

  @IsString()
  csv: string;
}

// CSVインポート結果
interface CsvImportResult {
  success: boolean;
  tablesCreated: number;
  columnsCreated: number;
  errors: string[];
}

@ApiTags('Tables')
@ApiBearerAuth()
@Controller('tables')
export class TableController {
  constructor(
    @Inject(TABLE_REPOSITORY)
    private readonly tableRepository: ITableRepository,
    @Inject(COLUMN_REPOSITORY)
    private readonly columnRepository: IColumnRepository,
    @Inject(CRUD_MAPPING_REPOSITORY)
    private readonly crudMappingRepository: ICrudMappingRepository,
  ) {}

  @Get('project/:projectId')
  @ApiOperation({ summary: 'プロジェクトのテーブル一覧を取得' })
  async getByProjectId(@Param('projectId') projectId: string) {
    const tables = await this.tableRepository.findByProjectId(projectId);
    return tables.map((t) => this.toResponse(t));
  }

  @Get(':id')
  @ApiOperation({ summary: 'テーブル詳細を取得' })
  async getById(@Param('id') id: string) {
    const table = await this.tableRepository.findById(id);
    if (!table) {
      return { error: 'Table not found' };
    }
    const columns = await this.columnRepository.findByTableId(id);
    return {
      ...this.toResponse(table),
      columns: columns.map((c) => this.columnToResponse(c)),
    };
  }

  @Post()
  @ApiOperation({ summary: 'テーブルを作成' })
  async create(@Body() dto: CreateTableDto) {
    const table = Table.create({
      id: uuid(),
      projectId: dto.projectId,
      name: dto.name,
      displayName: dto.displayName,
      description: dto.description,
      tags: dto.tags,
      informationTypeId: dto.informationTypeId,
    });
    const saved = await this.tableRepository.save(table);
    return this.toResponse(saved);
  }

  @Put(':id')
  @ApiOperation({ summary: 'テーブルを更新' })
  async update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    const table = await this.tableRepository.findById(id);
    if (!table) {
      return { error: 'Table not found' };
    }
    if (dto.name) table.updateName(dto.name);
    if (dto.displayName !== undefined) table.updateDisplayName(dto.displayName);
    if (dto.description !== undefined) table.updateDescription(dto.description);
    if (dto.informationTypeId !== undefined) {
      table.updateInformationTypeId(dto.informationTypeId);
    }
    if (dto.tags) {
      // Clear and reset tags
      table.tags.forEach((t) => table.removeTag(t));
      dto.tags.forEach((t) => table.addTag(t));
    }
    const saved = await this.tableRepository.save(table);
    return this.toResponse(saved);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'テーブルを削除' })
  async delete(@Param('id') id: string) {
    await this.tableRepository.delete(id);
    return { success: true };
  }

  // ========== Column Endpoints ==========

  @Get(':tableId/columns')
  @ApiOperation({ summary: 'カラム一覧を取得' })
  async getColumns(@Param('tableId') tableId: string) {
    const columns = await this.columnRepository.findByTableId(tableId);
    return columns.map((c) => this.columnToResponse(c));
  }

  @Post(':tableId/columns')
  @ApiOperation({ summary: 'カラムを作成' })
  async createColumn(
    @Param('tableId') tableId: string,
    @Body() dto: CreateColumnDto,
  ) {
    const column = Column.create({
      id: uuid(),
      tableId,
      name: dto.name,
      displayName: dto.displayName,
      dataType: (dto.dataType as any) || 'STRING',
      description: dto.description,
      isPrimaryKey: dto.isPrimaryKey,
      isForeignKey: dto.isForeignKey,
      isNullable: dto.isNullable,
      isUnique: dto.isUnique,
      defaultValue: dto.defaultValue,
      foreignKeyTable: dto.foreignKeyTable,
      foreignKeyColumn: dto.foreignKeyColumn,
      order: dto.order,
    });
    const saved = await this.columnRepository.save(column);
    return this.columnToResponse(saved);
  }

  @Delete(':tableId/columns/:columnId')
  @ApiOperation({ summary: 'カラムを削除' })
  async deleteColumn(@Param('columnId') columnId: string) {
    await this.columnRepository.delete(columnId);
    return { success: true };
  }

  // ========== CRUD Mapping Endpoints ==========

  @Get(':tableId/columns/:columnId/crud-mappings')
  @ApiOperation({ summary: 'カラムのCRUDマッピング一覧を取得' })
  async getCrudMappings(@Param('columnId') columnId: string) {
    const mappings = await this.crudMappingRepository.findByColumnId(columnId);
    return mappings.map((m) => ({
      id: m.id,
      columnId: m.columnId,
      operation: m.operation,
      roleId: m.roleId,
      flowId: m.flowId,
      flowNodeId: m.flowNodeId,
      how: m.how,
      condition: m.condition,
      description: m.description,
    }));
  }

  @Post('crud-mappings')
  @ApiOperation({ summary: 'CRUDマッピングを作成' })
  async createCrudMapping(@Body() dto: CreateCrudMappingDto) {
    const { CrudMapping } = await import('../../domain/entities/crud-mapping.entity');
    const mapping = CrudMapping.create({
      id: uuid(),
      columnId: dto.columnId,
      operation: dto.operation,
      roleId: dto.roleId,
      flowId: dto.flowId,
      flowNodeId: dto.flowNodeId,
      how: dto.how,
      condition: dto.condition,
      description: dto.description,
    });
    const saved = await this.crudMappingRepository.save(mapping);
    return {
      id: saved.id,
      columnId: saved.columnId,
      operation: saved.operation,
      roleId: saved.roleId,
      flowId: saved.flowId,
      flowNodeId: saved.flowNodeId,
      how: saved.how,
      condition: saved.condition,
      description: saved.description,
    };
  }

  @Delete('crud-mappings/:id')
  @ApiOperation({ summary: 'CRUDマッピングを削除' })
  async deleteCrudMapping(@Param('id') id: string) {
    await this.crudMappingRepository.delete(id);
    return { success: true };
  }

  // ========== CSV Import ==========

  @Post('import/csv')
  @ApiOperation({ summary: 'CSVからテーブルとカラムをインポート' })
  async importCsv(@Body() dto: ImportCsvDto): Promise<CsvImportResult> {
    const errors: string[] = [];
    let tablesCreated = 0;
    let columnsCreated = 0;
    const tableMap = new Map<string, string>(); // tableName -> tableId

    try {
      // CSVをパース
      const lines = dto.csv.trim().split('\n');
      if (lines.length < 2) {
        return { success: false, tablesCreated: 0, columnsCreated: 0, errors: ['CSVにデータがありません'] };
      }

      // ヘッダー行を取得
      const headers = this.parseCsvLine(lines[0]);
      const requiredHeaders = ['table_name', 'column_name'];
      for (const required of requiredHeaders) {
        if (!headers.includes(required)) {
          return { success: false, tablesCreated: 0, columnsCreated: 0, errors: [`必須ヘッダー "${required}" がありません`] };
        }
      }

      // データ行を処理
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = this.parseCsvLine(line);
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] || '';
        });

        const tableName = row['table_name'];
        const columnName = row['column_name'];

        if (!tableName || !columnName) {
          errors.push(`行 ${i + 1}: テーブル名またはカラム名が空です`);
          continue;
        }

        // テーブルが存在しない場合は作成
        if (!tableMap.has(tableName)) {
          try {
            // 既存テーブルを確認
            const existingTables = await this.tableRepository.findByProjectId(dto.projectId);
            const existing = existingTables.find((t) => t.name === tableName);
            
            if (existing) {
              tableMap.set(tableName, existing.id);
            } else {
              const table = Table.create({
                id: uuid(),
                projectId: dto.projectId,
                name: tableName,
                displayName: row['table_display_name'] || tableName,
                description: row['table_description'],
              });
              const saved = await this.tableRepository.save(table);
              tableMap.set(tableName, saved.id);
              tablesCreated++;
            }
          } catch (err) {
            errors.push(`行 ${i + 1}: テーブル "${tableName}" の作成に失敗: ${err}`);
            continue;
          }
        }

        // カラムを作成
        const tableId = tableMap.get(tableName);
        if (!tableId) continue;

        try {
          // 既存カラムを確認
          const existingColumns = await this.columnRepository.findByTableId(tableId);
          const existingColumn = existingColumns.find((c) => c.name === columnName);
          
          if (!existingColumn) {
            const column = Column.create({
              id: uuid(),
              tableId,
              name: columnName,
              displayName: row['display_name'] || columnName,
              dataType: this.parseDataType(row['data_type']),
              description: row['description'],
              isPrimaryKey: row['is_primary_key']?.toLowerCase() === 'true',
              isForeignKey: row['is_foreign_key']?.toLowerCase() === 'true',
              isNullable: row['is_nullable']?.toLowerCase() !== 'false',
              isUnique: row['is_unique']?.toLowerCase() === 'true',
              defaultValue: row['default_value'],
              foreignKeyTable: row['foreign_key_table'],
              foreignKeyColumn: row['foreign_key_column'],
              order: existingColumns.length,
            });
            await this.columnRepository.save(column);
            columnsCreated++;
          }
        } catch (err) {
          errors.push(`行 ${i + 1}: カラム "${columnName}" の作成に失敗: ${err}`);
        }
      }

      return {
        success: errors.length === 0,
        tablesCreated,
        columnsCreated,
        errors,
      };
    } catch (err) {
      return {
        success: false,
        tablesCreated,
        columnsCreated,
        errors: [...errors, `インポートエラー: ${err}`],
      };
    }
  }

  @Get('import/csv/template')
  @ApiOperation({ summary: 'CSVインポート用テンプレートを取得' })
  getCsvTemplate() {
    const template = `table_name,column_name,display_name,data_type,description,is_primary_key,is_foreign_key,is_nullable,is_unique,default_value,foreign_key_table,foreign_key_column
users,id,ユーザーID,UUID,ユーザーの一意識別子,true,false,false,true,,,
users,email,メールアドレス,STRING,ユーザーのメールアドレス,false,false,false,true,,,
users,name,名前,STRING,ユーザー名,false,false,true,false,,,
users,created_at,作成日時,DATETIME,レコード作成日時,false,false,false,false,,,
orders,id,注文ID,UUID,注文の一意識別子,true,false,false,true,,,
orders,user_id,ユーザーID,UUID,注文したユーザー,false,true,false,false,,users,id
orders,total_amount,合計金額,INTEGER,注文の合計金額,false,false,false,false,0,,`;

    return {
      template,
      headers: [
        'table_name',
        'column_name', 
        'display_name',
        'data_type',
        'description',
        'is_primary_key',
        'is_foreign_key',
        'is_nullable',
        'is_unique',
        'default_value',
        'foreign_key_table',
        'foreign_key_column',
      ],
      dataTypes: ['STRING', 'INTEGER', 'FLOAT', 'BOOLEAN', 'DATE', 'DATETIME', 'JSON', 'TEXT', 'UUID'],
    };
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());

    return result;
  }

  private parseDataType(value?: string): any {
    const validTypes = ['STRING', 'INTEGER', 'FLOAT', 'BOOLEAN', 'DATE', 'DATETIME', 'JSON', 'TEXT', 'UUID'];
    const upper = value?.toUpperCase() || 'STRING';
    return validTypes.includes(upper) ? upper : 'STRING';
  }

  private toResponse(table: Table) {
    return {
      id: table.id,
      projectId: table.projectId,
      name: table.name,
      displayName: table.displayName,
      description: table.description,
      tags: table.tags,
      informationTypeId: table.informationTypeId,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    };
  }

  private columnToResponse(column: Column) {
    return {
      id: column.id,
      tableId: column.tableId,
      name: column.name,
      displayName: column.displayName,
      dataType: column.dataType,
      description: column.description,
      isPrimaryKey: column.isPrimaryKey,
      isForeignKey: column.isForeignKey,
      isNullable: column.isNullable,
      isUnique: column.isUnique,
      defaultValue: column.defaultValue,
      foreignKeyTable: column.foreignKeyTable,
      foreignKeyColumn: column.foreignKeyColumn,
      order: column.order,
      createdAt: column.createdAt,
      updatedAt: column.updatedAt,
    };
  }
}

