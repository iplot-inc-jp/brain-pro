import { evaluateInviteValidity } from './invite-validity';

const NOW = new Date('2026-06-28T00:00:00.000Z');
const base = { revokedAt: null as Date | null, expiresAt: null as Date | null, maxUses: null as number | null, useCount: 0 };

describe('evaluateInviteValidity', () => {
  it('null は notfound', () => {
    expect(evaluateInviteValidity(null, NOW)).toEqual({ valid: false, reason: 'notfound' });
  });
  it('未失効・無期限・無制限は valid', () => {
    expect(evaluateInviteValidity({ ...base }, NOW)).toEqual({ valid: true, reason: null });
  });
  it('revokedAt があれば revoked', () => {
    expect(evaluateInviteValidity({ ...base, revokedAt: NOW }, NOW)).toEqual({ valid: false, reason: 'revoked' });
  });
  it('expiresAt <= now は expired', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(evaluateInviteValidity({ ...base, expiresAt: past }, NOW)).toEqual({ valid: false, reason: 'expired' });
  });
  it('expiresAt が未来なら valid', () => {
    const future = new Date(NOW.getTime() + 1000);
    expect(evaluateInviteValidity({ ...base, expiresAt: future }, NOW).valid).toBe(true);
  });
  it('useCount >= maxUses は maxed', () => {
    expect(evaluateInviteValidity({ ...base, maxUses: 3, useCount: 3 }, NOW)).toEqual({ valid: false, reason: 'maxed' });
  });
  it('useCount < maxUses は valid', () => {
    expect(evaluateInviteValidity({ ...base, maxUses: 3, useCount: 2 }, NOW).valid).toBe(true);
  });
  it('revoked が expired より優先', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(evaluateInviteValidity({ ...base, revokedAt: NOW, expiresAt: past }, NOW).reason).toBe('revoked');
  });
});
