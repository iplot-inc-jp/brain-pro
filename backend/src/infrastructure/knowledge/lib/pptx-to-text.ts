import { unzipSync, strFromU8 } from 'fflate';

/**
 * pptx（Office Open XML presentation。Google スライドの Drive export 形式）から
 * スライド本文テキストを抽出する純関数。
 *
 * pptx は ZIP で、各スライドは `ppt/slides/slideN.xml`。本文は `<a:t>…</a:t>`（DrawingML の
 * テキストラン）に入る。スライド番号順に取り出し、スライドごとに見出しを付けて結合する。
 * 失敗時（壊れた zip など）は空文字を返す（呼び出し側が「抽出不能」として扱う）。
 */
export function pptxBufferToText(bytes: Buffer | Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    files = unzipSync(u8);
  } catch {
    return '';
  }

  const slidePaths = Object.keys(files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNo(a) - slideNo(b));

  const out: string[] = [];
  slidePaths.forEach((p, i) => {
    let xml: string;
    try {
      xml = strFromU8(files[p]);
    } catch {
      return;
    }
    const texts = extractRunTexts(xml);
    if (texts.length > 0) {
      out.push(`# スライド ${i + 1}`);
      out.push(texts.join('\n'));
    }
  });

  return out.join('\n\n').trim();
}

function slideNo(path: string): number {
  const m = path.match(/slide(\d+)\.xml$/);
  return m ? Number(m[1]) : 0;
}

/** DrawingML のテキストラン <a:t>…</a:t> を順に取り出す。 */
function extractRunTexts(xml: string): string[] {
  const res: string[] = [];
  const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const t = decodeXmlEntities(m[1]).trim();
    if (t) res.push(t);
  }
  return res;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}
