import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listMeetingOccurrences } from './meeting-occurrences';

// listMeetingOccurrences が検索フィルタを正しくクエリ文字列へ組み立てるかを検証（fetch をモック）。
function mockFetch() {
  const fn = vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}
function calledUrl(fn: ReturnType<typeof mockFetch>): string {
  return String(fn.mock.calls.at(-1)?.[0]);
}
function paramsOf(url: string): URLSearchParams {
  return new URL(url, 'http://x').searchParams;
}

describe('listMeetingOccurrences（検索クエリ組み立て）', () => {
  beforeEach(() => {
    // localStorage 未定義環境（vitest node）でも getHeaders が落ちないように。
    vi.stubGlobal('window', undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('フィルタ無しならクエリ文字列を付けない', async () => {
    const fn = mockFetch();
    await listMeetingOccurrences('p1');
    expect(calledUrl(fn)).toContain('/api/projects/p1/meeting-occurrences');
    expect(calledUrl(fn)).not.toContain('?');
  });

  it('meetingId / q / from / to を全て載せる', async () => {
    const fn = mockFetch();
    await listMeetingOccurrences('p1', { meetingId: 's1', q: '仕様変更', from: '2026-07-01', to: '2026-07-31' });
    const p = paramsOf(calledUrl(fn));
    expect(p.get('meetingId')).toBe('s1');
    expect(p.get('q')).toBe('仕様変更');
    expect(p.get('from')).toBe('2026-07-01');
    expect(p.get('to')).toBe('2026-07-31');
  });

  it('空白のみの q はクエリに載せない（トリム）', async () => {
    const fn = mockFetch();
    await listMeetingOccurrences('p1', { q: '   ' });
    expect(paramsOf(calledUrl(fn)).has('q')).toBe(false);
  });

  it('q の前後空白はトリムして載せる', async () => {
    const fn = mockFetch();
    await listMeetingOccurrences('p1', { q: '  会議  ' });
    expect(paramsOf(calledUrl(fn)).get('q')).toBe('会議');
  });

  it('res.ok=false なら例外', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response));
    await expect(listMeetingOccurrences('p1')).rejects.toThrow();
  });
});
