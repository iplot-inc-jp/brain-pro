import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { GithubService, mimeForImagePath } from './github.service';
import { BlobStorageService } from './blob-storage.service';

// 連携リポジトリ内の取り込み対象ルート（この配下のフォルダ階層が URL slug になる）。
export const SCREENSHOTS_ROOT = 'docs/screenshots';

export interface ScreenshotImportSummary {
  imported: number; // 新規取り込み
  updated: number; // sha 変化で再取得
  skipped: number; // 変化なし
  removed: number; // リポジトリから消えたため削除
  total: number; // リポジトリ上の対象画像数
}

/**
 * GitHub 連携リポジトリの docs/screenshots/ 配下の画像を取り込み、PageScreenshot(source=GITHUB)
 * として保存するサービス。ディレクトリ階層を slug、ファイル名をキャプションとして扱う。
 */
@Injectable()
export class ScreenshotImportService {
  private readonly logger = new Logger(ScreenshotImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly github: GithubService,
    private readonly blob: BlobStorageService,
  ) {}

  /**
   * リポジトリ内パスから slug とキャプションを導出する。
   * - docs/screenshots/orders/list/empty.png → slug=/orders/list, caption=empty
   * - docs/screenshots/login.png            → slug=/login,        caption=''（ファイル名=slug）
   */
  static deriveSlugCaption(filePath: string): { slug: string; caption: string } {
    const prefix = SCREENSHOTS_ROOT.replace(/\/+$/, '') + '/';
    const rel = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
    const parts = rel.split('/').filter(Boolean);
    const filename = parts.pop() ?? rel;
    const base = filename.replace(/\.[^.]+$/, '');
    if (parts.length > 0) {
      return { slug: '/' + parts.join('/'), caption: base };
    }
    return { slug: '/' + base, caption: '' };
  }

  /** プロジェクトの GitHub 連携を解決して取り込む（connectionId 未指定なら最古の連携）。 */
  async importForProject(
    projectId: string,
    connectionId?: string,
  ): Promise<ScreenshotImportSummary> {
    const connection = connectionId
      ? await this.prisma.githubConnection.findFirst({
          where: { id: connectionId, projectId },
        })
      : await this.prisma.githubConnection.findFirst({
          where: { projectId },
          orderBy: { createdAt: 'asc' },
        });
    if (!connection) {
      throw new Error(
        'GitHub 連携がありません。先に「コード連携」でリポジトリを接続してください。',
      );
    }
    return this.importForConnection(connection);
  }

  /** 1連携分を取り込む。sha 変化分のみ Blob 保存し、消えた分は削除する。 */
  async importForConnection(connection: {
    id: string;
    projectId: string;
    repoFullName: string;
    branch: string;
    tokenEnc: string;
  }): Promise<ScreenshotImportSummary> {
    const token = this.crypto.decrypt(connection.tokenEnc);
    const branch = connection.branch || 'main';

    const files = await this.github.listImageFiles(
      connection.repoFullName,
      branch,
      token,
      SCREENSHOTS_ROOT,
    );

    // プロジェクト全体の既存（unique は projectId+filePath なので path で突合）。
    const existing = await this.prisma.pageScreenshot.findMany({
      where: { projectId: connection.projectId, source: 'GITHUB' },
    });
    const byPath = new Map(existing.map((e) => [e.filePath ?? '', e]));
    const seen = new Set<string>();

    let imported = 0;
    let updated = 0;
    let skipped = 0;

    for (const f of files) {
      seen.add(f.path);
      const prev = byPath.get(f.path);
      if (prev && prev.fileSha === f.sha) {
        skipped++;
        continue;
      }
      const bytes = await this.github.fetchBlobBytes(connection.repoFullName, f.sha, token);
      const mime = mimeForImagePath(f.path);
      const filename = f.path.split('/').pop() ?? 'screenshot';
      const key = `screenshots/${connection.projectId}/${f.sha}-${filename}`;
      const { url } = await this.blob.save(key, bytes, mime);
      const { slug, caption } = ScreenshotImportService.deriveSlugCaption(f.path);

      if (prev) {
        await this.prisma.pageScreenshot.update({
          where: { id: prev.id },
          data: {
            connectionId: connection.id,
            slug,
            caption,
            fileSha: f.sha,
            blobUrl: url,
            mimeType: mime,
            size: bytes.length,
            importedAt: new Date(),
          },
        });
        updated++;
      } else {
        await this.prisma.pageScreenshot.create({
          data: {
            projectId: connection.projectId,
            source: 'GITHUB',
            connectionId: connection.id,
            slug,
            caption,
            filePath: f.path,
            fileSha: f.sha,
            blobUrl: url,
            mimeType: mime,
            size: bytes.length,
          },
        });
        imported++;
      }
    }

    // この連携由来で、リポジトリから消えたものを削除。
    const toRemove = existing.filter(
      (e) => e.connectionId === connection.id && !seen.has(e.filePath ?? ''),
    );
    if (toRemove.length) {
      await this.prisma.pageScreenshot.deleteMany({
        where: { id: { in: toRemove.map((e) => e.id) } },
      });
    }

    this.logger.log(
      `Screenshots import for ${connection.repoFullName}: +${imported} ~${updated} =${skipped} -${toRemove.length} (total ${files.length})`,
    );
    return {
      imported,
      updated,
      skipped,
      removed: toRemove.length,
      total: files.length,
    };
  }
}
