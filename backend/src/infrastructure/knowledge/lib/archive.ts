import { unzipSync } from 'fflate';

export interface ArchiveEntry {
  path: string;
  bytes: Uint8Array;
}

export interface ArchivePlan {
  entries: ArchiveEntry[];
  skipped: { path: string; reason: string }[];
  truncated: boolean;
}

const isUnsafe = (p: string) =>
  p.includes('..') ||
  p.startsWith('/') ||
  p.startsWith('__MACOSX/') ||
  p.split('/').some((seg) => seg.startsWith('.')) ||
  p.endsWith('/');

export function planArchiveEntries(
  buf: Buffer,
  opt: { maxEntries: number; maxTotalBytes: number; maxCompressedBytes?: number },
): ArchivePlan {
  // 入口ガード（zip-bomb 対策）: 圧縮サイズ自体が上限超過なら全展開（unzipSync）に踏み込まず即打ち切る。
  // unzipSync は全エントリを一括展開するため、巨大圧縮入力では展開後 maxTotalBytes チェックに
  // 到達する前に OOM しうる。圧縮サイズで先にゲートして OOM を防ぐ。
  // NOTE（残存リスク）: fflate はストリーミング/逐次の解凍上限 API を持たないため、
  //   この圧縮サイズゲート未満の入力に対しては依然 unzipSync が全エントリをメモリ展開する。
  //   完全な防御には別の zip ライブラリ（逐次デコード）が必要。ここは入口での粗いガードに留める。
  const maxCompressedBytes = opt.maxCompressedBytes ?? 100 * 1024 * 1024;
  if (buf.length > maxCompressedBytes) {
    return {
      entries: [],
      skipped: [{ path: '(archive)', reason: 'too_large' }],
      truncated: true,
    };
  }
  const files = unzipSync(new Uint8Array(buf));
  const entries: ArchiveEntry[] = [];
  const skipped: ArchivePlan['skipped'] = [];
  let total = 0;
  let truncated = false;
  for (const [path, bytes] of Object.entries(files)) {
    if (isUnsafe(path)) {
      skipped.push({
        path,
        reason:
          path.includes('..') || path.startsWith('/') ? 'traversal' : 'hidden',
      });
      continue;
    }
    if (
      entries.length >= opt.maxEntries ||
      total + bytes.length > opt.maxTotalBytes
    ) {
      truncated = true;
      break;
    }
    total += bytes.length;
    entries.push({ path, bytes });
  }
  return { entries, skipped, truncated };
}
