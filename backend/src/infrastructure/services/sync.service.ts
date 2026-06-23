import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { GithubService } from './github.service';
import { ScreenshotImportService } from './screenshot-import.service';
import {
  CodeExtractionService,
  ExtractResult,
} from './code-extraction.service';

type ColumnDataType =
  | 'STRING'
  | 'INTEGER'
  | 'FLOAT'
  | 'BOOLEAN'
  | 'DATE'
  | 'DATETIME'
  | 'JSON'
  | 'TEXT'
  | 'UUID';

const VALID_DATA_TYPES: ColumnDataType[] = [
  'STRING',
  'INTEGER',
  'FLOAT',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'JSON',
  'TEXT',
  'UUID',
];

interface SyncSummary {
  apis: number;
  tables: number;
  columns: number;
  statuses: number;
  roles: number;
  noop?: boolean;
}

/**
 * GitHub → Claude抽出 → Prisma upsert を束ねる同期サービス。
 * SyncRun のライフサイクル（RUNNING→SUCCESS/FAILED）も管理する。
 * スキーマ貼り付け用の analyzeSchema も提供する。
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly github: GithubService,
    private readonly extraction: CodeExtractionService,
    private readonly screenshots: ScreenshotImportService,
  ) {}

  /**
   * 1コネクションを同期する。
   * - SyncRun を RUNNING で作成
   * - 最新SHA取得。AUTO かつ SHA が前回と同一なら no-op で SUCCESS
   * - 関連ファイル取得 → Claude抽出 → ApiEndpoint/Table(+Status)/Role を upsert
   * - connection.lastSyncedSha/At を更新
   * - SUCCESS（件数サマリ）で完了。throw 時は FAILED でエラー記録。
   */
  async runSync(
    connectionId: string,
    trigger: 'MANUAL' | 'AUTO',
    apiKey: string,
  ): Promise<{ runId: string; status: string; summary: any }> {
    const connection = await this.prisma.githubConnection.findUnique({
      where: { id: connectionId },
    });
    if (!connection) {
      throw new Error(`GithubConnection not found: ${connectionId}`);
    }

    const run = await this.prisma.syncRun.create({
      data: {
        connectionId,
        status: 'RUNNING',
        trigger,
        startedAt: new Date(),
      },
    });

    try {
      const token = this.crypto.decrypt(connection.tokenEnc);
      const branch = connection.branch || 'main';

      const latestSha = await this.github.getLatestCommitSha(
        connection.repoFullName,
        branch,
        token,
      );

      // AUTO で変化なしなら何もしない。
      if (trigger === 'AUTO' && latestSha === connection.lastSyncedSha) {
        const summary: SyncSummary = {
          apis: 0,
          tables: 0,
          columns: 0,
          statuses: 0,
          roles: 0,
          noop: true,
        };
        await this.prisma.syncRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCESS',
            commitSha: latestSha,
            summary: summary as any,
            log: 'No changes since last sync (no-op).',
            finishedAt: new Date(),
          },
        });
        return { runId: run.id, status: 'SUCCESS', summary };
      }

      const files = await this.github.fetchRelevantFiles(
        connection.repoFullName,
        branch,
        token,
      );

      const extracted = await this.extraction.extractFromCode(files, apiKey, {
        projectId: connection.projectId,
        area: 'CODE_EXTRACTION',
        userId: null,
      });

      const summary = await this.applyExtractResult(
        connection.projectId,
        extracted,
      );

      // ページ別スクリーンショット（docs/screenshots/）も best-effort で取り込む。
      // 失敗してもコード同期自体は成功扱い（連携の本筋を止めない）。
      let shots: string = '';
      try {
        const s = await this.screenshots.importForConnection(connection);
        shots = ` Screenshots +${s.imported} ~${s.updated} -${s.removed}.`;
      } catch (e) {
        this.logger.warn(
          `Screenshot import skipped for ${connectionId}: ${(e as Error).message}`,
        );
      }

      await this.prisma.githubConnection.update({
        where: { id: connectionId },
        data: { lastSyncedSha: latestSha, lastSyncedAt: new Date() },
      });

      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCESS',
          commitSha: latestSha,
          summary: summary as any,
          log: `Processed ${files.length} files.${shots}`,
          finishedAt: new Date(),
        },
      });

      return { runId: run.id, status: 'SUCCESS', summary };
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      this.logger.error(`Sync failed for connection ${connectionId}: ${message}`);
      await this.prisma.syncRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          error: message,
          finishedAt: new Date(),
        },
      });
      return {
        runId: run.id,
        status: 'FAILED',
        summary: { error: message },
      };
    }
  }

  /**
   * スキーマ貼り付けテキストを解析して、プロジェクトの Table/Column/Status を upsert する。
   * （API/ロールはここでは扱わない。テーブル系のみ。）
   */
  async analyzeSchema(
    projectId: string,
    schemaText: string,
    apiKey: string,
  ): Promise<{ tables: number; columns: number; statuses: number }> {
    const extracted = await this.extraction.extractFromSchemaText(
      schemaText,
      apiKey,
      { projectId, area: 'CODE_EXTRACTION', userId: null },
    );
    const { tables, columns, statuses } = await this.upsertTables(
      projectId,
      extracted.tables,
    );
    return { tables, columns, statuses };
  }

  /** 抽出結果をプロジェクトに反映（API/テーブル/ロール）。 */
  private async applyExtractResult(
    projectId: string,
    extracted: ExtractResult,
  ): Promise<SyncSummary> {
    const apis = await this.upsertApiEndpoints(projectId, extracted.apis);
    const tableCounts = await this.upsertTables(projectId, extracted.tables);
    const roles = await this.upsertRoles(projectId, extracted.roles);

    return {
      apis,
      tables: tableCounts.tables,
      columns: tableCounts.columns,
      statuses: tableCounts.statuses,
      roles,
    };
  }

  private async upsertApiEndpoints(
    projectId: string,
    apis: ExtractResult['apis'],
  ): Promise<number> {
    let count = 0;
    for (const api of apis) {
      if (!api.method || !api.path) continue;
      await this.prisma.apiEndpoint.upsert({
        where: {
          projectId_method_path: {
            projectId,
            method: api.method,
            path: api.path,
          },
        },
        update: {
          summary: api.summary ?? undefined,
          sourceFile: api.sourceFile ?? undefined,
        },
        create: {
          projectId,
          method: api.method,
          path: api.path,
          summary: api.summary,
          sourceFile: api.sourceFile,
        },
      });
      count++;
    }
    return count;
  }

  private async upsertTables(
    projectId: string,
    tables: ExtractResult['tables'],
  ): Promise<{ tables: number; columns: number; statuses: number }> {
    let tableCount = 0;
    let columnCount = 0;
    let statusCount = 0;

    for (const table of tables) {
      if (!table.name) continue;

      const savedTable = await this.prisma.table.upsert({
        where: {
          projectId_name: { projectId, name: table.name },
        },
        update: {
          displayName: table.displayName ?? undefined,
        },
        create: {
          projectId,
          name: table.name,
          displayName: table.displayName,
        },
      });
      tableCount++;

      // カラム upsert（[tableId, name] でユニーク）。
      let order = 0;
      for (const col of table.columns ?? []) {
        if (!col.name) continue;
        const dataType = this.normalizeDataType(col.dataType);
        await this.prisma.column.upsert({
          where: {
            tableId_name: { tableId: savedTable.id, name: col.name },
          },
          update: {
            dataType,
          },
          create: {
            tableId: savedTable.id,
            name: col.name,
            dataType,
            order,
          },
        });
        order++;
        columnCount++;
      }

      // ステータス upsert（[tableId, value] でユニーク）。
      for (const status of table.statuses ?? []) {
        if (status.value === undefined || status.value === null) continue;
        await this.prisma.tableStatus.upsert({
          where: {
            tableId_value: { tableId: savedTable.id, value: status.value },
          },
          update: {
            label: status.label ?? undefined,
            order: status.order ?? undefined,
          },
          create: {
            tableId: savedTable.id,
            value: status.value,
            label: status.label,
            order: status.order ?? 0,
          },
        });
        statusCount++;
      }
    }

    return { tables: tableCount, columns: columnCount, statuses: statusCount };
  }

  private async upsertRoles(
    projectId: string,
    roles: ExtractResult['roles'],
  ): Promise<number> {
    // Role は [projectId, name] のユニーク制約があるので upsert 可能。
    let count = 0;
    for (const role of roles) {
      if (!role.name) continue;
      await this.prisma.role.upsert({
        where: {
          projectId_name: { projectId, name: role.name },
        },
        update: {
          type: role.type ?? undefined,
        },
        create: {
          projectId,
          name: role.name,
          type: role.type ?? 'HUMAN',
        },
      });
      count++;
    }
    return count;
  }

  private normalizeDataType(dataType?: string): ColumnDataType {
    if (!dataType) return 'STRING';
    const upper = dataType.toUpperCase() as ColumnDataType;
    return VALID_DATA_TYPES.includes(upper) ? upper : 'STRING';
  }
}
