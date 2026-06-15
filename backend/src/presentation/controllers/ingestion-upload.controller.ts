import {
  Controller,
  Post,
  Param,
  UploadedFiles,
  UseInterceptors,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { v4 as uuid } from 'uuid';
import { BlobStorageService } from '../../infrastructure/services/blob-storage.service';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// バッチ取り込みのアップロード上限。1ファイルあたり 50MB / 1回 50 ファイルまで。
// 原本は Blob/ディスクに保存し、IngestionFile.blobUrl だけ DB に持つ（Attachment の 4MB 制限とは別系統）。
const MAX_FILES_PER_REQUEST = 50;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** アップロード1件のレスポンス（フロント契約と一致）。 */
interface IngestionUploadResult {
  filename: string;
  blobUrl: string;
  mimeType: string;
  size: number;
}

/**
 * バッチ取り込み用ファイルアップロード。
 *
 * フロントが multipart（フィールド名 `files`、複数）で送ったファイルを Blob/ディスクへ保存し、
 * `{ uploads: [{ filename, blobUrl, mimeType, size }] }` を返す。
 * クライアントはこの blobUrl を `POST /ingestion-batches` の files[].blobUrl に載せてバッチ作成する。
 */
@ApiTags('取り込みアップロード')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/ingestion-uploads')
export class IngestionUploadController {
  constructor(
    private readonly blob: BlobStorageService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'バッチ取り込み用ファイルの複数アップロード（→ Blob 保存）' })
  @ApiParam({ name: 'projectId', description: 'プロジェクトID' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'アップロード成功（uploads 配列を返す）' })
  @ApiResponse({ status: 403, description: '権限がありません' })
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, {
      limits: { fileSize: MAX_FILE_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<{ uploads: IngestionUploadResult[] }> {
    // 認可: アップロード = 課金処理の前段（書込）のため edit 強制。
    await this.projectAccess.assertProjectAccess(projectId, user.id, 'edit');

    if (!files || files.length === 0) {
      throw new BadRequestException('アップロードするファイルがありません（フィールド名 files）');
    }

    const uploads: IngestionUploadResult[] = [];
    for (const file of files) {
      const mimeType = file.mimetype || 'application/octet-stream';
      const saved = await this.blob.save(
        `ingestion/${projectId}/${uuid()}-${file.originalname}`,
        file.buffer,
        mimeType,
      );
      uploads.push({
        filename: file.originalname,
        blobUrl: saved.url,
        mimeType,
        size: file.size ?? file.buffer.length,
      });
    }

    return { uploads };
  }
}
