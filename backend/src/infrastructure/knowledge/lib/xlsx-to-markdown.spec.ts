import * as XLSX from 'xlsx';
import { xlsxBufferToMarkdown } from './xlsx-to-markdown';

function sample(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['名前', '数量'],
    ['りんご', 3],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, '在庫');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('xlsxBufferToMarkdown', () => {
  it('シート名見出し＋GFM表', () => {
    const md = xlsxBufferToMarkdown(sample());
    expect(md).toContain('## 在庫');
    expect(md).toContain('| 名前 | 数量 |');
    expect(md).toContain('| りんご | 3 |');
  });
});
