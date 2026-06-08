import { describe, it, expect } from 'vitest';
import { assignFunctionNumbers, buildDataFlowRows, type DfdNode, type DfdFlow } from './dfd';

describe('assignFunctionNumbers', () => {
  it('FUNCTIONノードに 1-1,1-2… を順に付ける（番号既存はそのまま）', () => {
    const nodes: DfdNode[] = [
      { id: 'a', kind: 'FUNCTION', label: '受注', number: null, positionX: 0, positionY: 0 },
      { id: 'e', kind: 'EXTERNAL_ENTITY', label: '顧客', number: null, positionX: 0, positionY: 0 },
      { id: 'b', kind: 'FUNCTION', label: '出荷', number: '1-9', positionX: 0, positionY: 0 },
    ];
    const out = assignFunctionNumbers(nodes, 1);
    expect(out.find((n) => n.id === 'a')!.number).toBe('1-1');
    expect(out.find((n) => n.id === 'b')!.number).toBe('1-9'); // 既存維持
    expect(out.find((n) => n.id === 'e')!.number).toBeNull();  // 非FUNCTIONは付けない
  });
});

describe('buildDataFlowRows', () => {
  it('DfdFlow を 源泉/データ項目/宛先/方向 の行に変換', () => {
    const nodes: DfdNode[] = [
      { id: 'ext', kind: 'EXTERNAL_ENTITY', label: '顧客', number: null, positionX: 0, positionY: 0 },
      { id: 'fn', kind: 'FUNCTION', label: '受注登録', number: '1-1', positionX: 0, positionY: 0 },
    ];
    const flows: DfdFlow[] = [
      { id: 'f1', sourceNodeId: 'ext', targetNodeId: 'fn', dataItem: '受注データ', informationTypeId: null, order: 0 },
    ];
    const rows = buildDataFlowRows(nodes, flows);
    expect(rows).toEqual([
      { no: 1, source: '顧客', dataItem: '受注データ', target: '受注登録', direction: 'IN', relatedFunction: '受注登録', informationTypeId: null },
    ]);
  });
});
