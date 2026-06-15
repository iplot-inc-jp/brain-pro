import { PRESENCE_COLORS, deterministicColor } from './presence-colors';

describe('deterministicColor', () => {
  it('returns a color from the palette', () => {
    expect(PRESENCE_COLORS).toContain(deterministicColor('user-abc'));
  });

  it('is stable for the same id', () => {
    expect(deterministicColor('user-abc')).toBe(deterministicColor('user-abc'));
  });

  it('handles empty string without throwing', () => {
    expect(PRESENCE_COLORS).toContain(deterministicColor(''));
  });

  it('spreads different ids across the palette (not all identical)', () => {
    const colors = new Set(
      Array.from({ length: 50 }, (_, i) => deterministicColor(`user-${i}`)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
