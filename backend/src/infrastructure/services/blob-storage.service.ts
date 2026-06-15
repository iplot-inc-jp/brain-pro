import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 原本ファイル・生成画像の保管を抽象化するサービス。
 *
 * - `BLOB_READ_WRITE_TOKEN` が設定されていれば Vercel Blob（@vercel/blob）に保存し、
 *   公開 URL を返す。読み出しはその URL を fetch する。
 * - 未設定の場合は `UPLOAD_DIR`（既定 process.cwd()/uploads）配下のディスクへ
 *   フォールバック保存し、`file://<絶対パス>` 形式の擬似 URL（read() に再投入可能）を返す。
 *   既存 Attachment のディスク保存と同じ場所・方針。
 *
 * バッチ文書は DB Bytes（約4MB）に載らないため、原本は Blob/ディスクに置き、
 * DB には URL（blobUrl）だけを保持する。
 */
@Injectable()
export class BlobStorageService {
  private readonly logger = new Logger(BlobStorageService.name);

  private get token(): string | undefined {
    const t = process.env.BLOB_READ_WRITE_TOKEN;
    return t && t.trim() ? t.trim() : undefined;
  }

  private get uploadDir(): string {
    return process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
  }

  /** ディスク保存キーに使える形へファイル名を正規化（パス区切り・制御文字・空白・連続ドットを除去）。 */
  private sanitizeKey(key: string): string {
    const stripped = Array.from(key || 'file')
      .filter((ch) => (ch.codePointAt(0) ?? 0) >= 0x20)
      .join('');
    return stripped
      .replace(/[/\\]+/g, '_')
      .replace(/\.\.+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 240);
  }

  /**
   * bytes を保存し、後で `read()` に渡せる URL（またはキー兼用文字列）を返す。
   *
   * @param key  論理パス（例 `ingestion/<fileId>/<filename>`）。Blob のパス／ディスクのファイル名に使う。
   * @param bytes  保存するバイト列。
   * @param contentType  MIME（Blob のメタに付与）。
   */
  async save(
    key: string,
    bytes: Buffer | Uint8Array,
    contentType?: string,
  ): Promise<{ url: string }> {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    if (this.token) {
      // @vercel/blob は ESM。token 未設定環境では読み込まないよう遅延 import。
      const { put } = await import('@vercel/blob');
      const res = await put(key.replace(/^\/+/, ''), data, {
        access: 'public',
        token: this.token,
        contentType,
        addRandomSuffix: true,
      });
      return { url: res.url };
    }

    // ディスク fallback。
    const dir = this.uploadDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = this.sanitizeKey(key);
    const diskPath = path.join(dir, filename);
    fs.writeFileSync(diskPath, data);
    // ディスク保存時はそのまま read() に渡せる絶対パスを `file://` URL として返す。
    return { url: `file://${diskPath}` };
  }

  /**
   * `save()` が返した URL（Blob 公開 URL）または `file://` パス、もしくは生のディスクパスから
   * バイト列を読み出して Buffer で返す。
   */
  async read(urlOrKey: string): Promise<Buffer> {
    if (!urlOrKey) {
      throw new Error('BlobStorageService.read: urlOrKey is empty');
    }

    // ディスク（file:// または絶対/相対パス）。
    if (urlOrKey.startsWith('file://')) {
      const p = urlOrKey.slice('file://'.length);
      return fs.promises.readFile(p);
    }
    if (!/^https?:\/\//i.test(urlOrKey)) {
      // http(s) でない＝ローカルパス扱い。
      return fs.promises.readFile(urlOrKey);
    }

    // http(s) は fetch して取得（Blob 公開 URL を含む）。
    const res = await fetch(urlOrKey);
    if (!res.ok) {
      throw new Error(
        `BlobStorageService.read: fetch failed ${res.status} for ${urlOrKey}`,
      );
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
}
