import { zipSync, strToU8 } from 'fflate';
import { pptxBufferToText } from './pptx-to-text';

/** スライド本文 XML 群から最小の pptx（zip）を作る。 */
function makePptx(slideBodies: Record<string, string>): Buffer {
  const files: Record<string, Uint8Array> = {};
  for (const [path, xml] of Object.entries(slideBodies)) {
    files[path] = strToU8(xml);
  }
  return Buffer.from(zipSync(files));
}

describe('pptxBufferToText', () => {
  it('各スライドの <a:t> をスライド番号順に抽出する', () => {
    const buf = makePptx({
      'ppt/slides/slide1.xml': '<p:sld><a:t>タイトル</a:t><a:t>本文1</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld><a:t>2枚目</a:t></p:sld>',
      // スライド以外（ノート等）は無視される。
      'ppt/notesSlides/notesSlide1.xml': '<a:t>ノート</a:t>',
    });
    const text = pptxBufferToText(buf);
    expect(text).toContain('# スライド 1');
    expect(text).toContain('タイトル');
    expect(text).toContain('本文1');
    expect(text).toContain('# スライド 2');
    expect(text).toContain('2枚目');
    expect(text).not.toContain('ノート');
    expect(text.indexOf('タイトル')).toBeLessThan(text.indexOf('2枚目'));
  });

  it('slide10 は slide2 の後に並ぶ（数値順ソート）', () => {
    const buf = makePptx({
      'ppt/slides/slide2.xml': '<a:t>two</a:t>',
      'ppt/slides/slide10.xml': '<a:t>ten</a:t>',
    });
    const text = pptxBufferToText(buf);
    expect(text.indexOf('two')).toBeLessThan(text.indexOf('ten'));
  });

  it('XML エンティティをデコードする', () => {
    const buf = makePptx({
      'ppt/slides/slide1.xml': '<a:t>A &amp; B &lt;tag&gt;</a:t>',
    });
    expect(pptxBufferToText(buf)).toContain('A & B <tag>');
  });

  it('zip でないバッファは空文字を返す', () => {
    expect(pptxBufferToText(Buffer.from('not a zip'))).toBe('');
  });
});
