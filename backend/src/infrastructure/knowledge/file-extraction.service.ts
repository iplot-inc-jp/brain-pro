import { Injectable } from '@nestjs/common';
import { xlsxBufferToMarkdown } from './lib/xlsx-to-markdown';
import { planArchiveEntries, ArchivePlan } from './lib/archive';

/**
 * ファイルの種別判定と、型別のテキスト抽出 / アーカイブ展開計画を担うサービス。
 *
 * - PDF / 画像は自前でテキスト化せず `needsVision=true` を返し、上位（パイプライン）が
 *   Claude の document / image ブロックでネイティブに読む。
 * - spreadsheet（Excel/CSV）は SheetJS で Markdown 表へ、docx は mammoth でプレーンテキストへ、
 *   text/md/json は UTF-8 デコードで返す。
 * - archive（ZIP）は展開せず `expand()` で安全な展開計画（planArchiveEntries）を返す。
 *
 * I/O 境界（純ロジックは lib/* に分離）。
 */
export type FileKind =
  | 'pdf'
  | 'image'
  | 'spreadsheet'
  | 'doc'
  | 'text'
  | 'archive'
  | 'unsupported';

export interface ExtractTextResult {
  /** 抽出できたテキスト（spreadsheet=Markdown表 / doc=raw text / text=本文）。 */
  text?: string;
  /** PDF・画像など、Claude の多モーダル（vision/document）で読むべき種別。 */
  needsVision?: boolean;
  /** unsupported / 抽出不能などの理由（step/error 表示用）。 */
  reason?: string;
}

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const PDF_MIME = /^application\/pdf$/i;
const ARCHIVE_MIME = /^application\/(zip|x-zip-compressed|x-zip)$/i;
const SPREADSHEET_MIME =
  /(spreadsheetml|ms-excel|vnd\.oasis\.opendocument\.spreadsheet|text\/csv)/i;
const DOC_MIME =
  /(wordprocessingml|msword|vnd\.oasis\.opendocument\.text)/i;
const TEXT_MIME = /^(text\/|application\/(json|xml|x-yaml|yaml))/i;

const EXT = (filename: string): string => {
  const m = /\.([a-z0-9]+)$/i.exec(filename || '');
  return m ? m[1].toLowerCase() : '';
};

@Injectable()
export class FileExtractionService {
  /**
   * MIME と拡張子から種別を判定する。MIME 不明（octet-stream 等）でも拡張子で救済する。
   */
  classify(mime: string | null | undefined, filename: string): FileKind {
    const m = (mime || '').toLowerCase();
    const ext = EXT(filename);

    if (PDF_MIME.test(m) || ext === 'pdf') return 'pdf';
    if (IMAGE_MIME.test(m) || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'].includes(ext))
      return 'image';
    if (ARCHIVE_MIME.test(m) || ext === 'zip') return 'archive';
    if (SPREADSHEET_MIME.test(m) || ['xlsx', 'xls', 'csv', 'ods'].includes(ext))
      return 'spreadsheet';
    if (DOC_MIME.test(m) || ['docx', 'doc', 'odt'].includes(ext)) return 'doc';
    if (TEXT_MIME.test(m) || ['txt', 'md', 'markdown', 'json', 'xml', 'yaml', 'yml', 'csv'].includes(ext))
      return 'text';
    return 'unsupported';
  }

  /**
   * 種別ごとにテキストを抽出する。PDF/画像は抽出せず needsVision を立てて返す。
   *
   * @param kind   classify() の結果。
   * @param bytes  原本バイト列。
   */
  async extractText(
    kind: FileKind,
    bytes: Buffer | Uint8Array,
  ): Promise<ExtractTextResult> {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    switch (kind) {
      case 'pdf':
      case 'image':
        // 自前テキスト化はせず、Claude の多モーダルで読む。
        return { needsVision: true };

      case 'spreadsheet':
        return { text: xlsxBufferToMarkdown(buf) };

      case 'doc': {
        // mammoth は遅延 import（依存未導入環境で import 時に落ちないよう）。
        const mammoth = await import('mammoth');
        const fn = (mammoth as any).extractRawText ?? (mammoth as any).default?.extractRawText;
        const res = await fn({ buffer: buf });
        return { text: typeof res?.value === 'string' ? res.value : '' };
      }

      case 'text':
        return { text: buf.toString('utf8') };

      case 'archive':
        return {
          reason:
            'アーカイブは extractText では処理しない（expand() で展開する）',
        };

      case 'unsupported':
      default:
        return { reason: '未対応の MIME / 拡張子' };
    }
  }

  /**
   * ZIP 等のアーカイブを安全な展開計画へ変換する（実際の Blob 保存・子ファイル生成は上位）。
   * zip-bomb / パストラバーサル / 隠しファイルは planArchiveEntries 側で除外・打ち切りされる。
   *
   * @param bytes  アーカイブ原本。
   * @param opt    上限（既定 maxEntries=500 / maxTotalBytes=500MB）。
   */
  expand(
    bytes: Buffer | Uint8Array,
    opt?: {
      maxEntries?: number;
      maxTotalBytes?: number;
      maxCompressedBytes?: number;
    },
  ): ArchivePlan {
    const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return planArchiveEntries(buf, {
      maxEntries: opt?.maxEntries ?? 500,
      maxTotalBytes: opt?.maxTotalBytes ?? 500 * 1024 * 1024,
      maxCompressedBytes: opt?.maxCompressedBytes ?? 100 * 1024 * 1024,
    });
  }
}
