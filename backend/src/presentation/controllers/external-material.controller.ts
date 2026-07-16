import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EXTERNAL_MATERIAL_LEGACY_MAX_FILE_BYTES,
  EXTERNAL_MATERIAL_MAX_FILE_BYTES,
  ExternalMaterialResponse,
  ImportExternalMaterialUseCase,
} from '../../application';
import { ProjectAccessService } from '../../infrastructure/services/project-access.service';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

// multipart framing adds a small amount to Content-Length. The file itself is still
// independently hard-limited by Multer and by the use case's measured Buffer length.
const MAX_MULTIPART_CONTENT_LENGTH =
  EXTERNAL_MATERIAL_LEGACY_MAX_FILE_BYTES + 256 * 1024;

export class ImportExternalMaterialDto {
  @ApiProperty({ description: '送信元とiproプロジェクトを含む外部冪等キー' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  idempotencyKey!: string;

  @ApiProperty({ enum: ['line', 'slack'] })
  @IsIn(['line', 'slack'])
  sourcePlatform!: 'line' | 'slack';

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  sourceChannelId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  sourceMessageId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  sourceFileId!: string;
}

export class PrepareExternalMaterialDto extends ImportExternalMaterialDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    enum: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ],
  })
  @IsString()
  mimeType!: string;

  @ApiProperty({ maximum: EXTERNAL_MATERIAL_MAX_FILE_BYTES })
  @IsInt()
  @Min(1)
  @Max(EXTERNAL_MATERIAL_MAX_FILE_BYTES)
  size!: number;

  @ApiProperty({ description: '64桁のSHA-256（hex）' })
  @Matches(/^[a-fA-F0-9]{64}$/u)
  contentSha256!: string;
}

@ApiTags('外部資料')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller('projects/:projectId/external-materials')
export class ExternalMaterialController {
  constructor(
    private readonly importExternalMaterial: ImportExternalMaterialUseCase,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Post('prepare')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: '資料メタデータを固定しprivate Blob直送URLを発行する',
  })
  async prepare(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: PrepareExternalMaterialDto,
  ) {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'edit');
    return this.importExternalMaterial.prepare({
      userId: user.id,
      principal: user,
      projectId,
      idempotencyKey: dto.idempotencyKey,
      sourcePlatform: dto.sourcePlatform,
      sourceChannelId: dto.sourceChannelId,
      sourceMessageId: dto.sourceMessageId,
      sourceFileId: dto.sourceFileId,
      file: {
        filename: dto.filename,
        mimeType: dto.mimeType,
        size: dto.size,
        contentSha256: dto.contentSha256,
      },
    });
  }

  @Post(':importId/finalize')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'private Blobを確認し、検証ジョブを冪等に開始する' })
  async finalize(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
  ) {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'edit');
    return this.importExternalMaterial.finalize({
      userId: user.id,
      principal: user,
      projectId,
      importId,
    });
  }

  @Get(':importId')
  @ApiOperation({ summary: '資料登録・検証・バッチ化の状態を取得する' })
  async status(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
  ) {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'view');
    return this.importExternalMaterial.getStatus({
      principal: user,
      projectId,
      importId,
    });
  }

  @Get(':importId/download-url')
  @ApiOperation({
    summary: 'private資料の短期署名付きダウンロードURLを発行する',
  })
  async download(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
  ) {
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'view');
    return this.importExternalMaterial.getDownload({
      principal: user,
      projectId,
      importId,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '【非推奨】4MB以下の資料をサーバ経由で登録する' })
  @ApiParam({ name: 'projectId', description: 'Brain Pro プロジェクトID' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 201,
    description: '同じ冪等キーでは同じ資料・バッチを返します',
  })
  @ApiResponse({
    status: 400,
    description: '必須項目、形式、ファイル署名が不正です',
  })
  @ApiResponse({ status: 403, description: 'プロジェクト編集権限がありません' })
  @ApiResponse({ status: 409, description: '冪等キーが別の資料へ使用済みです' })
  @ApiResponse({ status: 413, description: 'ファイルが4MBを超えています' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: EXTERNAL_MATERIAL_LEGACY_MAX_FILE_BYTES,
        files: 1,
        fields: 5,
        fieldNameSize: 100,
        fieldSize: 2048,
      },
    }),
  )
  async create(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Body() dto: ImportExternalMaterialDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Headers('content-length') contentLength?: string,
  ): Promise<ExternalMaterialResponse> {
    // Guard handles project-scoped routes; the explicit assertion keeps this controller
    // safe if its routing/decorator structure is refactored later and preserves the full
    // service-account principal rather than falling back to issuer membership.
    await this.projectAccess.assertPrincipalAccess(user, projectId, 'edit');

    const declaredRequestBytes = Number(contentLength);
    if (
      contentLength &&
      (!Number.isSafeInteger(declaredRequestBytes) ||
        declaredRequestBytes < 0 ||
        declaredRequestBytes > MAX_MULTIPART_CONTENT_LENGTH)
    ) {
      throw new PayloadTooLargeException(
        '従来アップロードは4MB以下にしてください',
      );
    }
    if (!file) {
      throw new BadRequestException(
        'アップロードするファイルがありません（フィールド名 file）',
      );
    }

    return this.importExternalMaterial.execute({
      userId: user.id,
      principal: user,
      projectId,
      idempotencyKey: dto.idempotencyKey,
      sourcePlatform: dto.sourcePlatform,
      sourceChannelId: dto.sourceChannelId,
      sourceMessageId: dto.sourceMessageId,
      sourceFileId: dto.sourceFileId,
      file: {
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        bytes: file.buffer,
      },
    });
  }
}
