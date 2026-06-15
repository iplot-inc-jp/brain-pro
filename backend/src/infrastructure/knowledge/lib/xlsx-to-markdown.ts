import * as XLSX from 'xlsx';

export function xlsxBufferToMarkdown(buf: Buffer, maxRowsPerSheet = 2000): string {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      defval: '',
    });
    out.push(`## ${name}`);
    if (!rows.length) {
      out.push('(空)');
      continue;
    }
    const clipped = rows.slice(0, maxRowsPerSheet);
    const head = clipped[0].map((c) => String(c));
    out.push(`| ${head.join(' | ')} |`);
    out.push(`| ${head.map(() => '---').join(' | ')} |`);
    for (const r of clipped.slice(1)) {
      out.push(`| ${head.map((_, i) => String(r[i] ?? '')).join(' | ')} |`);
    }
    if (rows.length > maxRowsPerSheet) {
      out.push(`… (${rows.length - maxRowsPerSheet} 行省略)`);
    }
  }
  return out.join('\n');
}
