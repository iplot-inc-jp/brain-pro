import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser, CurrentUserPayload } from '../decorators';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  AttachmentRegisterService,
  RegisterBlobInput,
} from '../../infrastructure/services/attachment-register.service';

/**
 * client 直アップロード（@vercel/blob/client）用のエンドポイント群。
 * - token 発行: handleUpload で client アップロード token を発行（onBeforeGenerateToken で edit 認可）。
 *   BLOB_READ_WRITE_TOKEN 未設定（ローカル）なら { enabled:false } を返し、フロントはサーバ経由にフォールバック。
 * - register-blob: client が Blob 直アップロード完了後に呼ぶ。Attachment(blobUrl) を冪等作成。
 */
@ApiTags('アップロード(Blob)')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class BlobUploadController {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly register: AttachmentRegisterService,
  ) {}

  @Post('projects/:projectId/blob/upload-token')
  @ApiOperation({ summary: 'client直アップロードのトークン発行（Blob）' })
  async token(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Req() req: Request,
    @Body() body: unknown,
  ): Promise<unknown> {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      // フロントはこれを検知してサーバ経由 multipart にフォールバックする
      return { enabled: false };
    }
    const { handleUpload } = await import('@vercel/blob/client');
    return handleUpload({
      token,
      request: req,
      body: body as Parameters<typeof handleUpload>[0]['body'],
      onBeforeGenerateToken: async () => {
        await this.access.assertPrincipalAccess(user, projectId, 'edit');
        // allowedContentTypes は省略＝全許可。サイズは大きめに（client直なので関数ボディ上限の影響なし）。
        return {
          addRandomSuffix: true,
          maximumSizeInBytes: 100 * 1024 * 1024,
        };
      },
      // 本番のみ届く。ローカルは register-blob（client 呼び出し）に依存（冪等）。
      onUploadCompleted: async () => {
        /* no-op: Attachment 登録は client の register-blob で行う */
      },
    });
  }

  @Post('projects/:projectId/attachments/register-blob')
  @ApiOperation({
    summary: 'Blob直アップロード済みファイルを Attachment として登録（冪等）',
  })
  async registerBlob(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() body: Omit<RegisterBlobInput, 'projectId'>,
  ) {
    await this.access.assertPrincipalAccess(user, projectId, 'edit');
    return this.register.register({ ...body, projectId });
  }
}
