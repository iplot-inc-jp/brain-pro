import {
  BadRequestException,
  Body,
  Controller,
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
import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
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
  EXTERNAL_MATERIAL_MAX_FILE_BYTES + 1024 * 1024;

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

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'LINE / Slack の PDF・PPTX を冪等に資料登録する' })
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
  @ApiResponse({ status: 413, description: 'ファイルが50MBを超えています' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: EXTERNAL_MATERIAL_MAX_FILE_BYTES,
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
        'アップロードは50MB以下にしてください',
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
