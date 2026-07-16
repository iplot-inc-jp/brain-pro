import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import {
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

describe("splitPdfPages", () => {
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
});

describe("readPptxSlides", () => {
  it("スライド番号順で XML テキストをデコードし、空スライドも保持する", () => {
    const pptx = makePptx({
      "ppt/slides/slide10.xml": "<p:sld><a:t>ten</a:t></p:sld>",
      "ppt/slides/slide3.xml": "<p:sld></p:sld>",
      "ppt/slides/slide2.xml":
        "<p:sld><a:t>A &amp; B &lt;tag&gt;</a:t><a:t>&#65; &#x42; &quot;Q&quot; &apos;P&apos;</a:t></p:sld>",
    });

    const slides = readPptxSlides(pptx);

    expect(slides.map((slide) => slide.pageNumber)).toEqual([2, 3, 10]);
    expect(slides.map((slide) => slide.sourceText)).toEqual([
      `A & B <tag>\nA B "Q" 'P'`,
      "",
      "ten",
    ]);
    expect(slides.map((slide) => slide.images)).toEqual([[], [], []]);
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

  it("壊れた ZIP は明確な解析エラーにする", () => {
    expect(() => readPptxSlides(Buffer.from("not a zip"))).toThrow(
      new DocumentPageParseError("PPTX"),
    );
  });

  it("スライド部品がない PPTX は明確な解析エラーにする", () => {
    const pptx = makePptx({ "[Content_Types].xml": "<Types />" });

    expect(() => readPptxSlides(pptx)).toThrow(
      new DocumentPageParseError("PPTX"),
    );
  });
});
