import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import {
  type AsyncFlateStreamHandler,
  strFromU8,
  Unzip,
  UnzipInflate,
} from "fflate";
import { PDFDocument } from "pdf-lib";

export type DocumentPageParseErrorCode =
  | "INVALID_DOCUMENT"
  | "INPUT_BYTES_EXCEEDED"
  | "PDF_PAGE_COUNT_EXCEEDED"
  | "PDF_PAGE_BYTES_EXCEEDED"
  | "PDF_TOTAL_OUTPUT_BYTES_EXCEEDED"
  | "ZIP_ENTRY_COUNT_EXCEEDED"
  | "ZIP_EXTRACTED_ENTRY_COUNT_EXCEEDED"
  | "ZIP_ENTRY_BYTES_EXCEEDED"
  | "ZIP_TOTAL_BYTES_EXCEEDED"
  | "ZIP_COMPRESSION_RATIO_EXCEEDED"
  | "UNSAFE_RELATIONSHIP_TARGET";

const PRESENTATIONML_NAMESPACE =
  "http://schemas.openxmlformats.org/presentationml/2006/main";
const DRAWINGML_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
const OFFICE_RELATIONSHIP_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIP_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";

export interface DocumentPageProcessingLimits {
  maxInputBytes: number;
  maxPdfPages: number;
  maxPdfPageOutputBytes: number;
  maxPdfTotalOutputBytes: number;
  maxZipEntries: number;
  maxZipExtractedEntries: number;
  maxZipEntryOutputBytes: number;
  maxZipTotalOutputBytes: number;
  maxZipCompressionRatio: number;
}

export const DEFAULT_DOCUMENT_PAGE_LIMITS: Readonly<DocumentPageProcessingLimits> =
  {
    maxInputBytes: 50 * 1024 * 1024,
    maxPdfPages: 500,
    maxPdfPageOutputBytes: 50 * 1024 * 1024,
    maxPdfTotalOutputBytes: 200 * 1024 * 1024,
    maxZipEntries: 5_000,
    maxZipExtractedEntries: 2_500,
    maxZipEntryOutputBytes: 50 * 1024 * 1024,
    maxZipTotalOutputBytes: 200 * 1024 * 1024,
    maxZipCompressionRatio: 200,
  };

export class DocumentPageParseError extends Error {
  readonly cause?: unknown;

  constructor(
    format: "PDF" | "PPTX",
    readonly code: DocumentPageParseErrorCode = "INVALID_DOCUMENT",
    cause?: unknown,
  ) {
    super(
      code === "INVALID_DOCUMENT"
        ? `Unable to read ${format} pages: invalid or corrupt document`
        : `Unable to read ${format} pages: resource limit exceeded (${code})`,
    );
    this.name = "DocumentPageParseError";
    this.cause = cause;
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
  sourcePartNumber: number;
  sourcePath: string;
  sourceText: string;
  images: PptxSlideImage[];
}

export async function splitPdfPages(
  bytes: Buffer | Uint8Array,
  limitOverrides: Partial<DocumentPageProcessingLimits> = {},
): Promise<PdfPage[]> {
  try {
    const limits = { ...DEFAULT_DOCUMENT_PAGE_LIMITS, ...limitOverrides };
    if (bytes.byteLength > limits.maxInputBytes) {
      throw new DocumentPageParseError("PDF", "INPUT_BYTES_EXCEEDED");
    }
    const source = await PDFDocument.load(bytes);
    if (source.getPageCount() > limits.maxPdfPages) {
      throw new DocumentPageParseError("PDF", "PDF_PAGE_COUNT_EXCEEDED");
    }

    const pages: PdfPage[] = [];
    let totalOutputBytes = 0;
    for (const pageIndex of source.getPageIndices()) {
      const document = await PDFDocument.create();
      const [page] = await document.copyPages(source, [pageIndex]);
      document.addPage(page);
      const pageBytes = await document.save();
      if (pageBytes.byteLength > limits.maxPdfPageOutputBytes) {
        throw new DocumentPageParseError("PDF", "PDF_PAGE_BYTES_EXCEEDED");
      }
      totalOutputBytes += pageBytes.byteLength;
      if (totalOutputBytes > limits.maxPdfTotalOutputBytes) {
        throw new DocumentPageParseError(
          "PDF",
          "PDF_TOTAL_OUTPUT_BYTES_EXCEEDED",
        );
      }
      pages.push({ pageNumber: pageIndex + 1, bytes: pageBytes });
    }
    return pages;
  } catch (error) {
    if (error instanceof DocumentPageParseError) throw error;
    throw new DocumentPageParseError("PDF", "INVALID_DOCUMENT", error);
  }
}

export function readPptxSlides(
  bytes: Buffer | Uint8Array,
  limitOverrides: Partial<DocumentPageProcessingLimits> = {},
): PptxSlide[] {
  try {
    const limits = { ...DEFAULT_DOCUMENT_PAGE_LIMITS, ...limitOverrides };
    if (bytes.byteLength > limits.maxInputBytes) {
      throw new DocumentPageParseError("PPTX", "INPUT_BYTES_EXCEEDED");
    }
    const files = extractPptxParts(bytes, limits);
    const slidePaths = orderedSlidePaths(files);
    if (slidePaths.length === 0) {
      throw new DocumentPageParseError("PPTX");
    }

    return slidePaths.map((path, index) => ({
      pageNumber: index + 1,
      sourcePartNumber: slideNumber(path),
      sourcePath: path,
      sourceText: extractRunTexts(files[path], path).join("\n"),
      images: readSlideImages(path, files),
    }));
  } catch (error) {
    if (error instanceof DocumentPageParseError) throw error;
    throw new DocumentPageParseError("PPTX", "INVALID_DOCUMENT", error);
  }
}

function orderedSlidePaths(files: Record<string, Uint8Array>): string[] {
  const fallbackPaths = Object.keys(files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  const presentation = files["ppt/presentation.xml"];
  const presentationRelationships =
    files["ppt/_rels/presentation.xml.rels"];
  if (!presentation && !presentationRelationships) return fallbackPaths;
  if (!presentation || !presentationRelationships) {
    throw new Error("PPTX presentation relationship parts are incomplete");
  }

  const document = parseXml(presentation, "ppt/presentation.xml");
  const relationships = parseRelationships(
    presentationRelationships,
    "ppt/_rels/presentation.xml.rels",
  );
  return elementsByNamespaceOrLegacy(
    document,
    PRESENTATIONML_NAMESPACE,
    "sldId",
    "p",
  ).map((slideId) => {
    const relationshipId =
      slideId.getAttributeNS(OFFICE_RELATIONSHIP_NAMESPACE, "id") ||
      slideId.getAttribute("r:id");
    const relationship = relationshipId
      ? relationships.get(relationshipId)
      : undefined;
    if (
      !relationship ||
      relationship.targetMode?.toLowerCase() === "external" ||
      !relationship.type.endsWith("/slide")
    ) {
      throw new Error("PPTX slide relationship is missing or invalid");
    }
    const path = resolvePartPath("ppt", relationship.target);
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(path) || !files[path]) {
      throw new Error("PPTX slide relationship target is missing or invalid");
    }
    return path;
  });
}

function extractPptxParts(
  bytes: Buffer | Uint8Array,
  limits: DocumentPageProcessingLimits,
): Record<string, Uint8Array> {
  interface CompressionState {
    compressedBytes: number;
  }

  const files: Record<string, Uint8Array> = Object.create(null);
  const pendingCompressionStates = new Map<string, CompressionState[]>();
  let zipEntryCount = 0;
  let extractedEntryCount = 0;
  let totalOutputBytes = 0;

  class CountingUnzipInflate {
    static readonly compression = UnzipInflate.compression;
    ondata: AsyncFlateStreamHandler = () => undefined;
    private readonly decoder = new UnzipInflate();
    private readonly state: CompressionState;

    constructor(filename: string) {
      const states = pendingCompressionStates.get(filename);
      const state = states?.shift();
      if (!state) throw new Error("Missing ZIP compression state");
      if (states?.length === 0) pendingCompressionStates.delete(filename);
      this.state = state;
      this.decoder.ondata = (error, chunk, final) => {
        this.ondata(error, chunk, final);
      };
    }

    push(chunk: Uint8Array, final: boolean): void {
      this.state.compressedBytes += chunk.byteLength;
      this.decoder.push(chunk, final);
    }
  }

  const unzip = new Unzip((file) => {
    zipEntryCount += 1;
    if (zipEntryCount > limits.maxZipEntries) {
      file.terminate();
      throw new DocumentPageParseError("PPTX", "ZIP_ENTRY_COUNT_EXCEEDED");
    }
    if (!isAllowedPptxPart(file.name)) {
      file.terminate();
      return;
    }

    extractedEntryCount += 1;
    if (extractedEntryCount > limits.maxZipExtractedEntries) {
      file.terminate();
      throw new DocumentPageParseError(
        "PPTX",
        "ZIP_EXTRACTED_ENTRY_COUNT_EXCEEDED",
      );
    }
    validateDeclaredZipBounds(file, limits);

    const compressionState: CompressionState = { compressedBytes: 0 };
    if (file.compression === UnzipInflate.compression) {
      const states = pendingCompressionStates.get(file.name) ?? [];
      states.push(compressionState);
      pendingCompressionStates.set(file.name, states);
    }
    const chunks: Uint8Array[] = [];
    let entryOutputBytes = 0;
    file.ondata = (error, chunk, final) => {
      if (error) {
        if (error instanceof DocumentPageParseError) throw error;
        throw new DocumentPageParseError("PPTX", "INVALID_DOCUMENT", error);
      }

      entryOutputBytes += chunk.byteLength;
      totalOutputBytes += chunk.byteLength;
      if (entryOutputBytes > limits.maxZipEntryOutputBytes) {
        throw new DocumentPageParseError("PPTX", "ZIP_ENTRY_BYTES_EXCEEDED");
      }
      if (totalOutputBytes > limits.maxZipTotalOutputBytes) {
        throw new DocumentPageParseError("PPTX", "ZIP_TOTAL_BYTES_EXCEEDED");
      }
      const compressedBytes =
        file.size ??
        (final
          ? file.compression === 0
            ? entryOutputBytes
            : compressionState.compressedBytes
          : undefined);
      if (
        compressedBytes !== undefined &&
        compressionRatio(entryOutputBytes, compressedBytes) >
          limits.maxZipCompressionRatio
      ) {
        throw new DocumentPageParseError(
          "PPTX",
          "ZIP_COMPRESSION_RATIO_EXCEEDED",
        );
      }

      if (chunk.byteLength > 0) chunks.push(chunk);
      if (final) files[file.name] = joinChunks(chunks, entryOutputBytes);
    };
    file.start();
  });
  unzip.register(CountingUnzipInflate);

  const inputChunkBytes = 64 * 1024;
  for (let offset = 0; offset < bytes.byteLength; offset += inputChunkBytes) {
    const end = Math.min(offset + inputChunkBytes, bytes.byteLength);
    unzip.push(bytes.subarray(offset, end), end === bytes.byteLength);
  }
  return files;
}

function isAllowedPptxPart(path: string): boolean {
  return (
    path === "ppt/presentation.xml" ||
    path === "ppt/_rels/presentation.xml.rels" ||
    /^ppt\/slides\/slide\d+\.xml$/.test(path) ||
    /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/.test(path) ||
    /^ppt\/media\/[^/]+$/.test(path)
  );
}

function validateDeclaredZipBounds(
  file: { originalSize?: number; size?: number; terminate: () => void },
  limits: DocumentPageProcessingLimits,
): void {
  if (
    file.originalSize !== undefined &&
    file.originalSize > limits.maxZipEntryOutputBytes
  ) {
    file.terminate();
    throw new DocumentPageParseError("PPTX", "ZIP_ENTRY_BYTES_EXCEEDED");
  }
  if (
    file.originalSize !== undefined &&
    file.size !== undefined &&
    compressionRatio(file.originalSize, file.size) >
      limits.maxZipCompressionRatio
  ) {
    file.terminate();
    throw new DocumentPageParseError(
      "PPTX",
      "ZIP_COMPRESSION_RATIO_EXCEEDED",
    );
  }
}

function compressionRatio(outputBytes: number, compressedBytes: number): number {
  if (outputBytes === 0) return 0;
  return outputBytes / Math.max(compressedBytes, 1);
}

function joinChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
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
  for (const relationship of parseRelationships(
    relationships,
    `${directory}/_rels/${filename}.rels`,
  ).values()) {
    if (
      relationship.targetMode?.toLowerCase() === "external" ||
      !relationship.type.endsWith("/image")
    ) {
      continue;
    }

    const mediaPath = resolvePartPath(directory, relationship.target);
    const mimeType = imageMimeType(mediaPath);
    const media = files[mediaPath];
    if (!mediaPath.startsWith("ppt/media/") || !mimeType || !media) continue;

    images.push({ bytes: media, mimeType });
  }
  return images;
}

interface PptxRelationship {
  type: string;
  target: string;
  targetMode: string | null;
}

function parseRelationships(
  bytes: Uint8Array,
  partPath: string,
): Map<string, PptxRelationship> {
  const document = parseXml(bytes, partPath);
  const relationships = new Map<string, PptxRelationship>();
  for (const element of elementsByNamespaceOrLegacy(
    document,
    PACKAGE_RELATIONSHIP_NAMESPACE,
    "Relationship",
  )) {
    const id = element.getAttribute("Id");
    const type = element.getAttribute("Type");
    const target = element.getAttribute("Target");
    if (!id || !type || !target) {
      throw new Error(`Malformed OOXML relationship in ${partPath}`);
    }
    relationships.set(id, {
      type,
      target,
      targetMode: element.getAttribute("TargetMode"),
    });
  }
  return relationships;
}

function resolvePartPath(directory: string, target: string): string {
  let decodedTarget: string;
  try {
    decodedTarget = decodeURIComponent(target);
  } catch (error) {
    throw new DocumentPageParseError(
      "PPTX",
      "UNSAFE_RELATIONSHIP_TARGET",
      error,
    );
  }
  if (decodedTarget.includes("\\") || decodedTarget.includes("\0")) {
    throw new DocumentPageParseError("PPTX", "UNSAFE_RELATIONSHIP_TARGET");
  }
  const parts = decodedTarget.startsWith("/")
    ? decodedTarget.replace(/^\/+/, "").split("/")
    : [...directory.split("/"), ...decodedTarget.split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (resolved.length === 0) {
        throw new DocumentPageParseError(
          "PPTX",
          "UNSAFE_RELATIONSHIP_TARGET",
        );
      }
      resolved.pop();
      continue;
    }
    resolved.push(part);
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

function extractRunTexts(bytes: Uint8Array, partPath: string): string[] {
  const document = parseXml(bytes, partPath);
  return elementsByNamespaceOrLegacy(
    document,
    DRAWINGML_NAMESPACE,
    "t",
    "a",
  )
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean);
}

function parseXml(bytes: Uint8Array, partPath: string): XmlDocument {
  const xml = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(`DTD and entity declarations are not allowed in ${partPath}`);
  }
  const errors: string[] = [];
  const document = new DOMParser({
    xmlns: {
      a: DRAWINGML_NAMESPACE,
      p: PRESENTATIONML_NAMESPACE,
      r: OFFICE_RELATIONSHIP_NAMESPACE,
    },
    onError: (_level, message) => {
      errors.push(message);
    },
  }).parseFromString(xml, "application/xml");
  if (errors.length > 0 || !document.documentElement) {
    throw new Error(`Malformed XML in ${partPath}: ${String(errors[0] ?? "")}`);
  }
  return document;
}

function elementsByNamespaceOrLegacy(
  document: XmlDocument,
  namespace: string,
  localName: string,
  legacyPrefix?: string,
): XmlElement[] {
  const elements = Array.from(
    document.getElementsByTagNameNS(namespace, localName),
  );
  if (!legacyPrefix) {
    elements.push(
      ...Array.from(document.getElementsByTagName("*"))
        .filter(
          (element) =>
            !element.namespaceURI && element.localName === localName,
        )
        .filter((element) => !elements.includes(element)),
    );
    return elements;
  }
  elements.push(
    ...Array.from(document.getElementsByTagName("*"))
      .filter(
        (element) =>
          !element.namespaceURI &&
          element.localName === localName &&
          element.prefix === legacyPrefix,
      )
      .filter((element) => !elements.includes(element)),
  );
  return elements;
}
