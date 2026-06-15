import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../persistence/prisma/prisma.service';

export interface RegisterBlobInput {
  projectId: string;
  blobUrl: string;
  filename: string;
  mimeType: string;
  size: number;
  displayName?: string | null;
  folder?: string | null;
  phaseId?: string | null;
  taskId?: string | null;
  flowId?: string | null;
  informationTypeId?: string | null;
}

function kindFromMime(mime: string): 'IMAGE' | 'PDF' | 'FILE' {
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

/**
 * client が Blob へ直アップロードした後に Attachment 行を作る（冪等）。
 * 同じ blobUrl が既にあればそれを返す（client の register と本番 onUploadCompleted の二重作成防止）。
 */
@Injectable()
export class AttachmentRegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: RegisterBlobInput) {
    const existing = await this.prisma.attachment.findFirst({
      where: { projectId: input.projectId, blobUrl: input.blobUrl },
    });
    if (existing) return existing;

    const id = randomUUID();
    const order = await this.prisma.attachment.count({
      where: {
        projectId: input.projectId,
        phaseId: input.phaseId ?? null,
        taskId: input.taskId ?? null,
        informationTypeId: input.informationTypeId ?? null,
        flowId: input.flowId ?? null,
      },
    });
    return this.prisma.attachment.create({
      data: {
        id,
        projectId: input.projectId,
        phaseId: input.phaseId ?? null,
        taskId: input.taskId ?? null,
        flowId: input.flowId ?? null,
        informationTypeId: input.informationTypeId ?? null,
        kind: kindFromMime(input.mimeType),
        filename: input.filename,
        displayName: input.displayName ?? null,
        folder: input.folder ?? null,
        mimeType: input.mimeType,
        url: `/api/attachments/${id}/file`,
        size: input.size,
        order,
        data: null,
        blobUrl: input.blobUrl,
      },
    });
  }
}
