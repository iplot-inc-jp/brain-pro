import { describe, it, expect } from 'vitest';
import {
  deriveDefinitionFromFlow,
  hasDerivableContent,
} from './derive-flow-definition';
import type {
  FlowDataNode,
  Role,
} from '@/components/flow-editor/flow-types';

function node(p: Partial<FlowDataNode> & { id: string }): FlowDataNode {
  return {
    type: 'PROCESS',
    label: '',
    positionX: 0,
    positionY: 0,
    ...p,
  } as FlowDataNode;
}

const roles: Role[] = [
  { id: 'r-sales', name: '営業部', color: '#111', type: 'HUMAN' },
  { id: 'r-buyer', name: '購買部', color: '#222', type: 'HUMAN' },
  { id: 'r-sys', name: '基幹システム', color: '#333', type: 'SYSTEM' },
];

describe('deriveDefinitionFromFlow', () => {
  it('手順を order 昇順・START/END 除外・担当ロール接頭辞付きで導出する', () => {
    const nodes: FlowDataNode[] = [
      node({ id: 'n0', type: 'START', label: '受注見込み連絡', order: 0, roleId: 'r-sales' }),
      node({ id: 'n2', type: 'PROCESS', label: '発注書を作成', order: 2, roleId: 'r-buyer' }),
      node({ id: 'n1', type: 'PROCESS', label: '在庫を照会', order: 1, roleId: 'r-buyer' }),
      node({ id: 'n9', type: 'END', label: '完了', order: 9 }),
    ];
    const d = deriveDefinitionFromFlow(nodes, [], roles);
    expect(d.doSteps).toEqual(['【購買部】在庫を照会', '【購買部】発注書を作成']);
    expect(d.trigger).toBe('受注見込み連絡');
  });

  it('担当は処理ノードで最頻の人間ロール、使用システムは SYSTEM ロール＋連携ノード', () => {
    const nodes: FlowDataNode[] = [
      node({ id: 'n1', label: '照会', order: 1, roleId: 'r-buyer' }),
      node({ id: 'n2', label: '発注', order: 2, roleId: 'r-buyer' }),
      node({ id: 'n3', label: '確認', order: 3, roleId: 'r-sales' }),
      node({ id: 'n4', type: 'SYSTEM_INTEGRATION', label: 'FAX送信', order: 4 }),
    ];
    const d = deriveDefinitionFromFlow(nodes, [], roles);
    expect(d.owner).toBe('購買部');
    expect(d.system).toContain('基幹システム');
    expect(d.system).toContain('FAX送信');
  });

  it('INPUT/OUTPUT を情報リンクの方向別に集計、次工程をクロスフローリンクから導出', () => {
    const nodes: FlowDataNode[] = [
      node({
        id: 'n1',
        label: '受領',
        order: 1,
        roleId: 'r-buyer',
        informationLinks: [
          {
            id: 'il1',
            nodeId: 'n1',
            informationTypeId: 'it1',
            direction: 'INPUT',
            order: 0,
            informationType: { id: 'it1', name: '受注見込みリスト', category: 'DOCUMENT' },
          },
          {
            id: 'il2',
            nodeId: 'n1',
            informationTypeId: 'it2',
            direction: 'OUTPUT',
            order: 0,
            informationType: { id: 'it2', name: '発注書', category: 'DOCUMENT' },
          },
        ],
        links: [
          {
            id: 'l1',
            nodeId: 'n1',
            direction: 'OUTPUT',
            targetFlowId: 'f2',
            targetFlowName: '検収',
            order: 0,
          },
        ],
      }),
    ];
    const d = deriveDefinitionFromFlow(nodes, [], roles);
    expect(d.input).toBe('受注見込みリスト');
    expect(d.output).toBe('発注書');
    expect(d.nextProcess).toBe('検収');
  });

  it('ノードもロールも無いときは全項目が空（hasDerivableContent=false）', () => {
    const d = deriveDefinitionFromFlow([], [], []);
    expect(d.doSteps).toEqual([]);
    expect(d.trigger).toBeNull();
    expect(d.owner).toBeNull();
    expect(d.system).toBeNull();
    expect(hasDerivableContent(d)).toBe(false);
  });

  it('ノードが無くても SYSTEM ロールがあれば使用システムは導出される', () => {
    const d = deriveDefinitionFromFlow([], [], roles);
    expect(d.system).toBe('基幹システム');
    expect(hasDerivableContent(d)).toBe(true);
  });
});
