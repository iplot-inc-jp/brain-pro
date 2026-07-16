import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

export class DocumentPageParseError extends Error {
  constructor(format: "PDF" | "PPTX") {
    super(`Unable to read ${format} pages: invalid or corrupt document`);
    this.name = "DocumentPageParseError";
  }
}

export interface PdfPage {
  pageNumber: number;
  bytes: Uint8Array;
}

export interface PptxSlideImage {
  bytes: Uint8Array;
  mimeType: string;
}

export interface PptxSlide {
  pageNumber: number;
  sourceText: string;
  images: PptxSlideImage[];
}

export async function splitPdfPages(
  bytes: Buffer | Uint8Array,
): Promise<PdfPage[]> {
  try {
    const source = await PDFDocument.load(bytes);

    return await Promise.all(
      source.getPageIndices().map(async (pageIndex) => {
        const document = await PDFDocument.create();
        const [page] = await document.copyPages(source, [pageIndex]);
        document.addPage(page);
        return {
          pageNumber: pageIndex + 1,
          bytes: await document.save(),
        };
      }),
    );
  } catch {
    throw new DocumentPageParseError("PDF");
  }
}

export function readPptxSlides(bytes: Buffer | Uint8Array): PptxSlide[] {
  try {
    const files = unzipSync(bytes);
    const slidePaths = Object.keys(files)
      .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
      .sort((a, b) => slideNumber(a) - slideNumber(b));
    if (slidePaths.length === 0) {
      throw new DocumentPageParseError("PPTX");
    }

    return slidePaths.map((path) => ({
      pageNumber: slideNumber(path),
      sourceText: extractRunTexts(strFromU8(files[path])).join("\n"),
      images: readSlideImages(path, files),
    }));
  } catch {
    throw new DocumentPageParseError("PPTX");
  }
}

function readSlideImages(
  slidePath: string,
  files: Record<string, Uint8Array>,
): PptxSlideImage[] {
  const lastSlash = slidePath.lastIndexOf("/");
  const directory = slidePath.slice(0, lastSlash);
  const filename = slidePath.slice(lastSlash + 1);
  const relationships = files[`${directory}/_rels/${filename}.rels`];
  if (!relationships) return [];

  const images: PptxSlideImage[] = [];
  const relationshipTag = /<Relationship\b([^>]*)\/?\s*>/g;
  const xml = strFromU8(relationships);
  let match: RegExpExecArray | null;
  while ((match = relationshipTag.exec(xml)) !== null) {
    const attributes = readXmlAttributes(match[1]);
    if (
      attributes.TargetMode?.toLowerCase() === "external" ||
      !attributes.Type?.endsWith("/image") ||
      !attributes.Target
    ) {
      continue;
    }

    const mediaPath = resolvePartPath(directory, attributes.Target);
    const mimeType = imageMimeType(mediaPath);
    const media = files[mediaPath];
    if (!mediaPath.startsWith("ppt/media/") || !mimeType || !media) continue;

    images.push({ bytes: media, mimeType });
  }
  return images;
}

function readXmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attribute = /([\w:]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(source)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[3]);
  }
  return attributes;
}

function resolvePartPath(directory: string, target: string): string {
  const parts = target.startsWith("/")
    ? target.replace(/^\/+/, "").split("/")
    : `${directory}/${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function imageMimeType(path: string): string | undefined {
  const extension = path.match(/\.([^.]+)$/)?.[1].toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return undefined;
  }
}

function slideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function extractRunTexts(xml: string): string[] {
  const texts: string[] = [];
  const runText = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = runText.exec(xml)) !== null) {
    const text = decodeXmlEntities(match[1]).trim();
    if (text) texts.push(text);
  }
  return texts;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replace(/&#(\d+);/g, (_, digits: string) =>
      String.fromCodePoint(Number(digits)),
    )
    .replace(/&amp;/g, "&");
}
