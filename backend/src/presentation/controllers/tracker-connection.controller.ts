import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  Min,
} from 'class-validator';
import { IssueTrackerConnection, IssueTrackerProvider } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { JobService } from '../../infrastructure/services/job.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  assertBacklogHostSafe,
  backlogTest,
  normalizeHost,
} from '../../infrastructure/services/trackers/backlog-api';
import {
  assertJiraSiteUrlSafe,
  jiraTest,
  normalizeSiteUrl,
} from '../../infrastructure/services/trackers/jira-api';
import { UnsafeUrlError } from '../../infrastructure/services/url-safety';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

/** 対応プロバイダの許可リスト（DTO バリデーション用）。 */
const PROVIDERS = ['BACKLOG', 'JIRA'] as const;

// ========== DTOs ==========
class CreateTrackerConnectionDto {
  @IsString()
  @IsIn(PROVIDERS)
  provider: string;

  /** Backlog: スペースホスト（iplot.backlog.com）。Jira: サイトURL（https://x.atlassian.net）。 */
  @IsString()
  host: string;

  /** Jira のみ必須（Basic 認証のメール）。Backlog では不要。 */
  @IsOptional()
  @IsString()
  email?: string;

  /** Backlog: APIキー / Jira: APIトークン（平文受領→暗号化保存）。 */
  @IsString()
  credential: string;

  @IsOptional()
  @IsString()
  projectKey?: string;

  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  syncIntervalMinutes?: number;
}

class UpdateTrackerConnectionDto {
  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsString()
  email?: string;

  /**
   * credential の扱い:
   *   - 省略/空文字 … 変更なし（誤クリア防止）
   *   - 非空文字列   … 再暗号化して差し替え
   */
  @IsOptional()
  @IsString()
  credential?: string;

  @IsOptional()
  @IsString()
  projectKey?: string;

  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  syncIntervalMinutes?: number;
}

class ImportTrackerDto {
  @IsOptional()
  @IsString()
  @IsIn(['full', 'incremental'])
  mode?: 'full' | 'incremental';
}

/**
 * 外部課題トラッカー（Backlog / Jira）接続の管理 API。
 *
 * 認可: @ProjectScopedAccess で view/edit を担保したうえで、CRUD/test/import は
 * すべて「プロジェクト管理者(isProjectAdmin)」に限定する（外部接続・秘匿情報の設定は管理者ゲート）。
 * /tracker-connections/:id 系は params に projectId が無く ProjectAccessGuard が素通りするため、
 * 接続から projectId を引いて明示的に admin チェックする。
 *
 * 秘匿情報: credential はレスポンスで返さない（hasCredential:boolean のみ）。
 */
@ApiTags('外部トラッカー連携')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class TrackerConnectionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jobService: JobService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('projects/:projectId/tracker-connections')
  @ApiOperation({ summary: 'プロジェクトのトラッカー接続一覧（credentialは返さない）' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await this.assertAdmin(projectId, user);
    const rows = await this.prisma.issueTrackerConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => this.toResponse(c));
  }

  @Post('projects/:projectId/tracker-connections')
  @ApiOperation({ summary: 'トラッカー接続を作成（credentialを暗号化して保存）' })
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: CreateTrackerConnectionDto,
  ) {
    await this.assertAdmin(projectId, user);

    if (dto.provider === 'JIRA' && !dto.email) {
      throw new HttpException(
        'Jira 接続には認証メールアドレス(email)が必要です',
        HttpStatus.BAD_REQUEST,
      );
    }

    const host = this.normalizeHostForProvider(dto.provider, dto.host);
    // SSRF 対策: 保存前に宛先ホストを検証する（内部/メタデータ宛を拒否）。
    await this.assertHostSafeForProvider(dto.provider, host);
    const connection = await this.prisma.issueTrackerConnection.create({
      data: {
        projectId,
        provider: dto.provider as IssueTrackerProvider,
        host,
        email: dto.provider === 'JIRA' ? (dto.email ?? null) : null,
        credentialEnc: this.crypto.encrypt(dto.credential),
        projectKey: dto.projectKey ?? null,
        autoSync: dto.autoSync ?? false,
        syncIntervalMinutes: dto.syncIntervalMinutes ?? 60,
        status: 'active',
      },
    });
    return this.toResponse(connection);
  }

  @Patch('tracker-connections/:id')
  @ApiOperation({ summary: 'トラッカー接続を更新（credentialが渡された場合のみ再暗号化）' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTrackerConnectionDto,
  ) {
    const existing = await this.requireConnection(id);
    await this.assertAdmin(existing.projectId, user);

    const data: Record<string, unknown> = {};
    if (dto.host !== undefined) {
      const host = this.normalizeHostForProvider(existing.provider, dto.host);
      // SSRF 対策: 保存前に宛先ホストを検証する（内部/メタデータ宛を拒否）。
      await this.assertHostSafeForProvider(existing.provider, host);
      data.host = host;
    }
    if (dto.email !== undefined) {
      data.email = existing.provider === 'JIRA' ? dto.email : null;
    }
    if (dto.credential !== undefined && dto.credential !== '') {
      data.credentialEnc = this.crypto.encrypt(dto.credential);
    }
    if (dto.projectKey !== undefined) data.projectKey = dto.projectKey || null;
    if (dto.autoSync !== undefined) data.autoSync = dto.autoSync;
    if (dto.syncIntervalMinutes !== undefined) {
      data.syncIntervalMinutes = dto.syncIntervalMinutes;
    }

    const connection = await this.prisma.issueTrackerConnection.update({
      where: { id },
      data,
    });
    return this.toResponse(connection);
  }

  @Delete('tracker-connections/:id')
  @ApiOperation({ summary: 'トラッカー接続を削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const existing = await this.requireConnection(id);
    await this.assertAdmin(existing.projectId, user);
    await this.prisma.issueTrackerConnection.delete({ where: { id } });
    return { success: true };
  }

  @Post('tracker-connections/:id/test')
  @ApiOperation({ summary: '接続確認（プロジェクト/自分の取得を試す）' })
  async test(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const conn = await this.requireConnection(id);
    await this.assertAdmin(conn.projectId, user);

    const credential = this.crypto.decrypt(conn.credentialEnc);
    const result =
      conn.provider === 'BACKLOG'
        ? await backlogTest(conn.host, credential, conn.projectKey)
        : await jiraTest(
            conn.host,
            conn.email ?? '',
            credential,
            conn.projectKey,
          );

    // 接続状態を記録（test 結果を一覧に反映）。
    await this.prisma.issueTrackerConnection.update({
      where: { id },
      data: { status: result.ok ? 'active' : 'error' },
    });
    return result;
  }

  @Post('tracker-connections/:id/import')
  @ApiOperation({
    summary: 'フル移行 or 差分同期を起票（TRACKER_IMPORT ジョブ。jobId を返す）',
  })
  async import(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: ImportTrackerDto,
  ) {
    const conn = await this.requireConnection(id);
    await this.assertAdmin(conn.projectId, user);

    const mode: 'full' | 'incremental' =
      dto.mode === 'incremental' ? 'incremental' : 'full';

    // TRACKER_IMPORT は ai-jobs 許可リストに無く、内部 enqueue のみ可。
    // 秘匿情報(credential)は payload に入れず、実行時に接続から復号する。
    const job = await this.jobService.enqueue(
      'TRACKER_IMPORT',
      { connectionId: conn.id, mode },
      { projectId: conn.projectId, createdById: user.id },
    );
    return { jobId: job.id, status: job.status };
  }

  // ========== Private Methods ==========

  /**
   * プロジェクト管理者ゲート。主体（ユーザー or サービスアカウント）のスコープを効かせたうえで
   * 管理者権限を要求する。
   *
   * /tracker-connections/:id 系は URL に projectId が無く ProjectAccessGuard が素通りするため、
   *   1. assertPrincipalAccess で scopeOrgId 越境拒否 + apiKey（org/projectIds）スコープの
   *      カバレッジ + RBAC(edit) を強制し（isProjectAdmin だけでは無視されるスコープを効かせる）、
   *   2. さらに isProjectAdmin で OWNER/ADMIN（or super-admin）の管理者ゲートを課す。
   */
  private async assertAdmin(
    projectId: string,
    principal: CurrentUserPayload,
  ): Promise<void> {
    // (a) scopeOrgId 越境拒否 + (b) apiKey スコープ（org/projectIds）カバレッジ + RBAC。
    await this.projectAccess.assertPrincipalAccess(principal, projectId, 'edit');
    const isAdmin = await this.projectAccess.isProjectAdmin(
      projectId,
      principal.id,
    );
    if (!isAdmin) {
      throw new HttpException(
        'トラッカー接続の管理にはプロジェクト管理者権限が必要です',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async requireConnection(
    id: string,
  ): Promise<IssueTrackerConnection> {
    const conn = await this.prisma.issueTrackerConnection.findUnique({
      where: { id },
    });
    if (!conn) {
      throw new HttpException(
        'トラッカー接続が見つかりません',
        HttpStatus.NOT_FOUND,
      );
    }
    return conn;
  }

  /** プロバイダ別に host を正規化（Backlog はスキーム無しホスト、Jira はサイトURL）。 */
  private normalizeHostForProvider(provider: string, host: string): string {
    return provider === 'JIRA' ? normalizeSiteUrl(host) : normalizeHost(host);
  }

  /**
   * SSRF 対策: 正規化済み host が内部/メタデータ宛でないことを検証する（webhook と同じ運用）。
   * 不正なら 400 を返す（UnsafeUrlError → BAD_REQUEST に変換）。fetch 直前にも各 API
   * クライアント内で再検証されるため、設定保存後の DNS リバインディングも緩和される。
   */
  private async assertHostSafeForProvider(
    provider: string,
    host: string,
  ): Promise<void> {
    try {
      if (provider === 'JIRA') {
        await assertJiraSiteUrlSafe(host);
      } else {
        await assertBacklogHostSafe(host);
      }
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        throw new HttpException(
          `接続先ホストが許可されていません: ${e.message}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      throw e;
    }
  }

  /** credentialEnc / email は返さない。hasCredential のみ公開する。 */
  private toResponse(c: IssueTrackerConnection) {
    return {
      id: c.id,
      projectId: c.projectId,
      provider: c.provider,
      host: c.host,
      email: c.email,
      hasCredential: !!c.credentialEnc,
      projectKey: c.projectKey,
      autoSync: c.autoSync,
      syncIntervalMinutes: c.syncIntervalMinutes,
      status: c.status,
      lastSyncedAt: c.lastSyncedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
