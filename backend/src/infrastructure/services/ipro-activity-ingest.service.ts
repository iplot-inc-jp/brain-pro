import { Injectable } from '@nestjs/common';
import { IproWebhookSource, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma/prisma.service';

export const IPRO_ACTIVITY_EVENT_TYPES = [
  'chat.message.created',
  'document.created',
  'document.updated',
  'recording.created',
  'recording.ready',
  'project.context.created',
  'project.memory.created',
  'tracker.task.created',
  'tracker.task.updated',
] as const;

export type IproActivityEventType = (typeof IPRO_ACTIVITY_EVENT_TYPES)[number];

export interface IproActivityEnvelope {
  specVersion: '1.0';
  eventId: string;
  eventType: IproActivityEventType;
  companyId: string;
  projectIds: number[];
  occurredAt: string;
  data: Record<string, unknown>;
}

interface DocumentProjection {
  source: string;
  sourceRef: string;
  title: string | null;
  content: string;
  platform: string | null;
  roomId: string | null;
  roomName: string | null;
  authorId: string | null;
  authorName: string | null;
  hasMedia: boolean;
  metadata: Prisma.InputJsonValue;
}

const MAX_ERROR_LENGTH = 1000;

@Injectable()
export class IproActivityIngestService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    source: IproWebhookSource,
    envelope: IproActivityEnvelope,
  ): Promise<{ duplicate: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const receipt = await tx.iproWebhookReceipt.createMany({
          data: {
            eventId: envelope.eventId,
            sourceId: source.id,
            projectId: source.projectId,
            eventType: envelope.eventType,
            status: 'received',
            metadata: {
              companyId: envelope.companyId,
              projectIds: envelope.projectIds.slice(0, 100),
            },
          },
          skipDuplicates: true,
        });
        if (receipt.count === 0) return { duplicate: true };

        if (envelope.eventType === 'chat.message.created') {
          await this.normalizeChatMessage(tx, source.projectId, envelope);
        } else {
          await this.normalizeDocument(tx, source.projectId, envelope);
        }

        await tx.iproWebhookReceipt.update({
          where: {
            projectId_eventId: {
              projectId: source.projectId,
              eventId: envelope.eventId,
            },
          },
          data: { status: 'processed', processedAt: new Date(), error: null },
        });
        await tx.iproWebhookSource.update({
          where: { id: source.id },
          data: { lastReceivedAt: new Date(), lastError: null },
        });
        return { duplicate: false };
      });
    } catch (error) {
      await this.recordFailure(source, envelope, error);
      throw error;
    }
  }

  private async normalizeChatMessage(
    tx: Prisma.TransactionClient,
    projectId: string,
    envelope: IproActivityEnvelope,
  ): Promise<void> {
    const data = envelope.data;
    const platform = this.requiredString(data.platform, 'platform');
    const roomId = this.requiredString(data.roomId, 'roomId');
    const messageId = this.requiredString(data.messageId, 'messageId');
    const roomName = this.optionalString(data.roomName);
    const roomType = this.optionalString(data.roomType);
    const authorId = this.optionalString(data.userId);
    const authorName = this.optionalString(data.userName);
    const content = this.optionalString(data.text);
    const media = this.optionalJson(data.media);
    const mentions = this.optionalJson(data.mentions);
    const hasMedia = Array.isArray(data.media)
      ? data.media.length > 0
      : data.media !== undefined && data.media !== null;
    const sentAt = this.date(envelope.occurredAt);

    const room = await tx.iproActivityRoom.upsert({
      where: {
        projectId_platform_externalRoomId: {
          projectId,
          platform,
          externalRoomId: roomId,
        },
      },
      create: {
        projectId,
        platform,
        externalRoomId: roomId,
        roomType,
        name: roomName,
      },
      update: {
        ...(roomType !== null ? { roomType } : {}),
        ...(roomName !== null ? { name: roomName } : {}),
        active: true,
      },
    });

    await tx.iproActivityMessage.upsert({
      where: {
        projectId_platform_externalRoomId_externalMessageId: {
          projectId,
          platform,
          externalRoomId: roomId,
          externalMessageId: messageId,
        },
      },
      create: {
        projectId,
        activityRoomId: room.id,
        platform,
        externalRoomId: roomId,
        externalMessageId: messageId,
        roomType,
        authorId,
        authorName,
        content,
        ...(media !== undefined ? { media } : {}),
        ...(mentions !== undefined ? { mentions } : {}),
        hasMedia,
        sentAt,
        receivedEventId: envelope.eventId,
      },
      update: {
        activityRoomId: room.id,
        roomType,
        authorId,
        authorName,
        content,
        ...(media !== undefined ? { media } : {}),
        ...(mentions !== undefined ? { mentions } : {}),
        hasMedia,
        sentAt,
        receivedEventId: envelope.eventId,
      },
    });

    await this.upsertDocument(tx, projectId, envelope, {
      source: 'chat',
      sourceRef: `${platform}:${roomId}:${messageId}`,
      title: roomName,
      content: content ?? '',
      platform,
      roomId,
      roomName,
      authorId,
      authorName,
      hasMedia,
      metadata: this.safeMetadata(data),
    });
  }

  private async normalizeDocument(
    tx: Prisma.TransactionClient,
    projectId: string,
    envelope: IproActivityEnvelope,
  ): Promise<void> {
    await this.upsertDocument(
      tx,
      projectId,
      envelope,
      this.projectDocument(envelope),
    );
  }

  private async upsertDocument(
    tx: Prisma.TransactionClient,
    projectId: string,
    envelope: IproActivityEnvelope,
    projection: DocumentProjection,
  ): Promise<void> {
    const values = {
      projectId,
      source: projection.source,
      sourceRef: projection.sourceRef,
      platform: projection.platform,
      roomId: projection.roomId,
      roomName: projection.roomName,
      authorId: projection.authorId,
      authorName: projection.authorName,
      title: projection.title,
      content: projection.content,
      hasMedia: projection.hasMedia,
      occurredAt: this.date(envelope.occurredAt),
      eventId: envelope.eventId,
      metadata: projection.metadata,
    };
    await tx.iproActivityDocument.upsert({
      where: {
        projectId_source_sourceRef: {
          projectId,
          source: projection.source,
          sourceRef: projection.sourceRef,
        },
      },
      create: values,
      update: values,
    });
  }

  private projectDocument(envelope: IproActivityEnvelope): DocumentProjection {
    const data = envelope.data;
    const empty = {
      platform: null,
      roomId: null,
      roomName: null,
      authorId: null,
      authorName: null,
      hasMedia: false,
      metadata: this.safeMetadata(data),
    };

    if (envelope.eventType === 'document.created' || envelope.eventType === 'document.updated') {
      const id = this.requiredReference(data.documentId, 'documentId');
      const title = this.optionalString(data.title);
      const content = [title, this.optionalString(data.url), this.optionalString(data.contentHash)]
        .filter((value): value is string => Boolean(value))
        .join('\n');
      return { ...empty, source: 'document', sourceRef: id, title, content };
    }
    if (envelope.eventType === 'recording.created' || envelope.eventType === 'recording.ready') {
      const id = this.requiredReference(data.recordingId, 'recordingId');
      const title = this.optionalString(data.title);
      const content = [
        title,
        this.optionalString(data.mediaStatus),
        this.optionalString(data.transcriptStatus),
      ]
        .filter((value): value is string => Boolean(value))
        .join('\n');
      return { ...empty, source: 'recording', sourceRef: id, title, content, hasMedia: true };
    }
    if (
      envelope.eventType === 'project.context.created' ||
      envelope.eventType === 'project.memory.created'
    ) {
      const source =
        envelope.eventType === 'project.context.created' ? 'project_context' : 'project_memory';
      return {
        ...empty,
        source,
        sourceRef: this.requiredReference(data.id, 'id'),
        title: source === 'project_context' ? 'プロジェクトコンテキスト' : 'プロジェクト記憶',
        content: this.requiredString(data.content, 'content'),
      };
    }

    const tracker = this.requiredString(data.tracker, 'tracker');
    const externalId = this.requiredString(data.externalId, 'externalId');
    const title = this.optionalString(data.title);
    const status = this.optionalString(data.status);
    return {
      ...empty,
      source: 'tracker_task',
      sourceRef: `${tracker}:${externalId}`,
      title,
      content: [title, status].filter((value): value is string => Boolean(value)).join('\n'),
      platform: tracker,
    };
  }

  private async recordFailure(
    source: IproWebhookSource,
    envelope: IproActivityEnvelope,
    error: unknown,
  ): Promise<void> {
    const message = this.errorMessage(error);
    await Promise.allSettled([
      this.prisma.iproWebhookReceipt.upsert({
        where: {
          projectId_eventId: {
            projectId: source.projectId,
            eventId: envelope.eventId,
          },
        },
        create: {
          eventId: envelope.eventId,
          sourceId: source.id,
          projectId: source.projectId,
          eventType: envelope.eventType,
          status: 'error',
          error: message,
          processedAt: new Date(),
          metadata: {
            companyId: envelope.companyId,
            projectIds: envelope.projectIds.slice(0, 100),
          },
        },
        update: { status: 'error', error: message, processedAt: new Date() },
      }),
      this.prisma.iproWebhookSource.update({
        where: { id: source.id },
        data: { lastError: message },
      }),
    ]);
  }

  private errorMessage(error: unknown): string {
    const value = error instanceof Error ? error.message : String(error);
    return value.slice(0, MAX_ERROR_LENGTH);
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Invalid ${field}`);
    }
    return value;
  }

  private requiredReference(value: unknown, field: string): string {
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).length === 0) {
      throw new Error(`Invalid ${field}`);
    }
    return String(value);
  }

  private optionalString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private optionalJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private safeMetadata(data: Record<string, unknown>): Prisma.InputJsonValue {
    const json = JSON.stringify(data);
    if (json.length <= 32_768) return JSON.parse(json) as Prisma.InputJsonValue;
    return { truncated: true };
  }

  private date(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid occurredAt');
    return date;
  }
}
