import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PATTERN = /^v1=([0-9a-f]{64})$/;
const DEFAULT_TOLERANCE_SECONDS = 300;

export interface VerifyIproWebhookSignatureInput {
  rawBody: Buffer | string;
  timestamp: string;
  signature: string;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}

/** Verify an ipro-db v1 HMAC against the exact, unparsed request body. */
export function verifyIproWebhookSignature(input: VerifyIproWebhookSignatureInput): boolean {
  if (!/^\d+$/.test(input.timestamp) || !input.secret) return false;
  const matched = SIGNATURE_PATTERN.exec(input.signature);
  if (!matched) return false;

  const occurredAtMs = Number(input.timestamp) * 1000;
  const nowMs = input.nowMs ?? Date.now();
  const toleranceSeconds = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (
    !Number.isSafeInteger(occurredAtMs) ||
    !Number.isFinite(nowMs) ||
    !Number.isSafeInteger(toleranceSeconds) ||
    toleranceSeconds < 0 ||
    Math.abs(nowMs - occurredAtMs) > toleranceSeconds * 1000
  ) {
    return false;
  }

  const expected = createHmac('sha256', input.secret)
    .update(input.timestamp)
    .update('.')
    .update(input.rawBody)
    .digest();
  const supplied = Buffer.from(matched[1], 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
