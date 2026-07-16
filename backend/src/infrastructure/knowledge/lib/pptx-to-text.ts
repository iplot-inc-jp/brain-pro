import { readPptxSlides } from "./document-pages";

/**
 * pptx（Office Open XML presentation。Google スライドの Drive export 形式）から
 * スライド本文テキストを抽出する純関数。
 *
 * 失敗時（壊れた zip など）は空文字を返す（呼び出し側が「抽出不能」として扱う）。
 */
export function pptxBufferToText(bytes: Buffer | Uint8Array): string {
  try {
    const out: string[] = [];
    readPptxSlides(bytes).forEach((slide, index) => {
      if (slide.sourceText) {
        out.push(`# スライド ${index + 1}`);
        out.push(slide.sourceText);
      }
    });
    return out.join("\n\n").trim();
  } catch {
    return "";
  }
}
