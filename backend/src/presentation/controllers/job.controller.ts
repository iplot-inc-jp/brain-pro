import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import type { BackgroundJob, BackgroundJobStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { Public } from '../decorators/public.decorator';
import { JobService } from '../../infrastructure/services/job.service';
import { QStashService } from '../../infrastructure/services/qstash.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';

// ========== DTOs ==========

class EnqueueJobDto {
  @ApiProperty({
    description: 'ジョブ種別',
    enum: JobService.ALLOWED_TYPES as unknown as string[],
    example: 'AI_MERMAID_OBJECTMAP',
  })
  @IsString()
  type: string;

  @ApiProperty({
    description: 'ジョブ入力（秘匿情報は入れない）',
    type: Object,
    required: false,
    example: { mermaid: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places' },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

class RunJobDto {
  @ApiProperty({ description: '実行するジョブID' })
  @IsString()
  jobId: string;
}

/**
 * QStash ワーカー（push 受信）エンドポイント。
 *
 * QStash が `${PUBLIC_BASE_URL}/api/jobs/run` に POST {jobId} を配信する。
 * Upstash-Signature を「生ボディ(rawBody)」で検証し、正規配信のみ JobService.runJob を実行する。
 * rawBody は app-setup.ts の body-parser verify フックで request.rawBody に保持済み。
 *
 * 認証: @Public（JWT/APIキー不要）。代わりに QStash 署名で守る。
 * ローカル（QSTASH_CURRENT_SIGNING_KEY 未設定 = verifierEnabled=false）では
 * 署名検証ができないため、このルートは 401 を返して「無認証実行」を防ぐ。
 * ローカルではそもそもジョブは enqueue 内で inline 実行されるため、このルートは使わない。
 */
@ApiTags('ジョブ')
@Controller('jobs')
export class JobWorkerController {
  constructor(
    private readonly jobService: JobService,
    private readonly qstash: QStashService,
  ) {}

  @Public()
  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async run(@Req() req: Request, @Body() _body: RunJobDto) {
    // 本番のみ署名必須。ローカル（検証不可）では実行させない。
    if (!this.qstash.verifierEnabled) {
      throw new UnauthorizedException(
        'QStash signature verification is not configured; jobs run inline locally.',
      );
    }

    const signature =
      (req.headers['upstash-signature'] as string | undefined) ?? '';
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? '';
    if (!signature || !rawBody) {
      throw new UnauthorizedException('Missing QStash signature or body');
    }

    const url = this.qstash.runUrl();
    const ok = await this.qstash.verify(signature, rawBody, url);
    if (!ok) {
      throw new UnauthorizedException('Invalid QStash signature');
    }

    // 検証 OK のときだけ実行。rawBody を JSON parse して jobId を取り出す
    // （body-parser の result を信頼せず、署名済みの生ボディから読む）。
    let jobId: string | undefined;
    try {
      jobId = (JSON.parse(rawBody) as { jobId?: string }).jobId;
    } catch {
      jobId = undefined;
    }
    if (!jobId) {
      throw new BadRequestException('jobId is required');
    }

    // ワーカー経路: 一過性失敗時は runJob が job を QUEUED に戻して再 throw する。
    // その場合この throw を握らず伝播させ、非2xx を返して QStash の自動リトライを発火させる。
    // 試行回数を使い切った/恒久失敗は FAILED の job が返り、200 で配信完了とする。
    const job = await this.jobService.runJob(jobId, { throwOnFailure: true });
    return { id: job.id, status: job.status };
  }
}

/**
 * プロジェクト単位のジョブ起票・一覧（要認証・edit/view 権限）。
 */
@ApiTags('ジョブ')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId')
export class ProjectJobController {
  constructor(
    private readonly jobService: JobService,
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Post('ai-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'AIジョブを起票（QStash／ローカルは inline 実行）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 202, description: '起票成功（{jobId, status}）' })
  @ApiResponse({ status: 400, description: '不正なジョブ種別' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async enqueue(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: EnqueueJobDto,
  ): Promise<{ jobId: string; status: string }> {
    if (!JobService.isAllowedType(dto.type)) {
      throw new BadRequestException(
        `許可されていないジョブ種別です: ${dto.type}。許可: ${JobService.ALLOWED_TYPES.join(', ')}`,
      );
    }
    const job = await this.jobService.enqueue(dto.type, dto.payload, {
      projectId,
      createdById: user.id,
    });
    return { jobId: job.id, status: job.status };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'プロジェクトの直近ジョブ一覧' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async list(
    @Param('projectId') projectId: string,
    @Query('limit') limit?: string,
  ): Promise<BackgroundJob[]> {
    return this.prisma.backgroundJob.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: this.parseLimit(limit),
    });
  }

  /**
   * 管理者向けバッチジョブ一覧（試行記録つき）。
   *
   * 認可: ProjectAccessGuard（GET=view）を満たしたうえで、さらに isProjectAdmin
   * （super-admin or org OWNER/ADMIN）でなければ 403。
   * 各 job に attemptRecords（試行ごと status/error/時刻/duration）・attempts/maxAttempts を含む。
   * フィルタ: status（BackgroundJobStatus）。limit。
   */
  @Get('batch-jobs')
  @ApiOperation({ summary: '【管理者】バッチジョブ一覧（試行記録つき）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 403, description: '管理者権限がありません' })
  async batchJobs(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<BackgroundJob[]> {
    const isAdmin = await this.projectAccess.isProjectAdmin(projectId, user.id);
    if (!isAdmin) {
      throw new ForbiddenException(
        'バッチジョブ一覧の閲覧には管理者権限が必要です',
      );
    }

    const where: Prisma.BackgroundJobWhereInput = { projectId };
    const statusFilter = this.parseStatus(status);
    if (statusFilter) {
      where.status = statusFilter;
    }

    return this.prisma.backgroundJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: this.parseLimit(limit),
      include: {
        attemptRecords: { orderBy: { attemptNo: 'desc' } },
      },
    });
  }

  private parseLimit(limit?: string): number {
    const n = Number.parseInt(limit ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) return 20;
    return Math.min(n, 100);
  }

  /** status クエリを BackgroundJobStatus に検証して返す（不正/未指定は undefined）。 */
  private parseStatus(status?: string): BackgroundJobStatus | undefined {
    if (!status) return undefined;
    const allowed: BackgroundJobStatus[] = [
      'QUEUED',
      'RUNNING',
      'SUCCEEDED',
      'FAILED',
    ];
    return allowed.includes(status as BackgroundJobStatus)
      ? (status as BackgroundJobStatus)
      : undefined;
  }
}

/**
 * 単一ジョブ取得・手動リトライ（要認証）。
 *   - 取得: projectId ありの job … その projectId に view 権限が必要。
 *           projectId null の job … 起票者本人 or super-admin のみ。
 *   - リトライ: projectId ありの job … その projectId に edit 権限が必要（principal-aware）。
 *              projectId null の job … 起票者本人 or super-admin のみ。
 */
@ApiTags('ジョブ')
@ApiBearerAuth()
@Controller('jobs')
export class JobByIdController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly jobService: JobService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'ジョブ取得（ポーリング用。試行記録含む）' })
  @ApiParam({ name: 'id', description: 'ジョブID' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ジョブが見つかりません' })
  async getById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<BackgroundJob> {
    const job = await this.prisma.backgroundJob.findUnique({
      where: { id },
      include: {
        // 試行ごとの status/error/時刻/duration を新しい順で同梱。
        attemptRecords: { orderBy: { attemptNo: 'desc' } },
      },
    });
    if (!job) {
      throw new NotFoundException('ジョブが見つかりません');
    }

    if (job.projectId) {
      // projectId に view 権限を要求
      await this.projectAccess.assertPrincipalAccess(user, job.projectId, 'view');
      return job;
    }

    // projectId null: 起票者本人 or super-admin
    if (job.createdById && job.createdById === user.id) {
      return job;
    }
    if (await this.isSuperAdmin(user.id)) {
      return job;
    }
    throw new ForbiddenException('このジョブを参照する権限がありません');
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'ジョブの手動リトライ（管理者）' })
  @ApiParam({ name: 'id', description: 'ジョブID' })
  @ApiResponse({ status: 202, description: '再起票成功（QUEUED の job）' })
  @ApiResponse({ status: 400, description: 'リトライ不可な状態' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 404, description: 'ジョブが見つかりません' })
  async retry(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<BackgroundJob> {
    const job = await this.prisma.backgroundJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException('ジョブが見つかりません');
    }

    // 認可（principal-aware）:
    //   projectId あり → その projectId に edit 権限が必要。assertPrincipalAccess が
    //     scopeOrgId 越境拒否 + sk_ キースコープ + 会員RBAC を honor する（getById と同じ入口）。
    //   projectId null → super-admin or 起票者本人。
    if (job.projectId) {
      await this.projectAccess.assertPrincipalAccess(user, job.projectId, 'edit');
    } else {
      const authorized =
        job.createdById === user.id || (await this.isSuperAdmin(user.id));
      if (!authorized) {
        throw new ForbiddenException('このジョブをリトライする権限がありません');
      }
    }

    try {
      return await this.jobService.retry(id);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      // FAILED 以外などのリトライ不可は 400 で返す。
      if (/can be retried|only FAILED/.test(msg)) {
        throw new BadRequestException(msg);
      }
      throw e;
    }
  }

  private async isSuperAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    return !!u?.isSuperAdmin;
  }
}
