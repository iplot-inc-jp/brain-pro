import { zipSync, strToU8 } from 'fflate';
import { planArchiveEntries } from './archive';

const zip = Buffer.from(
  zipSync({
    'a.txt': strToU8('hello'),
    '__MACOSX/x': strToU8('junk'),
    '../evil.txt': strToU8('bad'),
    'sub/b.csv': strToU8('x,y'),
  }),
);

describe('planArchiveEntries', () => {
  it('隠し/トラバーサルを除外し安全なエントリのみ', () => {
    const { entries, skipped } = planArchiveEntries(zip, {
      maxEntries: 100,
      maxTotalBytes: 1e9,
    });
    const names = entries.map((e) => e.path).sort();
    expect(names).toEqual(['a.txt', 'sub/b.csv']);
    expect(skipped.some((s) => s.reason === 'traversal')).toBe(true);
  });
  it('上限超過で打ち切り（無音にしない）', () => {
    const { entries, truncated } = planArchiveEntries(zip, {
      maxEntries: 1,
      maxTotalBytes: 1e9,
    });
    expect(entries.length).toBe(1);
    expect(truncated).toBe(true);
  });
  it('圧縮サイズが上限超過なら全展開せず too_large で即打ち切り（OOM 入口ガード）', () => {
    // 圧縮入力サイズ（zip.length）より小さい maxCompressedBytes を与え、
    // unzipSync に踏み込まずに即打ち切られることを確認する。
    const { entries, skipped, truncated } = planArchiveEntries(zip, {
      maxEntries: 100,
      maxTotalBytes: 1e9,
      maxCompressedBytes: 1, // zip.length(>1) を確実に超過
    });
    expect(entries).toHaveLength(0);
    expect(truncated).toBe(true);
    expect(skipped).toEqual([{ path: '(archive)', reason: 'too_large' }]);
  });
});
