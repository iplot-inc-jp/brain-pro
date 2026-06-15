import { normalizeLabel } from './normalize-label';

describe('normalizeLabel', () => {
  it('全半角・大小・前後空白・連続空白を正規化', () => {
    expect(normalizeLabel(' 受注  System ')).toBe('受注 system');
    expect(normalizeLabel('ＡＢＣ')).toBe('abc'); // 全角英字→半角小文字
    expect(normalizeLabel('在庫　管理')).toBe('在庫 管理'); // 全角空白→半角
  });
  it('空/記号のみは空文字', () => {
    expect(normalizeLabel('  ・  ')).toBe('・');
  });
  it('非文字列入力（null/undefined/数値/オブジェクト）は空文字', () => {
    expect(normalizeLabel(null as unknown as string)).toBe('');
    expect(normalizeLabel(undefined as unknown as string)).toBe('');
    expect(normalizeLabel(123 as unknown as string)).toBe('');
    expect(normalizeLabel({} as unknown as string)).toBe('');
  });
});
