import { createHmac } from 'node:crypto';
import { verifyIproWebhookSignature } from './ipro-webhook-signature';

const secret = 'brain-pro-receiver-secret';
const timestamp = '1784196000';
const nowMs = Number(timestamp) * 1000;
const rawBody = Buffer.from(
  JSON.stringify({
    specVersion: '1.0',
    eventId: 'evt_test',
    eventType: 'chat.message.created',
    companyId: 'company-1',
    projectIds: [12],
    occurredAt: '2026-07-16T10:00:00.000Z',
    data: { text: '見積条件を確認しました' },
  }),
);

function signature(body = rawBody, at = timestamp): string {
  return `v1=${createHmac('sha256', secret).update(at).update('.').update(body).digest('hex')}`;
}

describe('verifyIproWebhookSignature', () => {
  it('accepts the exact raw body signed with the shared secret', () => {
    expect(
      verifyIproWebhookSignature({
        rawBody,
        timestamp,
        signature: signature(),
        secret,
        nowMs,
      }),
    ).toBe(true);
  });

  it('rejects a signature made with another secret or modified body', () => {
    const otherSignature = `v1=${createHmac('sha256', 'wrong-secret')
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest('hex')}`;
    expect(
      verifyIproWebhookSignature({ rawBody, timestamp, signature: otherSignature, secret, nowMs }),
    ).toBe(false);
    expect(
      verifyIproWebhookSignature({
        rawBody: Buffer.from(`${rawBody.toString('utf8')} `),
        timestamp,
        signature: signature(),
        secret,
        nowMs,
      }),
    ).toBe(false);
  });

  it('rejects timestamps more than five minutes old or in the future', () => {
    expect(
      verifyIproWebhookSignature({
        rawBody,
        timestamp,
        signature: signature(),
        secret,
        nowMs: nowMs + 301_000,
      }),
    ).toBe(false);
    expect(
      verifyIproWebhookSignature({
        rawBody,
        timestamp,
        signature: signature(),
        secret,
        nowMs: nowMs - 301_000,
      }),
    ).toBe(false);
  });

  it.each([
    ['', signature()],
    ['not-a-number', signature()],
    [timestamp, ''],
    [timestamp, 'sha256=abc'],
    [timestamp, 'v1=ABCDEF'],
    [timestamp, 'v1=zzzz'],
    [timestamp, 'v1=abcd'],
  ])('rejects malformed timestamp/signature headers', (timestampHeader, signatureHeader) => {
    expect(
      verifyIproWebhookSignature({
        rawBody,
        timestamp: timestampHeader,
        signature: signatureHeader,
        secret,
        nowMs,
      }),
    ).toBe(false);
  });

  it('returns false without throwing when the supplied digest has a different length', () => {
    expect(() =>
      verifyIproWebhookSignature({
        rawBody,
        timestamp,
        signature: `v1=${'00'.repeat(31)}`,
        secret,
        nowMs,
      }),
    ).not.toThrow();
    expect(
      verifyIproWebhookSignature({
        rawBody,
        timestamp,
        signature: `v1=${'00'.repeat(31)}`,
        secret,
        nowMs,
      }),
    ).toBe(false);
  });
});
