import { createHmac } from 'node:crypto';
import { IproActivityWebhookController } from './ipro-activity-webhook.controller';

const SECRET = 'receiver-secret';
const TOKEN = 'receiver-token';
const NOW = Date.parse('2026-07-17T02:00:00.000Z');

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    specVersion: '1.0',
    eventId: 'evt-1',
    eventType: 'chat.message.created',
    companyId: 'company-1',
    projectIds: [12],
    occurredAt: '2026-07-17T01:59:59.000Z',
    data: {
      platform: 'line',
      roomId: 'room-1',
      roomName: '営業部',
      messageId: 'message-1',
      text: '見積条件を確認しました',
      userId: 'user-1',
      userName: '山田',
    },
    ...overrides,
  };
}

function signedRequest(body = envelope(), timestamp = String(Math.floor(NOW / 1000))) {
  const rawBody = JSON.stringify(body);
  const signature = `v1=${createHmac('sha256', SECRET)
    .update(timestamp)
    .update('.')
    .update(rawBody)
    .digest('hex')}`;
  return { rawBody, timestamp, signature };
}

function makeDependencies(source: Record<string, unknown> | null = {
  id: 'source-1',
  projectId: 'brain-project-1',
  active: true,
  secretEnc: 'encrypted-secret',
}) {
  const prisma = {
    iproWebhookSource: {
      findUnique: jest.fn().mockResolvedValue(source),
    },
  } as any;
  const crypto = { decrypt: jest.fn().mockReturnValue(SECRET) } as any;
  const ingest = {
    ingest: jest.fn().mockResolvedValue({ duplicate: false }),
  } as any;
  return { prisma, crypto, ingest };
}

describe('IproActivityWebhookController', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  function controller(d = makeDependencies()) {
    return { d, value: new IproActivityWebhookController(d.prisma, d.crypto, d.ingest) };
  }

  it('rejects an unknown or inactive source token', async () => {
    for (const source of [null, { id: 'source-1', active: false }]) {
      const { value } = controller(makeDependencies(source));
      const req = signedRequest();
      await expect(
        value.receive(
          TOKEN,
          'evt-1',
          'chat.message.created',
          req.timestamp,
          req.signature,
          { rawBody: req.rawBody } as any,
          envelope(),
        ),
      ).rejects.toMatchObject({ status: 401 });
    }
  });

  it('rejects an invalid or stale signature', async () => {
    const { value } = controller();
    const valid = signedRequest();
    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        valid.timestamp,
        'v1='.padEnd(67, '0'),
        { rawBody: valid.rawBody } as any,
        envelope(),
      ),
    ).rejects.toMatchObject({ status: 401 });

    const stale = signedRequest(envelope(), String(Math.floor(NOW / 1000) - 301));
    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        stale.timestamp,
        stale.signature,
        { rawBody: stale.rawBody } as any,
        envelope(),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('rejects event id/type header mismatches and malformed envelopes', async () => {
    const { value } = controller();
    const req = signedRequest();
    await expect(
      value.receive(
        TOKEN,
        'different-event',
        'chat.message.created',
        req.timestamp,
        req.signature,
        { rawBody: req.rawBody } as any,
        envelope(),
      ),
    ).rejects.toMatchObject({ status: 400 });

    const malformedBody = envelope({ specVersion: '2.0' });
    const malformed = signedRequest(malformedBody);
    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        malformed.timestamp,
        malformed.signature,
        { rawBody: malformed.rawBody } as any,
        malformedBody,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an event whose type-specific payload is incomplete', async () => {
    const { value } = controller();
    const body = envelope({
      data: { platform: 'line', messageId: 'message-1', text: 'roomId is missing' },
    });
    const req = signedRequest(body);

    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        req.timestamp,
        req.signature,
        { rawBody: req.rawBody } as any,
        body,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a body larger than the receiver limit', async () => {
    const { value } = controller();
    const body = envelope();
    const rawBody = 'x'.repeat(1_048_577);
    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        String(Math.floor(NOW / 1000)),
        'v1='.padEnd(67, '0'),
        { rawBody } as any,
        body,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('accepts a signed event using the exact raw body and reports duplicates', async () => {
    const d = makeDependencies();
    d.ingest.ingest.mockResolvedValue({ duplicate: true });
    const value = new IproActivityWebhookController(d.prisma, d.crypto, d.ingest);
    const body = envelope();
    const req = signedRequest(body);

    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        req.timestamp,
        req.signature,
        { rawBody: req.rawBody } as any,
        body,
      ),
    ).resolves.toEqual({ ok: true, duplicate: true });
    expect(d.ingest.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'source-1', projectId: 'brain-project-1' }),
      body,
    );
  });

  it('does not verify a re-stringified parsed body', async () => {
    const { d, value } = controller();
    const body = envelope();
    const compact = signedRequest(body);
    const differentlyFormattedRawBody = JSON.stringify(body, null, 2);

    await expect(
      value.receive(
        TOKEN,
        'evt-1',
        'chat.message.created',
        compact.timestamp,
        compact.signature,
        { rawBody: differentlyFormattedRawBody } as any,
        body,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(d.ingest.ingest).not.toHaveBeenCalled();
  });
});
