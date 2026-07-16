import {
  DOMParser,
  type Document as XmlDocument,
  type Element as XmlElement,
} from "@xmldom/xmldom";
import { Inflate, strFromU8 } from "fflate";
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
  | "ZIP_INTEGRITY_ERROR"
  | "INVALID_PROCESSING_LIMITS"
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
  Object.freeze({
    maxInputBytes: 50 * 1024 * 1024,
    maxPdfPages: 500,
    maxPdfPageOutputBytes: 50 * 1024 * 1024,
    maxPdfTotalOutputBytes: 200 * 1024 * 1024,
    maxZipEntries: 5_000,
    maxZipExtractedEntries: 2_500,
    maxZipEntryOutputBytes: 50 * 1024 * 1024,
    maxZipTotalOutputBytes: 200 * 1024 * 1024,
    maxZipCompressionRatio: 200,
  });

function resolveProcessingLimits(
  format: "PDF" | "PPTX",
  overrides: Partial<DocumentPageProcessingLimits>,
): DocumentPageProcessingLimits {
  const limits = { ...DEFAULT_DOCUMENT_PAGE_LIMITS };
  for (const key of Object.keys(DEFAULT_DOCUMENT_PAGE_LIMITS) as Array<
    keyof DocumentPageProcessingLimits
  >) {
    const value = overrides[key];
    if (value === undefined) continue;
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > DEFAULT_DOCUMENT_PAGE_LIMITS[key]
    ) {
      throw new DocumentPageParseError(
        format,
        "INVALID_PROCESSING_LIMITS",
        new RangeError(`Invalid document page limit: ${key}`),
      );
    }
    limits[key] = value;
  }
  return limits;
}

export class DocumentPageParseError extends Error {
  readonly cause?: unknown;

  constructor(
    format: "PDF" | "PPTX",
    readonly code: DocumentPageParseErrorCode = "INVALID_DOCUMENT",
    cause?: unknown,
  ) {
    const detail =
      code === "INVALID_DOCUMENT"
        ? "invalid or corrupt document"
        : code === "ZIP_INTEGRITY_ERROR"
          ? "ZIP archive integrity check failed"
          : code === "INVALID_PROCESSING_LIMITS"
            ? "invalid processing limits"
            : `resource limit exceeded (${code})`;
    super(`Unable to read ${format} pages: ${detail}`);
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
    const limits = resolveProcessingLimits("PDF", limitOverrides);
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
    const limits = resolveProcessingLimits("PPTX", limitOverrides);
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
  const presentationRelationships = files["ppt/_rels/presentation.xml.rels"];
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

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_EOCD_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

interface ZipCentralEntry {
  name: string;
  flags: number;
  compression: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
  dataEnd: number;
  recordEnd: number;
}

interface ZipArchiveDirectory {
  entries: Map<string, ZipCentralEntry>;
}

function readZipUint16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readZipUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function zipIntegrityError(message: string, cause?: unknown): never {
  throw new DocumentPageParseError(
    "PPTX",
    "ZIP_INTEGRITY_ERROR",
    cause ?? new Error(message),
  );
}

function isPlausibleEocdCandidate(
  bytes: Uint8Array,
  eocdOffset: number,
): boolean {
  const diskNumber = readZipUint16(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readZipUint16(bytes, eocdOffset + 6);
  const diskEntryCount = readZipUint16(bytes, eocdOffset + 8);
  const entryCount = readZipUint16(bytes, eocdOffset + 10);
  const centralDirectorySize = readZipUint32(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readZipUint32(bytes, eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    diskEntryCount !== entryCount ||
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize !== eocdOffset
  ) {
    return false;
  }

  let centralOffset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      centralOffset + 46 > eocdOffset ||
      readZipUint32(bytes, centralOffset) !== ZIP_CENTRAL_FILE_SIGNATURE
    ) {
      return false;
    }
    centralOffset +=
      46 +
      readZipUint16(bytes, centralOffset + 28) +
      readZipUint16(bytes, centralOffset + 30) +
      readZipUint16(bytes, centralOffset + 32);
    if (centralOffset > eocdOffset) return false;
  }
  return centralOffset === eocdOffset;
}

function parseZipArchiveDirectory(
  bytes: Uint8Array,
  limits: DocumentPageProcessingLimits,
): ZipArchiveDirectory {
  if (bytes.byteLength < ZIP_EOCD_BYTES) {
    return zipIntegrityError("ZIP EOCD is missing");
  }

  const minimumEocdOffset = Math.max(
    0,
    bytes.byteLength - ZIP_EOCD_BYTES - ZIP_MAX_COMMENT_BYTES,
  );
  let eocdOffset = -1;
  let fallbackEocdOffset = -1;
  for (
    let offset = bytes.byteLength - ZIP_EOCD_BYTES;
    offset >= minimumEocdOffset;
    offset -= 1
  ) {
    const terminatesArchive =
      readZipUint32(bytes, offset) === ZIP_EOCD_SIGNATURE &&
      offset + ZIP_EOCD_BYTES + readZipUint16(bytes, offset + 20) ===
        bytes.byteLength;
    if (terminatesArchive) {
      fallbackEocdOffset = offset;
      if (!isPlausibleEocdCandidate(bytes, offset)) continue;
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0 && fallbackEocdOffset >= 0) {
    eocdOffset = fallbackEocdOffset;
  }
  if (eocdOffset < 0)
    return zipIntegrityError("ZIP EOCD is missing or truncated");

  const diskNumber = readZipUint16(bytes, eocdOffset + 4);
  const centralDirectoryDisk = readZipUint16(bytes, eocdOffset + 6);
  const diskEntryCount = readZipUint16(bytes, eocdOffset + 8);
  const entryCount = readZipUint16(bytes, eocdOffset + 10);
  const centralDirectorySize = readZipUint32(bytes, eocdOffset + 12);
  const centralDirectoryOffset = readZipUint32(bytes, eocdOffset + 16);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    diskEntryCount !== entryCount
  ) {
    return zipIntegrityError("Multi-disk ZIP archives are not supported");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    return zipIntegrityError("ZIP64 archives are not supported");
  }
  if (entryCount > limits.maxZipEntries) {
    throw new DocumentPageParseError("PPTX", "ZIP_ENTRY_COUNT_EXCEEDED");
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    !Number.isSafeInteger(centralDirectoryEnd) ||
    centralDirectoryOffset > eocdOffset ||
    centralDirectoryEnd !== eocdOffset
  ) {
    return zipIntegrityError("ZIP central directory bounds are invalid");
  }

  const entries = new Map<string, ZipCentralEntry>();
  const localHeaderOffsets = new Set<number>();
  let centralOffset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      centralOffset + 46 > centralDirectoryEnd ||
      readZipUint32(bytes, centralOffset) !== ZIP_CENTRAL_FILE_SIGNATURE
    ) {
      return zipIntegrityError("ZIP central directory entry is truncated");
    }
    const flags = readZipUint16(bytes, centralOffset + 8);
    const compression = readZipUint16(bytes, centralOffset + 10);
    const crc32 = readZipUint32(bytes, centralOffset + 16);
    const compressedSize = readZipUint32(bytes, centralOffset + 20);
    const uncompressedSize = readZipUint32(bytes, centralOffset + 24);
    const filenameBytes = readZipUint16(bytes, centralOffset + 28);
    const extraBytes = readZipUint16(bytes, centralOffset + 30);
    const commentBytes = readZipUint16(bytes, centralOffset + 32);
    const startDisk = readZipUint16(bytes, centralOffset + 34);
    const localHeaderOffset = readZipUint32(bytes, centralOffset + 42);
    const centralEntryEnd =
      centralOffset + 46 + filenameBytes + extraBytes + commentBytes;
    if (centralEntryEnd > centralDirectoryEnd) {
      return zipIntegrityError(
        "ZIP central directory entry lengths are invalid",
      );
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      return zipIntegrityError("ZIP64 entries are not supported");
    }
    if (startDisk !== 0) {
      return zipIntegrityError("Multi-disk ZIP entries are not supported");
    }
    if ((flags & 0x0001) !== 0 || (compression !== 0 && compression !== 8)) {
      return zipIntegrityError("Encrypted or unsupported ZIP entry");
    }

    const centralNameBytes = bytes.subarray(
      centralOffset + 46,
      centralOffset + 46 + filenameBytes,
    );
    let name: string;
    try {
      name = strFromU8(centralNameBytes, (flags & 0x0800) === 0);
    } catch (error) {
      return zipIntegrityError("ZIP entry name cannot be decoded", error);
    }
    if (!name || name.includes("\0") || entries.has(name)) {
      return zipIntegrityError("ZIP entry names are empty or duplicated");
    }
    if (localHeaderOffsets.has(localHeaderOffset)) {
      return zipIntegrityError("ZIP entries share a local header offset");
    }
    localHeaderOffsets.add(localHeaderOffset);

    if (
      localHeaderOffset + 30 > centralDirectoryOffset ||
      readZipUint32(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE
    ) {
      return zipIntegrityError(
        "ZIP local header offset or signature is invalid",
      );
    }
    const localFlags = readZipUint16(bytes, localHeaderOffset + 6);
    const localCompression = readZipUint16(bytes, localHeaderOffset + 8);
    const localCrc32 = readZipUint32(bytes, localHeaderOffset + 14);
    const localCompressedSize = readZipUint32(bytes, localHeaderOffset + 18);
    const localUncompressedSize = readZipUint32(bytes, localHeaderOffset + 22);
    const localFilenameBytes = readZipUint16(bytes, localHeaderOffset + 26);
    const localExtraBytes = readZipUint16(bytes, localHeaderOffset + 28);
    const dataOffset =
      localHeaderOffset + 30 + localFilenameBytes + localExtraBytes;
    const dataEnd = dataOffset + compressedSize;
    if (
      localFlags !== flags ||
      localCompression !== compression ||
      localFilenameBytes !== filenameBytes ||
      dataOffset > centralDirectoryOffset ||
      dataEnd > centralDirectoryOffset
    ) {
      return zipIntegrityError("ZIP local and central metadata do not match");
    }
    const localNameBytes = bytes.subarray(
      localHeaderOffset + 30,
      localHeaderOffset + 30 + localFilenameBytes,
    );
    if (
      localNameBytes.length !== centralNameBytes.length ||
      localNameBytes.some(
        (value, nameIndex) => value !== centralNameBytes[nameIndex],
      )
    ) {
      return zipIntegrityError(
        "ZIP local and central entry names do not match",
      );
    }
    const usesDataDescriptor = (flags & 0x0008) !== 0;
    if (
      (!usesDataDescriptor &&
        (localCrc32 !== crc32 ||
          localCompressedSize !== compressedSize ||
          localUncompressedSize !== uncompressedSize)) ||
      (usesDataDescriptor &&
        ((localCrc32 !== 0 && localCrc32 !== crc32) ||
          (localCompressedSize !== 0 &&
            localCompressedSize !== compressedSize) ||
          (localUncompressedSize !== 0 &&
            localUncompressedSize !== uncompressedSize)))
    ) {
      return zipIntegrityError(
        "ZIP local sizes or CRC do not match central metadata",
      );
    }
    let recordEnd = dataEnd;
    if (usesDataDescriptor) {
      const unsignedDescriptorMatches =
        dataEnd + 12 <= centralDirectoryOffset &&
        readZipUint32(bytes, dataEnd) === crc32 &&
        readZipUint32(bytes, dataEnd + 4) === compressedSize &&
        readZipUint32(bytes, dataEnd + 8) === uncompressedSize;
      const signedDescriptorMatches =
        dataEnd + 16 <= centralDirectoryOffset &&
        readZipUint32(bytes, dataEnd) === 0x08074b50 &&
        readZipUint32(bytes, dataEnd + 4) === crc32 &&
        readZipUint32(bytes, dataEnd + 8) === compressedSize &&
        readZipUint32(bytes, dataEnd + 12) === uncompressedSize;
      if (!unsignedDescriptorMatches && !signedDescriptorMatches) {
        return zipIntegrityError(
          "ZIP data descriptor does not match central metadata",
        );
      }
      recordEnd = dataEnd + (unsignedDescriptorMatches ? 12 : 16);
    }

    entries.set(name, {
      name,
      flags,
      compression,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
      dataEnd,
      recordEnd,
    });
    centralOffset = centralEntryEnd;
  }
  if (centralOffset !== centralDirectoryEnd || entries.size !== entryCount) {
    return zipIntegrityError("ZIP central directory count or end is invalid");
  }

  const entriesByOffset = [...entries.values()].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  );
  if (
    (entriesByOffset.length === 0 && centralDirectoryOffset !== 0) ||
    (entriesByOffset.length > 0 && entriesByOffset[0].localHeaderOffset !== 0)
  ) {
    return zipIntegrityError("ZIP local entry sequence start is invalid");
  }
  for (let index = 1; index < entriesByOffset.length; index += 1) {
    if (
      entriesByOffset[index - 1].recordEnd !==
      entriesByOffset[index].localHeaderOffset
    ) {
      return zipIntegrityError("ZIP local entry sequence has a gap or overlap");
    }
  }
  if (
    entriesByOffset.length > 0 &&
    entriesByOffset[entriesByOffset.length - 1].recordEnd !==
      centralDirectoryOffset
  ) {
    return zipIntegrityError("ZIP local entry sequence end is invalid");
  }
  return { entries };
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function updateCrc32(crc: number, bytes: Uint8Array): number {
  let next = crc;
  for (const value of bytes) {
    next = CRC32_TABLE[(next ^ value) & 0xff] ^ (next >>> 8);
  }
  return next >>> 0;
}

function extractPptxParts(
  bytes: Buffer | Uint8Array,
  limits: DocumentPageProcessingLimits,
): Record<string, Uint8Array> {
  const archive = parseZipArchiveDirectory(bytes, limits);
  const files: Record<string, Uint8Array> = Object.create(null);
  const extractedEntries = [...archive.entries.values()].filter((entry) =>
    isAllowedPptxPart(entry.name),
  );
  if (extractedEntries.length > limits.maxZipExtractedEntries) {
    throw new DocumentPageParseError(
      "PPTX",
      "ZIP_EXTRACTED_ENTRY_COUNT_EXCEEDED",
    );
  }
  let totalOutputBytes = 0;

  for (const entry of extractedEntries) {
    validateDeclaredZipBounds(
      {
        originalSize: entry.uncompressedSize,
        size: entry.compressedSize,
        terminate: () => undefined,
      },
      limits,
    );

    const chunks: Uint8Array[] = [];
    let entryOutputBytes = 0;
    let entryCrc32 = 0xffffffff;
    let compressedInputBytes = 0;
    let reachedFinalOutput = false;
    const onOutput = (chunk: Uint8Array, final: boolean): void => {
      entryOutputBytes += chunk.byteLength;
      totalOutputBytes += chunk.byteLength;
      entryCrc32 = updateCrc32(entryCrc32, chunk);
      if (entryOutputBytes > limits.maxZipEntryOutputBytes) {
        throw new DocumentPageParseError("PPTX", "ZIP_ENTRY_BYTES_EXCEEDED");
      }
      if (totalOutputBytes > limits.maxZipTotalOutputBytes) {
        throw new DocumentPageParseError("PPTX", "ZIP_TOTAL_BYTES_EXCEEDED");
      }
      if (
        compressionRatio(entryOutputBytes, entry.compressedSize) >
        limits.maxZipCompressionRatio
      ) {
        throw new DocumentPageParseError(
          "PPTX",
          "ZIP_COMPRESSION_RATIO_EXCEEDED",
        );
      }

      if (chunk.byteLength > 0) chunks.push(chunk);
      if (final) reachedFinalOutput = true;
    };

    try {
      const inputChunkBytes = 64 * 1024;
      if (entry.compression === 0) {
        if (entry.compressedSize === 0) onOutput(new Uint8Array(), true);
        for (
          let offset = entry.dataOffset;
          offset < entry.dataEnd;
          offset += inputChunkBytes
        ) {
          const end = Math.min(offset + inputChunkBytes, entry.dataEnd);
          const chunk = bytes.subarray(offset, end);
          compressedInputBytes += chunk.byteLength;
          onOutput(chunk, end === entry.dataEnd);
        }
      } else {
        const inflate = new Inflate(onOutput);
        for (
          let offset = entry.dataOffset;
          offset < entry.dataEnd;
          offset += inputChunkBytes
        ) {
          const end = Math.min(offset + inputChunkBytes, entry.dataEnd);
          const chunk = bytes.subarray(offset, end);
          compressedInputBytes += chunk.byteLength;
          inflate.push(chunk, end === entry.dataEnd);
        }
      }
    } catch (error) {
      if (error instanceof DocumentPageParseError) throw error;
      return zipIntegrityError("ZIP entry decompression failed", error);
    }

    const actualCrc32 = (entryCrc32 ^ 0xffffffff) >>> 0;
    if (
      !reachedFinalOutput ||
      compressedInputBytes !== entry.compressedSize ||
      entryOutputBytes !== entry.uncompressedSize ||
      actualCrc32 !== entry.crc32
    ) {
      return zipIntegrityError(
        "ZIP entry CRC or size does not match central metadata",
      );
    }
    files[entry.name] = joinChunks(chunks, entryOutputBytes);
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
    throw new DocumentPageParseError("PPTX", "ZIP_COMPRESSION_RATIO_EXCEEDED");
  }
}

function compressionRatio(
  outputBytes: number,
  compressedBytes: number,
): number {
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
        throw new DocumentPageParseError("PPTX", "UNSAFE_RELATIONSHIP_TARGET");
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
  return elementsByNamespaceOrLegacy(document, DRAWINGML_NAMESPACE, "t", "a")
    .map((element) => element.textContent?.trim() ?? "")
    .filter(Boolean);
}

function parseXml(bytes: Uint8Array, partPath: string): XmlDocument {
  const xml = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(
      `DTD and entity declarations are not allowed in ${partPath}`,
    );
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
          (element) => !element.namespaceURI && element.localName === localName,
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
