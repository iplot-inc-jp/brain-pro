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
import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { SyncService } from '../../infrastructure/services/sync.service';
import { CompanyKeyService } from '../../infrastructure/services/company-key.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { EntityNotFoundError } from '../../domain';

// ========== DTOs ==========
class CreateGithubConnectionDto {
  @IsString()
  repoFullName: string; // owner/repo

  @IsOptional()
  @IsString()
  branch?: string;

  @IsString()
  token: string; // GitHub PAT（平文で受け取り暗号化して保存）

  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  syncIntervalMinutes?: number;
}

class UpdateGithubConnectionDto {
  @IsOptional()
  @IsString()
  repoFullName?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsBoolean()
  autoSync?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  syncIntervalMinutes?: number;
}

@ApiTags('GitHub連携')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class GithubConnectionController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: CryptoService,
    private readonly syncService: SyncService,
    private readonly companyKeyService: CompanyKeyService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('projects/:projectId/github-connections')
  @ApiOperation({ summary: 'プロジェクトのGitHub連携一覧（tokenは返さない）' })
  async list(@Param('projectId') projectId: string) {
    const connections = await this.prisma.githubConnection.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    return connections.map((c) => this.toResponse(c));
  }

  @Post('projects/:projectId/github-connections')
  @ApiOperation({ summary: 'GitHub連携を作成（PATを暗号化して保存）' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateGithubConnectionDto,
  ) {
    const tokenEnc = this.cryptoService.encrypt(dto.token);

    const connection = await this.prisma.githubConnection.create({
      data: {
        projectId,
        repoFullName: dto.repoFullName,
        branch: dto.branch ?? 'main',
        tokenEnc,
        autoSync: dto.autoSync ?? false,
        syncIntervalMinutes: dto.syncIntervalMinutes ?? 30,
      },
    });

    return this.toResponse(connection);
  }

  @Put('github-connections/:id')
  @ApiOperation({ summary: 'GitHub連携を更新（tokenが渡された場合のみ再暗号化）' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateGithubConnectionDto,
  ) {
    const existing = await this.prisma.githubConnection.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new EntityNotFoundError('GithubConnection', id);
    }
    // 越境IDOR防止: 対象連携のプロジェクトへの edit 権限を強制（更新の副作用より前）
    await this.projectAccess.assertPrincipalAccess(
      user,
      existing.projectId,
      'edit',
    );

    const data: Record<string, unknown> = {};
    if (dto.repoFullName !== undefined) data.repoFullName = dto.repoFullName;
    if (dto.branch !== undefined) data.branch = dto.branch;
    if (dto.token !== undefined && dto.token !== '') {
      data.tokenEnc = this.cryptoService.encrypt(dto.token);
    }
    if (dto.autoSync !== undefined) data.autoSync = dto.autoSync;
    if (dto.syncIntervalMinutes !== undefined) {
      data.syncIntervalMinutes = dto.syncIntervalMinutes;
    }

    const connection = await this.prisma.githubConnection.update({
      where: { id },
      data,
    });

    return this.toResponse(connection);
  }

  @Delete('github-connections/:id')
  @ApiOperation({ summary: 'GitHub連携を削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const existing = await this.prisma.githubConnection.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new EntityNotFoundError('GithubConnection', id);
    }
    // 越境IDOR防止: 対象連携のプロジェクトへの edit 権限を強制（削除の副作用より前）
    await this.projectAccess.assertPrincipalAccess(
      user,
      existing.projectId,
      'edit',
    );
    await this.prisma.githubConnection.delete({ where: { id } });
    return { success: true };
  }

  @Post('github-connections/:id/sync')
  @ApiOperation({ summary: '手動同期を実行（GitHub取得→AI抽出→カタログ反映）' })
  async sync(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const connection = await this.prisma.githubConnection.findUnique({
      where: { id },
    });
    if (!connection) {
      throw new EntityNotFoundError('GithubConnection', id);
    }
    // 越境IDOR防止: キー解決・外部同期(runSync)の前に対象プロジェクトへの edit 権限を強制
    await this.projectAccess.assertPrincipalAccess(
      user,
      connection.projectId,
      'edit',
    );

    // 会社(Organization)キー → ユーザーキー → 環境変数 の順で解決
    const apiKey = await this.companyKeyService.resolveForProject(
      connection.projectId,
      user.id,
    );
    if (!apiKey) {
      throw new HttpException(
        'Anthropic APIキーが未設定です',
        HttpStatus.BAD_REQUEST,
      );
    }

    // SyncService内でconnection記録を読み、CryptoServiceでtokenを復号する
    const run = await this.syncService.runSync(id, 'MANUAL', apiKey);
    return run;
  }

  @Get('github-connections/:id/runs')
  @ApiOperation({ summary: '同期実行履歴を取得（最新20件）' })
  async runs(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const connection = await this.prisma.githubConnection.findUnique({
      where: { id },
    });
    if (!connection) {
      throw new EntityNotFoundError('GithubConnection', id);
    }
    // 越境IDOR防止: 実行履歴の閲覧前に対象プロジェクトへの view 権限を強制
    await this.projectAccess.assertPrincipalAccess(
      user,
      connection.projectId,
      'view',
    );
    return this.prisma.syncRun.findMany({
      where: { connectionId: id },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }

  // ========== Private Methods ==========

  private toResponse(c: {
    id: string;
    repoFullName: string;
    branch: string;
    autoSync: boolean;
    syncIntervalMinutes: number;
    lastSyncedSha: string | null;
    lastSyncedAt: Date | null;
  }) {
    // tokenEnc は決して返さない
    return {
      id: c.id,
      repoFullName: c.repoFullName,
      branch: c.branch,
      autoSync: c.autoSync,
      syncIntervalMinutes: c.syncIntervalMinutes,
      lastSyncedSha: c.lastSyncedSha,
      lastSyncedAt: c.lastSyncedAt,
    };
  }
}
