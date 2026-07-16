import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assertSafeOutboundUrl } from './url-safety';

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

  private get privateToken(): string | undefined {
    const token = process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
    return token && token.trim() ? token.trim() : undefined;
  }

  private requirePrivateToken(): string {
    const token = this.privateToken;
    if (!token) {
      throw new Error(
        'PRIVATE_BLOB_READ_WRITE_TOKEN is required for private material storage',
      );
    }
    return token;
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
   * Issue a short-lived, exact-path upload URL for the dedicated private Blob
   * store. The browser can upload large files without passing them through the
   * Vercel Function request body.
   */
  async createPrivateUpload(
    pathname: string,
    contentType: string,
    maximumSizeInBytes: number,
    validUntil = Date.now() + 10 * 60 * 1000,
  ): Promise<{ uploadUrl: string; pathname: string; expiresAt: number }> {
    const token = this.requirePrivateToken();
    const normalizedPathname = pathname.replace(/^\/+/, '');
    const { issueSignedToken, presignUrl } = await import('@vercel/blob');
    const signedToken = await issueSignedToken({
      token,
      pathname: normalizedPathname,
      operations: ['put'],
      validUntil,
      allowedContentTypes: [contentType],
      maximumSizeInBytes,
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      access: 'private',
      operation: 'put',
      pathname: normalizedPathname,
      allowedContentTypes: [contentType],
      maximumSizeInBytes,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return {
      uploadUrl: presignedUrl,
      pathname: normalizedPathname,
      expiresAt: signedToken.validUntil,
    };
  }

  /** Read metadata directly from the dedicated private Blob store. */
  async headPrivate(pathname: string) {
    const { head } = await import('@vercel/blob');
    return head(pathname.replace(/^\/+/, ''), {
      token: this.requirePrivateToken(),
    });
  }

  /**
   * Read a private object from origin (never CDN cache) while enforcing the
   * byte ceiling against the stream itself. Content-Length alone is not trusted.
   */
  async readPrivate(
    pathname: string,
    maximumSizeInBytes: number,
  ): Promise<Buffer> {
    const { get } = await import('@vercel/blob');
    const result = await get(pathname.replace(/^\/+/, ''), {
      access: 'private',
      token: this.requirePrivateToken(),
      useCache: false,
    });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error('private blob could not be read');
    }

    const reader = result.stream.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maximumSizeInBytes) {
          await reader.cancel('private blob exceeds maximum size');
          throw new Error(
            `private blob exceeds maximum size (${maximumSizeInBytes} bytes)`,
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks, total);
  }

  async deletePrivate(pathname: string): Promise<void> {
    const { del } = await import('@vercel/blob');
    await del(pathname.replace(/^\/+/, ''), {
      token: this.requirePrivateToken(),
    });
  }

  async createPrivateDownload(
    pathname: string,
    validUntil = Date.now() + 5 * 60 * 1000,
  ): Promise<{ downloadUrl: string; expiresAt: number }> {
    const normalizedPathname = pathname.replace(/^\/+/, '');
    const { issueSignedToken, presignUrl } = await import('@vercel/blob');
    const signedToken = await issueSignedToken({
      token: this.requirePrivateToken(),
      pathname: normalizedPathname,
      operations: ['get'],
      validUntil,
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      access: 'private',
      operation: 'get',
      pathname: normalizedPathname,
      validUntil,
    });
    return { downloadUrl: presignedUrl, expiresAt: signedToken.validUntil };
  }

  /** A DB-safe opaque reference; unlike a Blob object URL it exposes no private URL. */
  privateReference(pathname: string): string {
    return `private-blob:${pathname.replace(/^\/+/, '')}`;
  }

  async savePrivate(
    pathname: string,
    bytes: Buffer | Uint8Array,
    contentType?: string,
  ): Promise<{ reference: string; pathname: string }> {
    const normalizedPathname = pathname.replace(/^\/+/, '');
    if (!this.privateToken) {
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        this.requirePrivateToken();
      }
      const saved = await this.save(normalizedPathname, bytes, contentType, {
        stable: true,
      });
      return { reference: saved.url, pathname: normalizedPathname };
    }
    const { put } = await import('@vercel/blob');
    await put(
      normalizedPathname,
      Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes),
      {
        access: 'private',
        token: this.privateToken,
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
      },
    );
    return {
      reference: this.privateReference(normalizedPathname),
      pathname: normalizedPathname,
    };
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
    options: { stable?: boolean } = {},
  ): Promise<{ url: string }> {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    if (this.token) {
      // @vercel/blob は ESM。token 未設定環境では読み込まないよう遅延 import。
      const { put } = await import('@vercel/blob');
      const res = await put(key.replace(/^\/+/, ''), data, {
        access: 'public',
        token: this.token,
        contentType,
        // 外部システムの再送など、呼び出し側が DB 上の一意性と内容 fingerprint を
        // 保証する場合だけ同じ pathname を上書きして crash retry の orphan を防ぐ。
        addRandomSuffix: options.stable !== true,
        allowOverwrite: options.stable === true,
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
   * @vercel/blob の公開ストアのホストかどうか。
   * 形式は `<storeId>.public.blob.vercel-storage.com`（リージョン別の `*.public.blob...` も含む）。
   * read() のアローリスト判定に使う（任意の https へ fetch させない = SSRF 防止）。
   */
  private isVercelBlobHost(hostname: string): boolean {
    const h = hostname.toLowerCase();
    return (
      h === 'blob.vercel-storage.com' ||
      h.endsWith('.public.blob.vercel-storage.com')
    );
  }

  /**
   * `file://` URL / 生パスを正規化した絶対パスにし、UPLOAD_DIR 配下かつ
   * 取り込み専用領域（`ingestion` / `external-materials` キー由来）であることを検証して返す。違反は throw。
   *
   * - シンボリックリンク等での外抜けを防ぐため path.resolve 済みの前置一致で判定する。
   * - 取り込み領域の限定: save() は key `ingestion/<projectId>/<id>/<name>` または
   *   `external-materials/<projectId>/<id>/<name>` をディスク fallback では区切りを `_` に潰す
   *   （Blob/将来のレイアウトでは segment 維持もありうる）。そのため
   *   「許可済みパスセグメント」または対応する flattened basename で始まる
   *   のどちらかを満たすものだけ許可し、UPLOAD_DIR 内の他用途ファイル
   *   （添付の生ファイル等）を blobUrl 偽装で読み出されるのを防ぐ。
   */
  private resolveSafeDiskPath(rawPath: string): string {
    const baseDir = path.resolve(this.uploadDir);
    const resolved = path.resolve(rawPath);
    const rel = path.relative(baseDir, resolved);
    // baseDir の外（'..' で始まる）や絶対パスに戻るものは拒否。
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `BlobStorageService.read: path is outside UPLOAD_DIR: ${rawPath}`,
      );
    }
    // サーバが生成する取り込み領域だけに限定。external-materials は fingerprint を
    // DB に先行保存する外部資料 API 専用で、任意 client path の許可には使わない。
    const segments = rel.split(/[/\\]+/);
    const basename = segments[segments.length - 1] ?? '';
    const isIngestion =
      segments.includes('ingestion') ||
      basename.startsWith('ingestion_') ||
      segments.includes('external-materials') ||
      basename.startsWith('external-materials_');
    if (!isIngestion) {
      throw new Error(
        `BlobStorageService.read: path is not under an allowed material area: ${rawPath}`,
      );
    }
    return resolved;
  }

  /**
   * UPLOAD_DIR 配下のサーバ導出パス（既存 Attachment のディスク保存 `<id>-<name>` 等）を読む。
   * read() と違い `ingestion/` セグメントは要求しないが、UPLOAD_DIR 配下であることは強制する
   * （DB 由来 url の traversal 防御）。client 由来の blobUrl にはこのメソッドを使わないこと。
   */
  async readUploadFile(diskPath: string): Promise<Buffer> {
    if (!diskPath) {
      throw new Error('BlobStorageService.readUploadFile: diskPath is empty');
    }
    const baseDir = path.resolve(this.uploadDir);
    const resolved = path.resolve(diskPath);
    const rel = path.relative(baseDir, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `BlobStorageService.readUploadFile: path is outside UPLOAD_DIR: ${diskPath}`,
      );
    }
    return fs.promises.readFile(resolved);
  }

  /**
   * `save()` が返した URL（Blob 公開 URL）または `file://` パス、もしくは生のディスクパスから
   * バイト列を読み出して Buffer で返す。
   *
   * SSRF/LFI 対策のアローリスト:
   *   - https かつ @vercel/blob の公開ホスト（`*.public.blob.vercel-storage.com`）のみ fetch。
   *     さらに assertSafeOutboundUrl で内部/メタデータ宛を遮断（DNS リバインディング含む）。
   *   - file:// / 生パスは UPLOAD_DIR 配下かつ `ingestion/` セグメントを含むものだけ readFile。
   * それ以外（任意 http(s)、file:///etc/passwd、UPLOAD_DIR 外）は throw。
   */
  async read(urlOrKey: string): Promise<Buffer> {
    if (!urlOrKey) {
      throw new Error('BlobStorageService.read: urlOrKey is empty');
    }

    if (urlOrKey.startsWith('private-blob:')) {
      return this.readPrivate(
        urlOrKey.slice('private-blob:'.length),
        50 * 1024 * 1024,
      );
    }

    // ディスク（file:// または絶対/相対パス）。UPLOAD_DIR 配下の ingestion/ のみ許可。
    if (urlOrKey.startsWith('file://')) {
      const p = urlOrKey.slice('file://'.length);
      return fs.promises.readFile(this.resolveSafeDiskPath(p));
    }
    if (!/^https?:\/\//i.test(urlOrKey)) {
      // http(s) でない＝ローカルパス扱い。
      return fs.promises.readFile(this.resolveSafeDiskPath(urlOrKey));
    }

    // http(s): https かつ Vercel Blob 公開ホストのみ許可。
    let parsed: URL;
    try {
      parsed = new URL(urlOrKey);
    } catch {
      throw new Error(`BlobStorageService.read: invalid URL: ${urlOrKey}`);
    }
    if (
      parsed.protocol !== 'https:' ||
      !this.isVercelBlobHost(parsed.hostname)
    ) {
      throw new Error(
        `BlobStorageService.read: URL is not an allowed Vercel Blob host: ${parsed.protocol}//${parsed.hostname}`,
      );
    }
    // 内部/メタデータ宛・DNS リバインディングを遮断（解決後 IP まで検証）。
    await assertSafeOutboundUrl(urlOrKey);

    const res = await fetch(urlOrKey, { redirect: 'manual' });
    if (!res.ok) {
      throw new Error(
        `BlobStorageService.read: fetch failed ${res.status} for ${urlOrKey}`,
      );
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }
}
