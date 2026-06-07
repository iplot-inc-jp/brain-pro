import { describe, it, expect } from 'vitest';
import { summarizeDoSteps, definitionToRow, EMPTY_DEFINITION } from './flow-definition';

describe('summarizeDoSteps', () => {
  it('空配列は空文字', () => {
    expect(summarizeDoSteps([])).toBe('');
  });
  it('1件はその文を返す', () => {
    expect(summarizeDoSteps(['受注票を受領'])).toBe('受注票を受領');
  });
  it('複数件は先頭＋件数', () => {
    expect(summarizeDoSteps(['a', 'b', 'c'])).toBe('a ほか2件 (全3手順)');
  });
});

describe('definitionToRow', () => {
  it('① 一覧の列を抽出する', () => {
    const row = definitionToRow({
      ...EMPTY_DEFINITION,
      flowId: 'f1',
      purpose: '受注処理', owner: '営業', input: '受注票',
      doSteps: ['x', 'y'], output: '発注書', frequency: '毎日', system: 'ERP',
    });
    expect(row).toEqual({
      purpose: '受注処理', owner: '営業', input: '受注票',
      doSummary: 'x ほか1件 (全2手順)', output: '発注書', frequency: '毎日', system: 'ERP',
    });
  });
});
