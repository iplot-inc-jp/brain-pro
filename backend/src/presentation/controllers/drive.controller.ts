import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { DriveService } from '../../infrastructure/knowledge/drive.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import { CurrentUser, CurrentUserPayload } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

/**
 * Google Drive 連携（バッチ取り込みの DRIVE ソース）。
 *
 * フロー:
 *   1. GET projects/:projectId/drive/auth-url → 同意画面 URL を返す（state は HMAC 署名トークン）。フロントが遷移。
 *   2. Google が GET drive/callback?code&state へリダイレクト（@Public: 我々の JWT は付かない）。
 *      → verifyState で署名・期限・projectId を検証 → exchangeCode で refresh_token 暗号化保存 → フロントへ redirect。
 *   3. GET projects/:projectId/drive/files?folderId= → ファイル一覧（バッチ作成の選択肢）。
 *   4. DELETE projects/:projectId/drive/connection → 切断。
 *
 * 認可: auth-url / files / connection は assertProjectAccess。callback は無認可（OAuth リダイレクトに JWT は無い）
 *       だが、state を {projectId,userId,nonce,exp} の HMAC(TOKEN_ENC_KEY) 署名トークンにし、verifyState で
 *       署名・期限を検証する。検証済みの projectId のみを接続紐付け・リダイレクト先の信頼源にする（検証失敗は 400 相当）。
 */
@ApiTags('Google Drive 連携')
@Controller()
export class DriveController {
  constructor(
    private readonly drive: DriveService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Get('projects/:projectId/drive/auth-url')
  @ApiBearerAuth()
  @ProjectScopedAccess()
  @UseGuards(ProjectAccessGuard)
  @ApiOperation({ summary: 'Google Drive OAuth 同意画面 URL（state=projectId）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '{ authUrl, connected, email }' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 503, description: 'Drive 連携が未構成' })
  async authUrl(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<{ authUrl: string; connected: boolean; email: string | null }> {
    // 接続は課金処理の前段（書込相当）。edit を要求。
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'edit');
    if (!this.drive.driveEnabled) {
      throw new HttpException(
        'Google Drive 連携が未構成です（管理者が GOOGLE_CLIENT_ID 等を設定する必要があります）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const current = await this.drive.getConnection(projectId);
    return {
      // state は {projectId,userId,nonce,exp} を HMAC 署名した単回・期限付きトークン。
      authUrl: this.drive.authUrl(projectId, user.id),
      connected: current.connected,
      email: current.email,
    };
  }

  @Get('drive/callback')
  @Public()
  @ApiOperation({ summary: 'Google OAuth コールバック（code/state→接続保存→簡易HTML）' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    // state を最優先で署名検証する。検証できれば projectId はここから得た信頼源を使う
    // （リダイレクト先・接続紐付けの両方）。検証失敗・期限切れ・改ざんは 400 相当で拒否。
    let verified: { projectId: string; userId: string | null };
    try {
      verified = this.drive.verifyState(state ?? '');
    } catch (err) {
      const message = (err as Error)?.message ?? 'state が不正です';
      return this.sendResult(res, false, `不正なリクエストです: ${message}`, undefined);
    }
    const projectId = verified.projectId;

    if (error) {
      return this.sendResult(res, false, `Google 連携がキャンセルされました（${error}）`, projectId);
    }
    if (!code) {
      return this.sendResult(res, false, 'code がありません', projectId);
    }
    try {
      const result = await this.drive.exchangeCode(code, projectId, verified.userId ?? undefined);
      return this.sendResult(
        res,
        true,
        `Google Drive を接続しました${result.email ? `（${result.email}）` : ''}`,
        projectId,
      );
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      return this.sendResult(res, false, `接続に失敗しました: ${message}`, projectId);
    }
  }

  @Get('projects/:projectId/drive/files')
  @ApiBearerAuth()
  @ProjectScopedAccess()
  @UseGuards(ProjectAccessGuard)
  @ApiOperation({ summary: 'Drive ファイル/フォルダ一覧（バッチ作成の選択肢）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiQuery({ name: 'folderId', required: false, description: 'フォルダID（未指定はルート）' })
  @ApiQuery({ name: 'q', required: false, description: 'ファイル名の部分一致検索' })
  @ApiResponse({
    status: 200,
    description: '{ connected: boolean, email: string|null, files: DriveFileRef[] }',
  })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @ApiResponse({ status: 503, description: 'Drive 連携が未構成' })
  async files(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Query('folderId') folderId?: string,
    @Query('q') q?: string,
  ): Promise<{
    connected: boolean;
    email: string | null;
    files: Awaited<ReturnType<DriveService['listFiles']>>;
  }> {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'view');
    if (!this.drive.driveEnabled) {
      throw new HttpException(
        'Google Drive 連携が未構成です',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // フロント契約: { connected, email, files }。未接続なら files=[] で connected=false を返す。
    const connection = await this.drive.getConnection(projectId);
    if (!connection.connected) {
      return { connected: false, email: null, files: [] };
    }
    try {
      const files = await this.drive.listFiles(projectId, { folderId, q });
      return { connected: true, email: connection.email, files };
    } catch (err) {
      throw new HttpException(
        (err as Error)?.message ?? 'Drive 一覧の取得に失敗しました',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Delete('projects/:projectId/drive/connection')
  @ApiBearerAuth()
  @ProjectScopedAccess()
  @UseGuards(ProjectAccessGuard)
  @ApiOperation({ summary: 'Google Drive 接続を切断（refresh token を削除）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiResponse({ status: 200, description: '{ deleted }' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  async deleteConnection(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ): Promise<{ deleted: number }> {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'edit');
    return this.drive.deleteConnection(projectId);
  }

  // ===================== 内部ヘルパ =====================

  /**
   * コールバックの結果をユーザーへ返す。
   * FRONTEND_URL があればそのナレッジ取り込み画面へ ?driveConnected= 付きでリダイレクト、
   * 無ければ簡易 HTML（タブを閉じてくださいの案内）を返す。
   */
  private sendResult(
    res: Response,
    ok: boolean,
    message: string,
    projectId?: string,
  ): void {
    const frontend = (process.env.FRONTEND_URL || '').split(',')[0]?.trim();
    if (frontend && projectId) {
      const url = new URL(
        `/dashboard/projects/${encodeURIComponent(projectId)}/knowledge/ingestion`,
        frontend,
      );
      url.searchParams.set('driveConnected', ok ? '1' : '0');
      url.searchParams.set('driveMessage', message);
      res.redirect(url.toString());
      return;
    }
    res
      .status(ok ? 200 : 400)
      .header('Content-Type', 'text/html; charset=utf-8')
      .send(
        `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Google Drive 連携</title></head>` +
          `<body style="font-family:system-ui,sans-serif;padding:2rem;text-align:center">` +
          `<h1>${ok ? '接続完了' : '接続失敗'}</h1>` +
          `<p>${this.escapeHtml(message)}</p>` +
          `<p>このタブを閉じて、Brain Pro に戻ってください。</p>` +
          `</body></html>`,
      );
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
