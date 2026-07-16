import { strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import {
  DEFAULT_DOCUMENT_PAGE_LIMITS,
  DocumentPageParseError,
  readPptxSlides,
  splitPdfPages,
} from "./document-pages";

function makePptx(files: Record<string, string | Uint8Array>): Buffer {
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, contents]) => [
          path,
          typeof contents === "string" ? strToU8(contents) : contents,
        ]),
      ),
    ),
  );
}

function makeStreamingPptx(path: string, contents: string): Buffer {
  return makeStreamingPptxEntries([[path, strToU8(contents)]]);
}

function makeStreamingPptxEntries(
  entries: Array<[path: string, contents: Uint8Array]>,
  level: 0 | 9 = 9,
): Buffer {
  const chunks: Uint8Array[] = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [path, contents] of entries) {
    const file = new ZipDeflate(path, { level });
    zip.add(file);
    file.push(contents, true);
  }
  zip.end();
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

const CENTRAL_DIRECTORY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

function mutateFirstCentralEntry(
  source: Buffer,
  mutate: (archive: Buffer, centralOffset: number) => void,
): Buffer {
  const archive = Buffer.from(source);
  const centralOffset = archive.indexOf(CENTRAL_DIRECTORY_SIGNATURE);
  if (centralOffset < 0) throw new Error("central directory not found");
  mutate(archive, centralOffset);
  return archive;
}

function findCentralEntry(source: Buffer, expectedName: string): number {
  let offset = source.indexOf(CENTRAL_DIRECTORY_SIGNATURE);
  while (offset >= 0) {
    const filenameBytes = source.readUInt16LE(offset + 28);
    const extraBytes = source.readUInt16LE(offset + 30);
    const commentBytes = source.readUInt16LE(offset + 32);
    const name = source
      .subarray(offset + 46, offset + 46 + filenameBytes)
      .toString();
    if (name === expectedName) return offset;
    offset += 46 + filenameBytes + extraBytes + commentBytes;
    if (
      !source.subarray(offset, offset + 4).equals(CENTRAL_DIRECTORY_SIGNATURE)
    ) {
      break;
    }
  }
  throw new Error(`central entry not found: ${expectedName}`);
}

function compressedDataRange(
  source: Buffer,
  centralOffset: number,
): { dataOffset: number; dataEnd: number } {
  const localOffset = source.readUInt32LE(centralOffset + 42);
  const dataOffset =
    localOffset +
    30 +
    source.readUInt16LE(localOffset + 26) +
    source.readUInt16LE(localOffset + 28);
  return {
    dataOffset,
    dataEnd: dataOffset + source.readUInt32LE(centralOffset + 20),
  };
}

function expectPptxIntegrityError(bytes: Uint8Array): void {
  expect(() => readPptxSlides(bytes)).toThrow(
    expect.objectContaining({
      name: "DocumentPageParseError",
      code: "ZIP_INTEGRITY_ERROR",
      cause: expect.anything(),
    }),
  );
}

describe("splitPdfPages", () => {
  it("本番上限を runtime でも固定する", () => {
    expect(Object.isFrozen(DEFAULT_DOCUMENT_PAGE_LIMITS)).toBe(true);
  });

  it("PDF を元の順序どおり独立した 1 ページ PDF に分割する", async () => {
    const source = await PDFDocument.create();
    source.addPage([200, 300]);
    source.addPage([400, 500]);

    const pages = await splitPdfPages(await source.save());

    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    const first = await PDFDocument.load(pages[0].bytes);
    const second = await PDFDocument.load(pages[1].bytes);
    expect(first.getPageCount()).toBe(1);
    expect(second.getPageCount()).toBe(1);
    expect(first.getPage(0).getSize()).toEqual({ width: 200, height: 300 });
    expect(second.getPage(0).getSize()).toEqual({ width: 400, height: 500 });
  });

  it("壊れた PDF は明確な解析エラーにする", async () => {
    await expect(splitPdfPages(Buffer.from("not a pdf"))).rejects.toEqual(
      new DocumentPageParseError("PDF"),
    );
  });

  it("ページ数上限を超える PDF をリソース制限エラーにする", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    source.addPage();
    const splitWithLimits = splitPdfPages as (
      bytes: Uint8Array,
      limits: { maxPdfPages: number },
    ) => ReturnType<typeof splitPdfPages>;

    await expect(
      splitWithLimits(await source.save(), { maxPdfPages: 1 }),
    ).rejects.toMatchObject({
      name: "DocumentPageParseError",
      code: "PDF_PAGE_COUNT_EXCEEDED",
    });
  });

  it("分割後 PDF の合計出力上限を超えたら中断する", async () => {
    const source = await PDFDocument.create();
    source.addPage();
    source.addPage();
    const splitWithLimits = splitPdfPages as (
      bytes: Uint8Array,
      limits: { maxPdfTotalOutputBytes: number },
    ) => ReturnType<typeof splitPdfPages>;

    await expect(
      splitWithLimits(await source.save(), { maxPdfTotalOutputBytes: 1 }),
    ).rejects.toMatchObject({
      name: "DocumentPageParseError",
      code: "PDF_TOTAL_OUTPUT_BYTES_EXCEEDED",
    });
  });

  it.each([
    ["入力", { maxInputBytes: 1 }, "INPUT_BYTES_EXCEEDED"],
    ["1ページ出力", { maxPdfPageOutputBytes: 1 }, "PDF_PAGE_BYTES_EXCEEDED"],
  ])("PDF の%s上限を強制する", async (_, limits, code) => {
    const source = await PDFDocument.create();
    source.addPage();
    const splitWithLimits = splitPdfPages as (
      bytes: Uint8Array,
      limits: Record<string, number>,
    ) => ReturnType<typeof splitPdfPages>;

    await expect(
      splitWithLimits(await source.save(), limits),
    ).rejects.toMatchObject({
      name: "DocumentPageParseError",
      code,
    });
  });
});

describe("readPptxSlides", () => {
  const integrityFixture = () =>
    makePptx({
      "ppt/slides/slide1.xml": "<p:sld><a:t>integrity</a:t></p:sld>",
    });

  it("スライド番号順で XML テキストをデコードし、空スライドも保持する", () => {
    const pptx = makePptx({
      "ppt/slides/slide10.xml": "<p:sld><a:t>ten</a:t></p:sld>",
      "ppt/slides/slide3.xml": "<p:sld></p:sld>",
      "ppt/slides/slide2.xml":
        "<p:sld><a:t>A &amp; B &lt;tag&gt;</a:t><a:t>&#65; &#x42; &quot;Q&quot; &apos;P&apos;</a:t></p:sld>",
    });

    const slides = readPptxSlides(pptx);

    expect(slides.map((slide) => slide.pageNumber)).toEqual([1, 2, 3]);
    expect(slides.map((slide) => slide.sourcePartNumber)).toEqual([2, 3, 10]);
    expect(slides.map((slide) => slide.sourceText)).toEqual([
      `A & B <tag>\nA B "Q" 'P'`,
      "",
      "ten",
    ]);
    expect(slides.map((slide) => slide.images)).toEqual([[], [], []]);
  });

  it("presentation.xml のスライド一覧を正規順序として使う", () => {
    const pptx = makePptx({
      "ppt/presentation.xml": `
        <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <p:sldIdLst>
            <p:sldId id="256" r:id="rIdTen" />
            <p:sldId id="257" r:id="rIdTwo" />
          </p:sldIdLst>
        </p:presentation>`,
      "ppt/_rels/presentation.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rIdTwo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml" />
          <Relationship Id="rIdTen" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide10.xml" />
        </Relationships>`,
      "ppt/slides/slide2.xml": "<p:sld><a:t>two</a:t></p:sld>",
      "ppt/slides/slide10.xml": "<p:sld><a:t>ten</a:t></p:sld>",
    });

    const slides = readPptxSlides(pptx);

    expect(slides.map((slide) => slide.pageNumber)).toEqual([1, 2]);
    expect(slides.map((slide) => slide.sourceText)).toEqual(["ten", "two"]);
    expect(slides.map((slide) => slide.sourcePartNumber)).toEqual([10, 2]);
  });

  it("名前空間 URI で代替接頭辞と CDATA のテキストを抽出する", () => {
    const pptx = makePptx({
      "ppt/slides/slide1.xml": `
        <x:sld xmlns:x="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:d="http://schemas.openxmlformats.org/drawingml/2006/main">
          <d:t><![CDATA[A < B & C]]></d:t>
        </x:sld>`,
    });

    expect(readPptxSlides(pptx)[0].sourceText).toBe("A < B & C");
  });

  it("不正なスライド XML を解析エラーにして原因を保持する", () => {
    const pptx = makePptx({
      "ppt/slides/slide1.xml": `
        <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
          xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:t>broken</p:sld>`,
    });

    expect(() => readPptxSlides(pptx)).toThrow(
      expect.objectContaining({
        name: "DocumentPageParseError",
        code: "INVALID_DOCUMENT",
        cause: expect.anything(),
      }),
    );
  });

  it("各スライド自身の画像リレーションだけを解決し、外部・欠損・非画像を無視する", () => {
    const pptx = makePptx({
      "ppt/slides/slide2.xml": "<p:sld><a:t>two</a:t></p:sld>",
      "ppt/slides/_rels/slide2.xml.rels": `
        <Relationships>
          <Relationship Id="rIdPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/two.PNG" />
          <Relationship Id="rIdGif" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/two.gif" />
          <Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/external.png" TargetMode="External" />
          <Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/missing.webp" />
          <Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml" />
        </Relationships>`,
      "ppt/slides/slide10.xml": "<p:sld><a:t>ten</a:t></p:sld>",
      "ppt/slides/_rels/slide10.xml.rels": `
        <Relationships>
          <Relationship Id="rIdJpeg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ten.jpeg" />
          <Relationship Id="rIdWebp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/ten.webp" />
        </Relationships>`,
      "ppt/media/two.PNG": new Uint8Array([1, 2]),
      "ppt/media/two.gif": new Uint8Array([3, 4]),
      "ppt/media/ten.jpeg": new Uint8Array([5, 6]),
      "ppt/media/ten.webp": new Uint8Array([7, 8]),
      "ppt/charts/chart1.xml": "<chart />",
    });

    const slides = readPptxSlides(pptx);

    expect(slides[0].images.map((image) => image.mimeType)).toEqual([
      "image/png",
      "image/gif",
    ]);
    expect(slides[0].images.map((image) => Array.from(image.bytes))).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(slides[1].images.map((image) => image.mimeType)).toEqual([
      "image/jpeg",
      "image/webp",
    ]);
    expect(slides[1].images.map((image) => Array.from(image.bytes))).toEqual([
      [5, 6],
      [7, 8],
    ]);
  });

  it.each([
    "../../../../ppt/media/secret.png",
    "%2e%2e/%2e%2e/%2e%2e/ppt/media/secret.png",
  ])("パッケージルートを越える画像 Target %s を拒否する", (target) => {
    const pptx = makePptx({
      "ppt/slides/slide1.xml": "<p:sld />",
      "ppt/slides/_rels/slide1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}" />
        </Relationships>`,
      "ppt/media/secret.png": new Uint8Array([1]),
    });

    expect(() => readPptxSlides(pptx)).toThrow(
      expect.objectContaining({ code: "UNSAFE_RELATIONSHIP_TARGET" }),
    );
  });

  it("パッケージ絶対パスの内部画像 Target を解決する", () => {
    const pptx = makePptx({
      "ppt/slides/slide1.xml": "<p:sld />",
      "ppt/slides/_rels/slide1.xml.rels": `
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="/ppt/media/absolute.png" />
        </Relationships>`,
      "ppt/media/absolute.png": new Uint8Array([9]),
    });

    expect(readPptxSlides(pptx)[0].images[0]).toMatchObject({
      mimeType: "image/png",
      bytes: new Uint8Array([9]),
    });
  });

  it("壊れた ZIP は整合性コード付き解析エラーにする", () => {
    expectPptxIntegrityError(Buffer.from("not a zip"));
  });

  it("スライド部品がない PPTX は明確な解析エラーにする", () => {
    const pptx = makePptx({ "[Content_Types].xml": "<Types />" });

    expect(() => readPptxSlides(pptx)).toThrow(
      new DocumentPageParseError("PPTX"),
    );
  });

  it.each([
    [
      "ZIP 全エントリ数",
      makePptx({
        "ppt/slides/slide1.xml": "<p:sld />",
        "ignored/1": "x",
        "ignored/2": "x",
      }),
      { maxZipEntries: 2 },
      "ZIP_ENTRY_COUNT_EXCEEDED",
    ],
    [
      "展開対象エントリ数",
      makePptx({
        "ppt/slides/slide1.xml": "<p:sld />",
        "ppt/slides/slide2.xml": "<p:sld />",
      }),
      { maxZipExtractedEntries: 1 },
      "ZIP_EXTRACTED_ENTRY_COUNT_EXCEEDED",
    ],
    [
      "単一エントリ出力",
      makePptx({
        "ppt/slides/slide1.xml": `<p:sld><a:t>${"x".repeat(512)}</a:t></p:sld>`,
      }),
      { maxZipEntryOutputBytes: 100 },
      "ZIP_ENTRY_BYTES_EXCEEDED",
    ],
    [
      "合計展開出力",
      makePptx({
        "ppt/slides/slide1.xml": `<p:sld><a:t>${"x".repeat(80)}</a:t></p:sld>`,
        "ppt/slides/slide2.xml": `<p:sld><a:t>${"y".repeat(80)}</a:t></p:sld>`,
      }),
      { maxZipTotalOutputBytes: 150 },
      "ZIP_TOTAL_BYTES_EXCEEDED",
    ],
    [
      "圧縮率",
      makePptx({
        "ppt/slides/slide1.xml": `<p:sld><a:t>${"z".repeat(10_000)}</a:t></p:sld>`,
      }),
      { maxZipCompressionRatio: 2 },
      "ZIP_COMPRESSION_RATIO_EXCEEDED",
    ],
  ])("%sの安全上限を強制する", (_, pptx, limits, code) => {
    const readWithLimits = readPptxSlides as (
      bytes: Uint8Array,
      limits: Record<string, number>,
    ) => ReturnType<typeof readPptxSlides>;

    expect(() => readWithLimits(pptx, limits)).toThrow(
      expect.objectContaining({ name: "DocumentPageParseError", code }),
    );
  });

  it("data descriptor 形式でも実測圧縮率上限を強制する", () => {
    const pptx = makeStreamingPptx(
      "ppt/slides/slide1.xml",
      `<p:sld><a:t>${"z".repeat(10_000)}</a:t></p:sld>`,
    );

    expect(() => readPptxSlides(pptx, { maxZipCompressionRatio: 2 })).toThrow(
      expect.objectContaining({ code: "ZIP_COMPRESSION_RATIO_EXCEEDED" }),
    );
  });

  it("DEFLATE payload 内の data descriptor signature を境界扱いしない", () => {
    const marker = Buffer.from([0x50, 0x4b, 0x07, 0x08]);
    const pptx = makeStreamingPptxEntries(
      [
        [
          "ppt/media/marker.png",
          Buffer.concat([Buffer.from([1, 2]), marker, Buffer.from([3, 4])]),
        ],
        [
          "ppt/slides/slide1.xml",
          strToU8("<p:sld><a:t>exact range</a:t></p:sld>"),
        ],
      ],
      0,
    );
    const markerCentralOffset = findCentralEntry(pptx, "ppt/media/marker.png");
    const { dataOffset, dataEnd } = compressedDataRange(
      pptx,
      markerCentralOffset,
    );
    expect(pptx.subarray(dataOffset, dataEnd).includes(marker)).toBe(true);

    expect(readPptxSlides(pptx)[0].sourceText).toBe("exact range");
  });

  it("CRC が signature と同値の署名なし data descriptor を受理する", () => {
    const mediaPath = "ppt/media/crc.png";
    const archive = makeStreamingPptxEntries(
      [
        [
          "ppt/slides/slide1.xml",
          strToU8("<p:sld><a:t>unsigned descriptor</a:t></p:sld>"),
        ],
        [mediaPath, new Uint8Array([172, 10, 122, 213])],
      ],
      0,
    );
    const mediaCentralOffset = findCentralEntry(archive, mediaPath);
    expect(archive.readUInt32LE(mediaCentralOffset + 16)).toBe(0x08074b50);
    const { dataEnd: descriptorOffset } = compressedDataRange(
      archive,
      mediaCentralOffset,
    );
    expect(archive.readUInt32LE(descriptorOffset)).toBe(0x08074b50);

    const pptx = Buffer.concat([
      archive.subarray(0, descriptorOffset),
      archive.subarray(descriptorOffset + 4),
    ]);
    const eocdOffset = pptx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    pptx.writeUInt32LE(pptx.readUInt32LE(eocdOffset + 16) - 4, eocdOffset + 16);

    expect(readPptxSlides(pptx)[0].sourceText).toBe("unsigned descriptor");
  });

  it("ZIP64 sentinel を安定した整合性コードで拒否する", () => {
    const pptx = integrityFixture();
    const eocdOffset = pptx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    pptx.writeUInt16LE(0xffff, eocdOffset + 8);
    pptx.writeUInt16LE(0xffff, eocdOffset + 10);

    expectPptxIntegrityError(pptx);
  });

  it("中央ディレクトリと EOCD がない ZIP を拒否する", () => {
    const pptx = integrityFixture();
    const centralOffset = pptx.indexOf(CENTRAL_DIRECTORY_SIGNATURE);

    expectPptxIntegrityError(pptx.subarray(0, centralOffset));
  });

  it("EOCD が途中で切れた ZIP を拒否する", () => {
    const pptx = integrityFixture();

    expectPptxIntegrityError(pptx.subarray(0, pptx.byteLength - 1));
  });

  it("ZIP comment 内の偽 EOCD を飛ばして正規 EOCD を使う", () => {
    const archive = makePptx({
      "ppt/slides/slide1.xml": "<p:sld><a:t>real eocd</a:t></p:sld>",
    });
    const comment = Buffer.concat([
      Buffer.from("comment!"),
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.alloc(18),
    ]);
    archive.writeUInt16LE(comment.byteLength, archive.byteLength - 2);
    const pptx = Buffer.concat([archive, comment]);

    expect(readPptxSlides(pptx)[0].sourceText).toBe("real eocd");
  });

  it("data descriptor の CRC 不一致を拒否する", () => {
    const pptx = makeStreamingPptx(
      "ppt/slides/slide1.xml",
      "<p:sld><a:t>descriptor</a:t></p:sld>",
    );
    const mutated = mutateFirstCentralEntry(pptx, (archive, centralOffset) => {
      const localOffset = archive.readUInt32LE(centralOffset + 42);
      const dataOffset =
        localOffset +
        30 +
        archive.readUInt16LE(localOffset + 26) +
        archive.readUInt16LE(localOffset + 28);
      const descriptorOffset =
        dataOffset + archive.readUInt32LE(centralOffset + 20);
      const crcOffset =
        archive.readUInt32LE(descriptorOffset) === 0x08074b50
          ? descriptorOffset + 4
          : descriptorOffset;
      archive.writeUInt32LE(
        (archive.readUInt32LE(crcOffset) + 1) >>> 0,
        crcOffset,
      );
    });

    expectPptxIntegrityError(mutated);
  });

  it.each([
    [
      "選択 entry の圧縮データ",
      (archive: Buffer, centralOffset: number) => {
        const localOffset = archive.readUInt32LE(centralOffset + 42);
        const dataOffset =
          localOffset +
          30 +
          archive.readUInt16LE(localOffset + 26) +
          archive.readUInt16LE(localOffset + 28);
        archive[dataOffset] ^= 0x01;
      },
    ],
    [
      "中央 CRC32",
      (archive: Buffer, centralOffset: number) => {
        archive.writeUInt32LE(
          (archive.readUInt32LE(centralOffset + 16) + 1) >>> 0,
          centralOffset + 16,
        );
      },
    ],
    [
      "中央展開サイズ",
      (archive: Buffer, centralOffset: number) => {
        archive.writeUInt32LE(
          archive.readUInt32LE(centralOffset + 24) + 1,
          centralOffset + 24,
        );
      },
    ],
    [
      "中央 entry 名",
      (archive: Buffer, centralOffset: number) => {
        archive[centralOffset + 46] ^= 0x01;
      },
    ],
    [
      "local header offset",
      (archive: Buffer, centralOffset: number) => {
        archive.writeUInt32LE(
          archive.readUInt32LE(centralOffset + 42) + 1,
          centralOffset + 42,
        );
      },
    ],
  ])("%s の不一致を整合性エラーにする", (_, mutate) => {
    expectPptxIntegrityError(
      mutateFirstCentralEntry(integrityFixture(), mutate),
    );
  });

  it.each([
    ["zero", { maxZipEntries: 0 }],
    ["fraction", { maxZipEntries: 1.5 }],
    ["NaN", { maxZipEntries: Number.NaN }],
    ["Infinity", { maxZipEntries: Number.POSITIVE_INFINITY }],
    ["hard maximum 超過", { maxZipEntries: 5_001 }],
  ])("不正な limit override (%s) を拒否する", (_, limits) => {
    expect(() => readPptxSlides(integrityFixture(), limits)).toThrow(
      expect.objectContaining({ code: "INVALID_PROCESSING_LIMITS" }),
    );
  });
});
