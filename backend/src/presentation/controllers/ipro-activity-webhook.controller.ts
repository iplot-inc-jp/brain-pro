import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/persistence/prisma/prisma.service';
import {
  IPRO_ACTIVITY_EVENT_TYPES,
  IproActivityEnvelope,
  IproActivityEventType,
  IproActivityIngestService,
} from '../../infrastructure/services/ipro-activity-ingest.service';
import { CryptoService } from '../../infrastructure/services/crypto.service';
import { verifyIproWebhookSignature } from '../../infrastructure/services/ipro-webhook-signature';
import { Public } from '../decorators/public.decorator';

const MAX_RAW_BODY_BYTES = 1024 * 1024;
const EVENT_TYPES = new Set<string>(IPRO_ACTIVITY_EVENT_TYPES);

type RawBodyRequest = Request & { rawBody?: string };

@ApiTags('ipro-db Webhook受信')
@Controller('webhooks/ipro-db')
export class IproActivityWebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly ingestService: IproActivityIngestService,
  ) {}

  @Public()
  @Post(':sourceToken')
  @ApiOperation({ summary: 'ipro-db活動イベントを署名検証して受信' })
  async receive(
    @Param('sourceToken') sourceToken: string,
    @Headers('x-ipro-event-id') eventIdHeader: string | undefined,
    @Headers('x-ipro-event-type') eventTypeHeader: string | undefined,
    @Headers('x-ipro-timestamp') timestampHeader: string | undefined,
    @Headers('x-ipro-signature') signatureHeader: string | undefined,
    @Req() request: RawBodyRequest,
    @Body() body: unknown,
  ): Promise<{ ok: true; duplicate: boolean }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new HttpException('raw body is required', HttpStatus.BAD_REQUEST);
    }
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_RAW_BODY_BYTES) {
      throw new HttpException('payload too large', HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const tokenHash = createHash('sha256').update(sourceToken).digest('hex');
    const source = await this.prisma.iproWebhookSource.findUnique({
      where: { tokenHash },
    });
    if (!source?.active) {
      throw new HttpException('invalid webhook credentials', HttpStatus.UNAUTHORIZED);
    }

    let secret: string;
    try {
      secret = this.crypto.decrypt(source.secretEnc);
    } catch {
      throw new HttpException('invalid webhook credentials', HttpStatus.UNAUTHORIZED);
    }
    const signatureValid = verifyIproWebhookSignature({
      rawBody,
      timestamp: timestampHeader ?? '',
      signature: signatureHeader ?? '',
      secret,
    });
    if (!signatureValid) {
      throw new HttpException('invalid webhook signature', HttpStatus.UNAUTHORIZED);
    }

    const envelope = this.parseEnvelope(body);
    if (eventIdHeader !== envelope.eventId || eventTypeHeader !== envelope.eventType) {
      throw new HttpException('event headers do not match envelope', HttpStatus.BAD_REQUEST);
    }

    const result = await this.ingestService.ingest(source, envelope);
    return { ok: true, duplicate: result.duplicate };
  }

  private parseEnvelope(value: unknown): IproActivityEnvelope {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw this.badEnvelope();
    }
    const body = value as Record<string, unknown>;
    const eventType = body.eventType;
    const data = body.data;
    const occurredAt = body.occurredAt;
    if (
      body.specVersion !== '1.0' ||
      typeof body.eventId !== 'string' ||
      !body.eventId ||
      typeof eventType !== 'string' ||
      !EVENT_TYPES.has(eventType) ||
      typeof body.companyId !== 'string' ||
      !body.companyId ||
      !Array.isArray(body.projectIds) ||
      !body.projectIds.every((id) => Number.isInteger(id)) ||
      typeof occurredAt !== 'string' ||
      Number.isNaN(Date.parse(occurredAt)) ||
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data)
    ) {
      throw this.badEnvelope();
    }
    this.validateEventData(eventType as IproActivityEventType, data as Record<string, unknown>);
    return {
      specVersion: '1.0',
      eventId: body.eventId,
      eventType: eventType as IproActivityEventType,
      companyId: body.companyId,
      projectIds: body.projectIds as number[],
      occurredAt,
      data: data as Record<string, unknown>,
    };
  }

  private validateEventData(
    eventType: IproActivityEventType,
    data: Record<string, unknown>,
  ): void {
    const hasString = (key: string): boolean =>
      typeof data[key] === 'string' && (data[key] as string).length > 0;
    const hasReference = (key: string): boolean =>
      hasString(key) || (typeof data[key] === 'number' && Number.isFinite(data[key]));
    let valid = false;
    if (eventType === 'chat.message.created') {
      valid = hasString('platform') && hasString('roomId') && hasString('messageId');
    } else if (eventType === 'document.created' || eventType === 'document.updated') {
      valid = hasReference('documentId');
    } else if (eventType === 'recording.created' || eventType === 'recording.ready') {
      valid = hasReference('recordingId');
    } else if (
      eventType === 'project.context.created' ||
      eventType === 'project.memory.created'
    ) {
      valid = hasReference('id') && hasString('content');
    } else {
      valid = hasString('tracker') && hasString('externalId');
    }
    if (!valid) throw this.badEnvelope();
  }

  private badEnvelope(): HttpException {
    return new HttpException('malformed webhook envelope', HttpStatus.BAD_REQUEST);
  }
}
