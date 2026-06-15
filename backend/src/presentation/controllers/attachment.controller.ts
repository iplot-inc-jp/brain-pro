import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Res,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min, ValidateIf } from 'class-validator';
import { Response } from 'express';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { Public } from '../decorators/public.decorator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../decorators/current-user.decorator';
import { EntityNotFoundError, ForbiddenError } from '../../domain';
import { ProjectScopedAccess } from '../decorators/project-scoped-access.decorator';
import { ProjectAccessGuard } from '../guards/project-access.guard';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

// Vercel Functions のリクエストボディ上限（約4.5MB）対策。
// 4MB を超えるアップロードは multer が LIMIT_FILE_SIZE エラーを投げ、
// Nest が 413 Payload Too Large に変換する。
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_UPLOAD_BYTES },
};

// 一覧・作成・更新のレスポンスからファイル本体（data: Bytes）を除外する select。
// data を含めると JSON シリアライズで巨大なレスポンスになるため必ずこれを使う。
const ATTACHMENT_SELECT = {
  id: true,
  projectId: true,
  phaseId: true,
  taskId: true,
  kind: true,
  filename: true,
  displayName: true,
  folder: true,
  mimeType: true,
  url: true,
  size: true,
  pageRange: true,
  caption: true,
  order: true,
  createdAt: true,
  informationTypeId: true,
  flowId: true,
} as const;

// ========== 共通認可ヘルパー ==========

// project → org メンバー確認（スーパー管理者は常に許可）
async function assertProjectMember(
  prisma: PrismaService,
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!project) {
    throw new EntityNotFoundError('Project', projectId);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isSuperAdmin: true },
  });
  if (user?.isSuperAdmin) return;

  const member = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: project.organizationId,
        userId,
      },
    },
    select: { id: true },
  });
  if (!member) {
    throw new ForbiddenError('You are not a member of this organization');
  }
}

/**
 * ファイル名をディスク保存用にサニタイズ（パス区切り・制御文字を除去）
 */
function sanitizeFilename(name: string): string {
  return (name || 'file')
    .replace(/[/\\]/g, '_')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 200);
}

// DTOs
class UpdateAttachmentDto {
  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  pageRange?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /** 表示名（null/空文字 = filename 表示に戻す） */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  displayName?: string | null;

  /** フォルダ名（null/空文字 = 未分類に戻す） */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  folder?: string | null;
}

/**
 * displayName / folder の更新値を正規化する。
 * undefined はそのまま（未指定 = 変更しない）、空文字・空白のみは null（未設定に戻す）。
 */
function normalizeNullableText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

@ApiTags('添付')
@ApiBearerAuth()
@ProjectScopedAccess()
@UseGuards(ProjectAccessGuard)
@Controller()
export class AttachmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('projects/:projectId/attachments')
  @ApiOperation({ summary: 'プロジェクト直下に汎用資料ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async uploadToProject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new EntityNotFoundError('Project', projectId);
    }

    await assertProjectMember(this.prisma, projectId, user.id);

    const id = uuid();

    const kind = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype === 'application/pdf'
        ? 'PDF'
        : 'FILE';

    // 既存添付数（プロジェクト直下のみ）を order の初期値に
    const order = await this.prisma.attachment.count({
      where: {
        projectId,
        phaseId: null,
        taskId: null,
        informationTypeId: null,
        flowId: null,
      },
    });

    const row = await this.prisma.attachment.create({
      data: {
        id,
        projectId,
        kind: kind as 'IMAGE' | 'PDF' | 'FILE',
        filename: file.originalname,
        mimeType: file.mimetype,
        url: `/api/attachments/${id}/file`,
        size: file.size,
        order,
        // ファイル本体は DB に保存（serverless の read-only FS 対応。ローカルも統一）
        data: file.buffer,
      },
      select: ATTACHMENT_SELECT,
    });

    return row;
  }

  @Get('projects/:projectId/attachments')
  @ApiOperation({ summary: 'プロジェクト直下の汎用資料ファイル一覧を取得' })
  async listForProject(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
  ) {
    await assertProjectMember(this.prisma, projectId, user.id);

    return this.prisma.attachment.findMany({
      where: {
        projectId,
        phaseId: null,
        taskId: null,
        informationTypeId: null,
        flowId: null,
      },
      orderBy: { createdAt: 'asc' },
      select: ATTACHMENT_SELECT,
    });
  }

  @Post('projects/:projectId/phases/:phaseId/attachments')
  @ApiOperation({ summary: 'フェーズに添付ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: { projectId: true },
    });
    if (!phase) {
      throw new EntityNotFoundError('Phase', phaseId);
    }

    await assertProjectMember(this.prisma, phase.projectId, user.id);

    const id = uuid();

    const kind = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype === 'application/pdf'
        ? 'PDF'
        : 'FILE';

    // 既存添付数を order の初期値に
    // NOTE: パスの projectId は検証していないため、必ず phase.projectId を使う
    // （別テナントの projectId を指定して他組織プロジェクトに紐づく行が
    //   作られるのを防ぐ）
    const order = await this.prisma.attachment.count({
      where: { projectId: phase.projectId, phaseId },
    });

    const row = await this.prisma.attachment.create({
      data: {
        id,
        projectId: phase.projectId,
        phaseId,
        kind: kind as 'IMAGE' | 'PDF' | 'FILE',
        filename: file.originalname,
        mimeType: file.mimetype,
        url: `/api/attachments/${id}/file`,
        size: file.size,
        order,
        // ファイル本体は DB に保存（serverless の read-only FS 対応。ローカルも統一）
        data: file.buffer,
      },
      select: ATTACHMENT_SELECT,
    });

    return row;
  }

  @Get('projects/:projectId/phases/:phaseId/attachments')
  @ApiOperation({ summary: 'フェーズの添付ファイル一覧を取得' })
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
  ) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId },
      select: { projectId: true },
    });
    if (!phase) {
      throw new EntityNotFoundError('Phase', phaseId);
    }

    await assertProjectMember(this.prisma, phase.projectId, user.id);

    return this.prisma.attachment.findMany({
      where: { projectId: phase.projectId, phaseId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: ATTACHMENT_SELECT,
    });
  }

  @Post('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'タスクに添付ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async uploadToTask(
    @CurrentUser() user: CurrentUserPayload,
    @Param('taskId') taskId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new EntityNotFoundError('Task', taskId);
    }

    await assertProjectMember(this.prisma, task.projectId, user.id);

    const id = uuid();

    const kind = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype === 'application/pdf'
        ? 'PDF'
        : 'FILE';

    // 既存添付数を order の初期値に
    const order = await this.prisma.attachment.count({
      where: { taskId },
    });

    const row = await this.prisma.attachment.create({
      data: {
        id,
        projectId: task.projectId,
        taskId,
        kind: kind as 'IMAGE' | 'PDF' | 'FILE',
        filename: file.originalname,
        mimeType: file.mimetype,
        url: `/api/attachments/${id}/file`,
        size: file.size,
        order,
        // ファイル本体は DB に保存（serverless の read-only FS 対応。ローカルも統一）
        data: file.buffer,
      },
      select: ATTACHMENT_SELECT,
    });

    return row;
  }

  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'タスクの添付ファイル一覧を取得' })
  async listForTask(
    @CurrentUser() user: CurrentUserPayload,
    @Param('taskId') taskId: string,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { projectId: true },
    });
    if (!task) {
      throw new EntityNotFoundError('Task', taskId);
    }

    await assertProjectMember(this.prisma, task.projectId, user.id);

    return this.prisma.attachment.findMany({
      where: { taskId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: ATTACHMENT_SELECT,
    });
  }

  @Post('information-types/:informationTypeId/attachments')
  @ApiOperation({ summary: '情報種別に具体帳票ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async uploadToInformationType(
    @CurrentUser() user: CurrentUserPayload,
    @Param('informationTypeId') informationTypeId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const informationType = await this.prisma.informationType.findUnique({
      where: { id: informationTypeId },
    });
    if (!informationType) {
      throw new EntityNotFoundError('InformationType', informationTypeId);
    }

    await assertProjectMember(this.prisma, informationType.projectId, user.id);

    const id = uuid();

    const kind = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype === 'application/pdf'
        ? 'PDF'
        : 'FILE';

    // 既存添付数を order の初期値に
    const order = await this.prisma.attachment.count({
      where: { informationTypeId },
    });

    const row = await this.prisma.attachment.create({
      data: {
        id,
        projectId: informationType.projectId,
        informationTypeId,
        kind: kind as 'IMAGE' | 'PDF' | 'FILE',
        filename: file.originalname,
        mimeType: file.mimetype,
        url: `/api/attachments/${id}/file`,
        size: file.size,
        order,
        // ファイル本体は DB に保存（serverless の read-only FS 対応。ローカルも統一）
        data: file.buffer,
      },
      select: ATTACHMENT_SELECT,
    });

    return row;
  }

  @Get('information-types/:informationTypeId/attachments')
  @ApiOperation({ summary: '情報種別の具体帳票ファイル一覧を取得' })
  async listForInformationType(
    @CurrentUser() user: CurrentUserPayload,
    @Param('informationTypeId') informationTypeId: string,
  ) {
    const informationType = await this.prisma.informationType.findUnique({
      where: { id: informationTypeId },
      select: { projectId: true },
    });
    if (!informationType) {
      throw new EntityNotFoundError('InformationType', informationTypeId);
    }

    await assertProjectMember(this.prisma, informationType.projectId, user.id);

    return this.prisma.attachment.findMany({
      where: { informationTypeId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: ATTACHMENT_SELECT,
    });
  }

  @Post('business-flows/:flowId/attachments')
  @ApiOperation({ summary: '業務フローに添付ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async uploadToFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const flow = await this.prisma.businessFlow.findUnique({
      where: { id: flowId },
    });
    if (!flow) {
      throw new EntityNotFoundError('BusinessFlow', flowId);
    }

    await assertProjectMember(this.prisma, flow.projectId, user.id);

    const id = uuid();

    const kind = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype === 'application/pdf'
        ? 'PDF'
        : 'FILE';

    // 既存添付数を order の初期値に
    const order = await this.prisma.attachment.count({
      where: { flowId },
    });

    const row = await this.prisma.attachment.create({
      data: {
        id,
        projectId: flow.projectId,
        flowId,
        kind: kind as 'IMAGE' | 'PDF' | 'FILE',
        filename: file.originalname,
        mimeType: file.mimetype,
        url: `/api/attachments/${id}/file`,
        size: file.size,
        order,
        // ファイル本体は DB に保存（serverless の read-only FS 対応。ローカルも統一）
        data: file.buffer,
      },
      select: ATTACHMENT_SELECT,
    });

    return row;
  }

  @Get('business-flows/:flowId/attachments')
  @ApiOperation({ summary: '業務フローの添付ファイル一覧を取得' })
  async listForFlow(
    @CurrentUser() user: CurrentUserPayload,
    @Param('flowId') flowId: string,
  ) {
    const flow = await this.prisma.businessFlow.findUnique({
      where: { id: flowId },
      select: { projectId: true },
    });
    if (!flow) {
      throw new EntityNotFoundError('BusinessFlow', flowId);
    }

    await assertProjectMember(this.prisma, flow.projectId, user.id);

    return this.prisma.attachment.findMany({
      where: { flowId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: ATTACHMENT_SELECT,
    });
  }

  @Public()
  @Get('attachments/:id/file')
  @ApiOperation({ summary: '添付ファイルの実体を配信（認証不要）' })
  async serveFile(@Param('id') id: string, @Res() res: Response) {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row) {
      throw new EntityNotFoundError('Attachment', id);
    }

    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(row.filename)}"`,
    );

    // 新方式: ファイル本体が DB（data: Bytes）にあればそのまま送出
    if (row.data != null) {
      res.send(Buffer.from(row.data));
      return;
    }

    // client直アップロード: Blob 公開URLへ 302 リダイレクト（関数を通さず最速）
    if (row.blobUrl) {
      res.redirect(302, row.blobUrl);
      return;
    }

    // 旧方式フォールバック: 既存ローカルデータ（ディスク保存）互換
    const sanitized = sanitizeFilename(row.filename);
    const diskPath = path.join(UPLOAD_DIR, `${row.id}-${sanitized}`);
    if (!fs.existsSync(diskPath)) {
      throw new NotFoundException('File not found on disk');
    }
    fs.createReadStream(diskPath).pipe(res);
  }

  @Put('attachments/:id')
  @ApiOperation({ summary: '添付ファイルのメタ情報を更新' })
  async update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAttachmentDto,
  ) {
    const row = await this.prisma.attachment.findUnique({
      where: { id },
      select: { projectId: true },
    });
    if (!row) {
      throw new EntityNotFoundError('Attachment', id);
    }

    await assertProjectMember(this.prisma, row.projectId, user.id);

    return this.prisma.attachment.update({
      where: { id },
      data: {
        caption: dto.caption,
        pageRange: dto.pageRange,
        order: dto.order,
        displayName: normalizeNullableText(dto.displayName),
        folder: normalizeNullableText(dto.folder),
      },
      select: ATTACHMENT_SELECT,
    });
  }

  @Delete('attachments/:id')
  @ApiOperation({ summary: '添付ファイルを削除' })
  async delete(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    const row = await this.prisma.attachment.findUnique({
      where: { id },
      select: { id: true, projectId: true, filename: true },
    });
    if (!row) {
      throw new EntityNotFoundError('Attachment', id);
    }

    await assertProjectMember(this.prisma, row.projectId, user.id);

    await this.prisma.attachment.delete({ where: { id } });

    // 旧方式（ディスク保存）の実体が残っていれば best-effort で削除
    // （serverless の read-only FS でも例外にしない）
    try {
      const sanitized = sanitizeFilename(row.filename);
      const diskPath = path.join(UPLOAD_DIR, `${row.id}-${sanitized}`);
      if (fs.existsSync(diskPath)) {
        fs.unlinkSync(diskPath);
      }
    } catch {
      // 実体が無くても・消せなくても無視
    }

    return { success: true };
  }
}
