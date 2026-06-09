import { describe, it, expect } from 'vitest';
import { serializeSnapshot } from './use-flow-undo-redo';
import type { FlowData } from '@/components/flow-editor/flow-types';

const baseFlow: FlowData = {
  id: 'flow-1',
  name: 'テストフロー',
  depth: 0,
  nodes: [],
  edges: [],
  breadcrumbs: [{ id: 'flow-1', name: 'テストフロー' }],
};

describe('serializeSnapshot', () => {
  it('正規化したノード（全項目 + informationLinks）を restore body 形に変換する', () => {
    const flow: FlowData = {
      ...baseFlow,
      nodes: [
        {
          id: 'n1',
          type: 'PROCESS',
          label: '受注',
          positionX: 10,
          positionY: 20,
          order: 0,
          roleId: 'r1',
          processingTime: '5分',
          handledCount: '3件',
          supplement: 'メモ',
          metadata: { foo: 'bar' },
          childFlowId: 'child-1',
          informationLinks: [
            {
              id: 'l1',
              nodeId: 'n1',
              informationTypeId: 'it1',
              direction: 'OUTPUT',
              order: 0,
            },
          ],
        },
      ],
    };

    const snap = serializeSnapshot(flow);
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0]).toEqual({
      id: 'n1',
      type: 'PROCESS',
      label: '受注',
      positionX: 10,
      positionY: 20,
      order: 0,
      roleId: 'r1',
      processingTime: '5分',
      handledCount: '3件',
      supplement: 'メモ',
      metadata: { foo: 'bar' },
      childFlowId: 'child-1',
      informationLinks: [
        { informationTypeId: 'it1', direction: 'OUTPUT', order: 0 },
      ],
    });
  });

  it('roleId 未設定でも role.id をフォールバックに使い、欠損は null/空配列に正規化する', () => {
    const flow: FlowData = {
      ...baseFlow,
      nodes: [
        {
          id: 'n1',
          type: 'PROCESS',
          label: 'A',
          positionX: 0,
          positionY: 0,
          role: { id: 'r-from-role', name: '担当', color: '#000' },
        },
      ],
    };
    const snap = serializeSnapshot(flow);
    expect(snap.nodes[0].roleId).toBe('r-from-role');
    expect(snap.nodes[0].processingTime).toBeNull();
    expect(snap.nodes[0].childFlowId).toBeNull();
    expect(snap.nodes[0].informationLinks).toEqual([]);
  });

  it('エッジの全項目（ハンドル/情報種別/線形/ラベル位置）を変換し、欠損を null に正規化する', () => {
    const flow: FlowData = {
      ...baseFlow,
      edges: [
        {
          id: 'e1',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          sourceHandle: 'right',
          targetHandle: 'left',
          label: 'ラベル',
          condition: 'yes',
          informationTypeId: 'it1',
          pathStyle: 'bezier',
          labelT: 0.3,
          infoT: 0.7,
        },
        {
          id: 'e2',
          sourceNodeId: 'n2',
          targetNodeId: 'n3',
        },
      ],
    };
    const snap = serializeSnapshot(flow);
    expect(snap.edges[0]).toEqual({
      id: 'e1',
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      sourceHandle: 'right',
      targetHandle: 'left',
      label: 'ラベル',
      condition: 'yes',
      informationTypeId: 'it1',
      pathStyle: 'bezier',
      labelT: 0.3,
      infoT: 0.7,
    });
    expect(snap.edges[1]).toEqual({
      id: 'e2',
      sourceNodeId: 'n2',
      targetNodeId: 'n3',
      sourceHandle: null,
      targetHandle: null,
      label: undefined,
      condition: undefined,
      informationTypeId: null,
      pathStyle: null,
      labelT: null,
      infoT: null,
    });
  });

  it('同一 flowData からは安定した（等価な）スナップショットを返す', () => {
    const flow: FlowData = {
      ...baseFlow,
      nodes: [
        { id: 'n1', type: 'PROCESS', label: 'A', positionX: 1, positionY: 2, roleId: 'r1' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'n1', targetNodeId: 'n1' }],
    };
    expect(JSON.stringify(serializeSnapshot(flow))).toBe(
      JSON.stringify(serializeSnapshot(flow)),
    );
  });
});
