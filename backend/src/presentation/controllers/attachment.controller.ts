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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { IsString, IsOptional, IsInt, Min } from 'class-validator';
import { Response } from 'express';
import { v4 as uuid } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import { Public } from '../decorators/public.decorator';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

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
}

@ApiTags('添付')
@ApiBearerAuth()
@Controller()
export class AttachmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('projects/:projectId/phases/:phaseId/attachments')
  @ApiOperation({ summary: 'フェーズに添付ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const id = uuid();
    const sanitized = sanitizeFilename(file.originalname);

    // 保存先ディレクトリを保証
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const diskPath = path.join(UPLOAD_DIR, `${id}-${sanitized}`);
    fs.writeFileSync(diskPath, file.buffer);

    const kind = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype === 'application/pdf'
        ? 'PDF'
        : 'FILE';

    // 既存添付数を order の初期値に
    const order = await this.prisma.attachment.count({
      where: { projectId, phaseId },
    });

    const row = await this.prisma.attachment.create({
      data: {
        id,
        projectId,
        phaseId,
        kind: kind as 'IMAGE' | 'PDF' | 'FILE',
        filename: file.originalname,
        mimeType: file.mimetype,
        url: `/api/attachments/${id}/file`,
        size: file.size,
        order,
      },
    });

    return row;
  }

  @Get('projects/:projectId/phases/:phaseId/attachments')
  @ApiOperation({ summary: 'フェーズの添付ファイル一覧を取得' })
  async list(
    @Param('projectId') projectId: string,
    @Param('phaseId') phaseId: string,
  ) {
    return this.prisma.attachment.findMany({
      where: { projectId, phaseId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'タスクに添付ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadToTask(
    @Param('taskId') taskId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new NotFoundException('No file uploaded');
    }

    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const id = uuid();
    const sanitized = sanitizeFilename(file.originalname);

    // 保存先ディレクトリを保証
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const diskPath = path.join(UPLOAD_DIR, `${id}-${sanitized}`);
    fs.writeFileSync(diskPath, file.buffer);

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
      },
    });

    return row;
  }

  @Get('tasks/:taskId/attachments')
  @ApiOperation({ summary: 'タスクの添付ファイル一覧を取得' })
  async listForTask(@Param('taskId') taskId: string) {
    return this.prisma.attachment.findMany({
      where: { taskId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('information-types/:informationTypeId/attachments')
  @ApiOperation({ summary: '情報種別に具体帳票ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadToInformationType(
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
      throw new NotFoundException('InformationType not found');
    }

    const id = uuid();
    const sanitized = sanitizeFilename(file.originalname);

    // 保存先ディレクトリを保証
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const diskPath = path.join(UPLOAD_DIR, `${id}-${sanitized}`);
    fs.writeFileSync(diskPath, file.buffer);

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
      },
    });

    return row;
  }

  @Get('information-types/:informationTypeId/attachments')
  @ApiOperation({ summary: '情報種別の具体帳票ファイル一覧を取得' })
  async listForInformationType(
    @Param('informationTypeId') informationTypeId: string,
  ) {
    return this.prisma.attachment.findMany({
      where: { informationTypeId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Post('business-flows/:flowId/attachments')
  @ApiOperation({ summary: '業務フローに添付ファイルをアップロード' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadToFlow(
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
      throw new NotFoundException('BusinessFlow not found');
    }

    const id = uuid();
    const sanitized = sanitizeFilename(file.originalname);

    // 保存先ディレクトリを保証
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const diskPath = path.join(UPLOAD_DIR, `${id}-${sanitized}`);
    fs.writeFileSync(diskPath, file.buffer);

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
      },
    });

    return row;
  }

  @Get('business-flows/:flowId/attachments')
  @ApiOperation({ summary: '業務フローの添付ファイル一覧を取得' })
  async listForFlow(@Param('flowId') flowId: string) {
    return this.prisma.attachment.findMany({
      where: { flowId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  @Public()
  @Get('attachments/:id/file')
  @ApiOperation({ summary: '添付ファイルの実体を配信（認証不要）' })
  async serveFile(@Param('id') id: string, @Res() res: Response) {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Attachment not found');
    }

    const sanitized = sanitizeFilename(row.filename);
    const diskPath = path.join(UPLOAD_DIR, `${row.id}-${sanitized}`);
    if (!fs.existsSync(diskPath)) {
      throw new NotFoundException('File not found on disk');
    }

    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(row.filename)}"`,
    );
    fs.createReadStream(diskPath).pipe(res);
  }

  @Put('attachments/:id')
  @ApiOperation({ summary: '添付ファイルのメタ情報を更新' })
  async update(@Param('id') id: string, @Body() dto: UpdateAttachmentDto) {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Attachment not found');
    }

    return this.prisma.attachment.update({
      where: { id },
      data: {
        caption: dto.caption,
        pageRange: dto.pageRange,
        order: dto.order,
      },
    });
  }

  @Delete('attachments/:id')
  @ApiOperation({ summary: '添付ファイルを削除' })
  async delete(@Param('id') id: string) {
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('Attachment not found');
    }

    await this.prisma.attachment.delete({ where: { id } });

    // ディスク上の実体を best-effort で削除
    try {
      const sanitized = sanitizeFilename(row.filename);
      const diskPath = path.join(UPLOAD_DIR, `${row.id}-${sanitized}`);
      fs.unlinkSync(diskPath);
    } catch {
      // 実体が無くても無視
    }

    return { success: true };
  }
}
