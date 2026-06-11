import { describe, it, expect } from 'vitest';
import {
  computeLayers,
  computeFlowLayout,
  computeLaneBands,
  DEFAULT_LAYOUT_OPTIONS,
  DEFAULT_LANE_BANDS_OPTIONS,
  type LayoutInputNode,
  type LayoutInputEdge,
  type LayoutRole,
  type BandInputNode,
} from './flow-layout';

const roles: LayoutRole[] = [
  { id: 'r-customer', name: '顧客', color: '#3b82f6' },
  { id: 'r-approver', name: '承認者', color: '#f59e0b' },
  { id: 'r-system', name: 'システム', color: '#8b5cf6' },
];

/**
 * 既定サイズノード同士の、隣接タイムライン列の中心間ピッチ。
 * 仕様: max(columnWidth, 前ノード半分 + 後ノード半分 + edgeLabelGap)。
 * 既定値（nodeWidth=156, edgeLabelGap=120, columnWidth=210）では
 * 156 + 120 = 276 が columnWidth を上回るので 276 になる。
 */
function expectedDefaultPitch(): number {
  const { nodeWidth, edgeLabelGap, columnWidth } = DEFAULT_LAYOUT_OPTIONS;
  return Math.max(columnWidth, nodeWidth / 2 + nodeWidth / 2 + edgeLabelGap);
}

// ===========================================
// computeLayers（補助ユーティリティ: 最長経路）
// ===========================================
describe('computeLayers', () => {
  it('線形チェーンはレイヤーが 0,1,2 と増える', () => {
    const ids = ['a', 'b', 'c'];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const layers = computeLayers(ids, edges);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(1);
    expect(layers.get('c')).toBe(2);
  });

  it('分岐は両ターゲットが同一レイヤーになる', () => {
    const ids = ['a', 'b', 'c'];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'c' },
    ];
    const layers = computeLayers(ids, edges);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(1);
    expect(layers.get('c')).toBe(1);
  });

  it('合流は最長経路を採用する', () => {
    // a->b->d (長さ2), a->d (長さ1) → d は layer 2
    const ids = ['a', 'b', 'd'];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'd' },
      { id: 'e3', source: 'a', target: 'd' },
    ];
    const layers = computeLayers(ids, edges);
    expect(layers.get('d')).toBe(2);
  });

  it('循環があっても例外を投げず全ノードにレイヤーを与える', () => {
    const ids = ['a', 'b', 'c'];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
      { id: 'e3', source: 'c', target: 'a' }, // バックエッジ
    ];
    const layers = computeLayers(ids, edges);
    expect(layers.size).toBe(3);
    for (const id of ids) expect(typeof layers.get(id)).toBe('number');
  });

  it('自己ループ・端点欠落エッジは無視する', () => {
    const ids = ['a', 'b'];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'a' }, // 自己ループ
      { id: 'e2', source: 'a', target: 'b' },
      { id: 'e3', source: 'a', target: 'ghost' }, // 欠落端点
    ];
    const layers = computeLayers(ids, edges);
    expect(layers.get('a')).toBe(0);
    expect(layers.get('b')).toBe(1);
  });
});

// ===========================================
// computeFlowLayout — 共通（向きに依存しない構造）
// ===========================================
describe('computeFlowLayout', () => {
  it('デフォルトは horizontal 向き', () => {
    const layout = computeFlowLayout([], [], roles);
    expect(layout.orientation).toBe('horizontal');
  });

  it('ロールごとに別レーンへ割り当てられる', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-approver', order: 1 },
      { id: 'c', roleId: 'r-system', order: 2 },
    ];
    const layout = computeFlowLayout(nodes, [], roles);
    const byId = (id: string) => layout.nodes.find((n) => n.id === id)!;
    expect(byId('a').laneIndex).toBe(0);
    expect(byId('b').laneIndex).toBe(1);
    expect(byId('c').laneIndex).toBe(2);
    // ロールごとに roleId が引き継がれる
    expect(byId('a').roleId).toBe('r-customer');
    expect(byId('b').roleId).toBe('r-approver');
    expect(byId('c').roleId).toBe('r-system');
  });

  it('roleId 不明/未指定のノードは「未割当」レーンに集約される', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer' },
      { id: 'x' }, // 未指定
      { id: 'y', roleId: 'nonexistent' }, // 不明
    ];
    const layout = computeFlowLayout(nodes, [], roles);
    const unassigned = layout.lanes.find(
      (l) => l.roleId === DEFAULT_LAYOUT_OPTIONS.unassignedLaneId,
    );
    expect(unassigned).toBeDefined();
    expect(layout.nodes.find((n) => n.id === 'x')!.roleId).toBe(
      DEFAULT_LAYOUT_OPTIONS.unassignedLaneId,
    );
    expect(layout.nodes.find((n) => n.id === 'y')!.roleId).toBe(
      DEFAULT_LAYOUT_OPTIONS.unassignedLaneId,
    );
  });

  it('PositionedNode は order をエコーする', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 5 },
      { id: 'b', roleId: 'r-customer', order: 12 },
    ];
    const layout = computeFlowLayout(nodes, [], roles);
    expect(layout.nodes.find((n) => n.id === 'a')!.order).toBe(5);
    expect(layout.nodes.find((n) => n.id === 'b')!.order).toBe(12);
  });

  it('空入力でも壊れない', () => {
    const layout = computeFlowLayout([], [], roles);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.lanes).toHaveLength(roles.length);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ===========================================
// computeFlowLayout — horizontal（時間=x, レーン=横帯）
// ===========================================
describe('computeFlowLayout (horizontal)', () => {
  const opt = { orientation: 'horizontal' as const };

  it('同一ロールの線形フロー（A→B→C）は同じレーン中心Yで列が増えて右へ進む', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', type: 'START', roleId: 'r-customer', order: 0 },
      { id: 'b', type: 'PROCESS', roleId: 'r-customer', order: 1 },
      { id: 'c', type: 'END', roleId: 'r-customer', order: 2 },
    ];
    // 時間軸はエッジの前後関係で駆動される（A→B→C）
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const layout = computeFlowLayout(nodes, edges, roles, opt);
    const [a, b, c] = ['a', 'b', 'c'].map(
      (id) => layout.nodes.find((n) => n.id === id)!,
    );
    // 同じレーン → 同じ中心Y
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    // エッジの前後で右へ進む（時間=x, 列が厳密に増加）
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    // レーン中心Yに一致
    const customerLane = layout.lanes.find((l) => l.roleId === 'r-customer')!;
    expect(a.y).toBe(customerLane.centerY);
  });

  it('時間軸はエッジの前後関係で駆動される（入力順や roleId に依らない）', () => {
    // 入力順は降順だがエッジ a→b→c が時間を決める
    const nodes: LayoutInputNode[] = [
      { id: 'c', roleId: 'r-system', order: 30 },
      { id: 'a', roleId: 'r-customer', order: 10 },
      { id: 'b', roleId: 'r-approver', order: 20 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const layout = computeFlowLayout(nodes, edges, roles, opt);
    const byId = (id: string) => layout.nodes.find((n) => n.id === id)!;
    // エッジ前後 = x 昇順
    expect(byId('a').x).toBeLessThan(byId('b').x);
    expect(byId('b').x).toBeLessThan(byId('c').x);
  });

  it('レーンは横帯で上→下に積層（top が増加, full-width geometry）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-approver', order: 1 },
      { id: 'c', roleId: 'r-system', order: 2 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, opt);
    expect(layout.lanes[0].top).toBeLessThan(layout.lanes[1].top);
    expect(layout.lanes[1].top).toBeLessThan(layout.lanes[2].top);
    for (const lane of layout.lanes) {
      expect(lane.height).toBeGreaterThan(0);
      expect(lane.centerY).toBe(lane.top + lane.height / 2);
    }
  });

  it('同一 (order, ロール) セルに複数ノードがあると Y方向に積み、レーン高さが自動拡張される', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'b1', roleId: 'r-approver', order: 0 },
      { id: 'b2', roleId: 'r-approver', order: 0 },
      { id: 'b3', roleId: 'r-approver', order: 0 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, opt);
    const approverLane = layout.lanes.find((l) => l.roleId === 'r-approver')!;
    expect(approverLane.height).toBeGreaterThan(
      DEFAULT_LAYOUT_OPTIONS.defaultLaneHeight,
    );
    const ys = ['b1', 'b2', 'b3'].map(
      (id) => layout.nodes.find((n) => n.id === id)!.y,
    );
    expect(ys[0]).toBeLessThan(ys[1]);
    expect(ys[1]).toBeLessThan(ys[2]);
    // 同一 order → 同じX
    const xs = ['b1', 'b2', 'b3'].map(
      (id) => layout.nodes.find((n) => n.id === id)!.x,
    );
    expect(new Set(xs).size).toBe(1);
  });

  it('全体高さ = レーン高さの総和、各ノードは自レーン範囲内', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-system', order: 1 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, opt);
    const sum = layout.lanes.reduce((s, l) => s + l.height, 0);
    expect(layout.height).toBe(sum);
    for (const n of layout.nodes) {
      const lane = layout.lanes[n.laneIndex];
      expect(n.y).toBeGreaterThanOrEqual(lane.top);
      expect(n.y).toBeLessThanOrEqual(lane.top + lane.height);
    }
  });
});

// ===========================================
// computeFlowLayout — vertical（時間=y, レーン=縦列）
// ===========================================
describe('computeFlowLayout (vertical)', () => {
  const opt = { orientation: 'vertical' as const };

  it('同一ロールの線形フロー（A→B→C）は同じレーン中心Xで行が増えて下へ進む', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', type: 'START', roleId: 'r-customer', order: 0 },
      { id: 'b', type: 'PROCESS', roleId: 'r-customer', order: 1 },
      { id: 'c', type: 'END', roleId: 'r-customer', order: 2 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const layout = computeFlowLayout(nodes, edges, roles, opt);
    const [a, b, c] = ['a', 'b', 'c'].map(
      (id) => layout.nodes.find((n) => n.id === id)!,
    );
    // 同じレーン → 同じ中心X
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);
    // エッジの前後で下へ進む（時間=y, 行が厳密に増加）
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    // レーン中心Xに一致
    const customerLane = layout.lanes.find((l) => l.roleId === 'r-customer')!;
    expect(a.x).toBe(customerLane.centerX);
  });

  it('時間軸はエッジの前後関係で駆動される（時間=y）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'c', roleId: 'r-system', order: 30 },
      { id: 'a', roleId: 'r-customer', order: 10 },
      { id: 'b', roleId: 'r-approver', order: 20 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const layout = computeFlowLayout(nodes, edges, roles, opt);
    const byId = (id: string) => layout.nodes.find((n) => n.id === id)!;
    expect(byId('a').y).toBeLessThan(byId('b').y);
    expect(byId('b').y).toBeLessThan(byId('c').y);
  });

  it('レーンは縦列で左→右に並置（left が増加, full-height geometry）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-approver', order: 1 },
      { id: 'c', roleId: 'r-system', order: 2 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, opt);
    expect(layout.lanes[0].left).toBeLessThan(layout.lanes[1].left);
    expect(layout.lanes[1].left).toBeLessThan(layout.lanes[2].left);
    for (const lane of layout.lanes) {
      expect(lane.width).toBeGreaterThan(0);
      expect(lane.centerX).toBe(lane.left + lane.width / 2);
    }
  });

  it('同一 (order, ロール) セルに複数ノードがあると X方向に積み、レーン幅が自動拡張される', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'b1', roleId: 'r-approver', order: 0 },
      { id: 'b2', roleId: 'r-approver', order: 0 },
      { id: 'b3', roleId: 'r-approver', order: 0 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, opt);
    const approverLane = layout.lanes.find((l) => l.roleId === 'r-approver')!;
    expect(approverLane.width).toBeGreaterThan(
      DEFAULT_LAYOUT_OPTIONS.defaultLaneHeight,
    );
    const xs = ['b1', 'b2', 'b3'].map(
      (id) => layout.nodes.find((n) => n.id === id)!.x,
    );
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    // 同一 order → 同じY
    const ys = ['b1', 'b2', 'b3'].map(
      (id) => layout.nodes.find((n) => n.id === id)!.y,
    );
    expect(new Set(ys).size).toBe(1);
  });

  it('全体幅 = レーン幅の総和、各ノードは自レーン範囲内', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-system', order: 1 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, opt);
    const sum = layout.lanes.reduce((s, l) => s + l.width, 0);
    expect(layout.width).toBe(sum);
    for (const n of layout.nodes) {
      const lane = layout.lanes[n.laneIndex];
      expect(n.x).toBeGreaterThanOrEqual(lane.left);
      expect(n.x).toBeLessThanOrEqual(lane.left + lane.width);
    }
  });
});

// ===========================================
// horizontal vs vertical: 時間/レーン軸の入れ替え整合
// ===========================================
describe('computeFlowLayout (orientation swap)', () => {
  const nodes: LayoutInputNode[] = [
    { id: 'a', roleId: 'r-customer', order: 0 },
    { id: 'b', roleId: 'r-customer', order: 1 },
    { id: 'p', roleId: 'r-approver', order: 0 },
    { id: 'q', roleId: 'r-approver', order: 1 },
  ];
  // 時間軸はエッジの前後関係で駆動される（a→b, p→q）
  const edges: LayoutInputEdge[] = [
    { id: 'e1', source: 'a', target: 'b' },
    { id: 'e2', source: 'p', target: 'q' },
  ];

  it('horizontal と vertical で時間/レーン軸が入れ替わる', () => {
    const h = computeFlowLayout(nodes, edges, roles, { orientation: 'horizontal' });
    const v = computeFlowLayout(nodes, edges, roles, { orientation: 'vertical' });

    const hById = (id: string) => h.nodes.find((n) => n.id === id)!;
    const vById = (id: string) => v.nodes.find((n) => n.id === id)!;

    // horizontal: 時間=x（order で進む）、レーン=y（ロールで分離）
    expect(hById('a').x).toBeLessThan(hById('b').x); // 時間 = x
    expect(hById('a').y).not.toBe(hById('p').y); // ロール = y で分離
    expect(hById('a').y).toBe(hById('b').y); // 同ロール = 同 y

    // vertical: 時間=y（order で進む）、レーン=x（ロールで分離）
    expect(vById('a').y).toBeLessThan(vById('b').y); // 時間 = y
    expect(vById('a').x).not.toBe(vById('p').x); // ロール = x で分離
    expect(vById('a').x).toBe(vById('b').x); // 同ロール = 同 x
  });

  it('どちらの向きでも lanes/nodes 数とサイズは正で整合する', () => {
    const h = computeFlowLayout(nodes, [], roles, { orientation: 'horizontal' });
    const v = computeFlowLayout(nodes, [], roles, { orientation: 'vertical' });

    expect(h.nodes).toHaveLength(nodes.length);
    expect(v.nodes).toHaveLength(nodes.length);
    expect(h.lanes).toHaveLength(roles.length);
    expect(v.lanes).toHaveLength(roles.length);

    // horizontal: 高さ = レーン高さ総和
    expect(h.height).toBe(h.lanes.reduce((s, l) => s + l.height, 0));
    // vertical: 幅 = レーン幅総和
    expect(v.width).toBe(v.lanes.reduce((s, l) => s + l.width, 0));

    expect(h.width).toBeGreaterThan(0);
    expect(h.height).toBeGreaterThan(0);
    expect(v.width).toBeGreaterThan(0);
    expect(v.height).toBeGreaterThan(0);
  });
});

// ===========================================
// computeFlowLayout — タイムライン軸 = エッジ前後関係（最長経路レイヤリング）
// ===========================================
describe('computeFlowLayout (edge-precedence timeline)', () => {
  it('線形チェーン A→B→C は列が厳密に 0,1,2 と増える（horizontal）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 0 },
      { id: 'c', roleId: 'r-customer', order: 0 },
    ];
    // 全ノード同 order でも、エッジ前後関係が列を決める
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    const byId = (id: string) => layout.nodes.find((n) => n.id === id)!;
    // 隣接列の中心間ピッチは max(columnWidth, ノード半分×2 + edgeLabelGap)。
    // 既定（156px ノード, edgeLabelGap=120）では 156 + 120 = 276 が columnWidth(210)
    // を上回るので、エッジ上の情報チップ余白ぶん広い 276px が採用される。
    const pitch = expectedDefaultPitch();
    expect(byId('b').x - byId('a').x).toBeCloseTo(pitch);
    expect(byId('c').x - byId('b').x).toBeCloseTo(pitch);
  });

  it('合流は最長経路を採用する（a→b→d と a→d で d は 2 列右）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 0 },
      { id: 'd', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'd' },
      { id: 'e3', source: 'a', target: 'd' }, // 短絡（長さ1）
    ];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    const byId = (id: string) => layout.nodes.find((n) => n.id === id)!;
    const pitch = expectedDefaultPitch();
    // 最長経路 a(0)→b(1)→d(2): d は a より 2 列右（各列間ピッチ pitch ぶん）
    expect(byId('d').x - byId('a').x).toBeCloseTo(pitch * 2);
    expect(byId('b').x - byId('a').x).toBeCloseTo(pitch);
  });

  it('同 order の UNCONNECTED ノードは同じ列を共有して積み上がる（horizontal）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-customer', order: 0 },
      { id: 'n3', roleId: 'r-customer', order: 0 },
    ];
    // エッジ無し → 全ノード layer 0 → 同じ列（x が一致）
    const layout = computeFlowLayout(nodes, [], roles, {
      orientation: 'horizontal',
    });
    const xs = ['n1', 'n2', 'n3'].map(
      (id) => layout.nodes.find((n) => n.id === id)!.x,
    );
    expect(new Set(xs).size).toBe(1);
  });

  it('2ノード循環は別々の列へ展開され（左端 1 列に潰れない）、循環で例外も投げない', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n1' }, // バックエッジ（循環）
    ];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    const byId = (id: string) => layout.nodes.find((n) => n.id === id)!;
    // n1→n2 が前向き、n2→n1 はバックエッジで除外 → n1=列0, n2=列1
    expect(byId('n1').x).toBeLessThan(byId('n2').x);
  });
});

// ===========================================
// computeFlowLayout — 最近接サイド接続ハンドル（edges 返り値）
// ===========================================
describe('computeFlowLayout (nearest-side edge handles)', () => {
  it('ターゲットが右にある水平エッジは source=right / target=left', () => {
    // a→b（同レーン・チェーン）→ b は a の右
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    expect(layout.edges).toHaveLength(1);
    const e = layout.edges.find((x) => x.id === 'e1')!;
    expect(e.sourceHandle).toBe('right');
    expect(e.targetHandle).toBe('left');
  });

  it('ターゲットが下にある垂直エッジは source=bottom / target=top', () => {
    // 別ロール間のエッジで、vertical では x が分離・チェーンで y が下に進む。
    // a(customer)→b(customer) を vertical で並べると b は a の真下。
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'vertical',
    });
    const e = layout.edges.find((x) => x.id === 'e1')!;
    expect(e.sourceHandle).toBe('bottom');
    expect(e.targetHandle).toBe('top');
  });

  it('source と target で必ず反対辺になる（top↔bottom / left↔right）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-approver', order: 0 },
      { id: 'c', roleId: 'r-system', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'b', target: 'c' },
    ];
    const opposite: Record<string, string> = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
    };
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const layout = computeFlowLayout(nodes, edges, roles, { orientation });
      for (const e of layout.edges) {
        expect(opposite[e.sourceHandle]).toBe(e.targetHandle);
      }
    }
  });

  it('端点欠落エッジは edges に含めない', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'a', target: 'ghost' }, // 欠落端点
    ];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    expect(layout.edges.map((e) => e.id)).toEqual(['e1']);
  });
});

// ===========================================
// computeFlowLayout — ノード個別サイズ対応
// ===========================================
describe('computeFlowLayout (per-node sizes)', () => {
  it('先頭列ノードの左端は marginX 以上（レーンラベル帯に食い込まない）', () => {
    // 幅広にリサイズした先頭ノードでも、左端（縦なら上端）が marginX より
    // ラベル帯側へはみ出さないこと。中心=marginX に置く旧実装では半分が帯に重なっていた。
    const nodes: LayoutInputNode[] = [
      { id: 'wide', roleId: 'r-customer', order: 0, width: 320 },
      { id: 'b', roleId: 'r-customer', order: 1 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'wide', target: 'b' }];
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const layout = computeFlowLayout(nodes, edges, roles, { orientation });
      const wide = layout.nodes.find((n) => n.id === 'wide')!;
      const mainLeft =
        orientation === 'horizontal' ? wide.x - wide.width / 2 : wide.y - wide.height / 2;
      expect(mainLeft).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_OPTIONS.marginX);
    }
  });

  it('個別 width/height を指定したノードはその実サイズで返る（horizontal）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0, width: 240, height: 120 },
      { id: 'b', roleId: 'r-customer', order: 1 }, // 既定サイズ
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    // 個別サイズがそのまま PositionedNode.width/height に反映される
    expect(a.width).toBe(240);
    expect(a.height).toBe(120);
    // 未指定ノードは opt のデフォルト
    expect(b.width).toBe(DEFAULT_LAYOUT_OPTIONS.nodeWidth);
    expect(b.height).toBe(DEFAULT_LAYOUT_OPTIONS.nodeHeight);
  });

  it('幅広ノードと既定ノードの主軸間隔は実サイズ（半分ずつ）を考慮して広がる（horizontal）', () => {
    // a は幅 320。a→b の中心間ピッチは少なくとも 320/2 + 156/2 + edgeLabelGap。
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0, width: 320, height: 52 },
      { id: 'b', roleId: 'r-customer', order: 1, width: 156, height: 52 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
    });
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    const expectedPitch = Math.max(
      DEFAULT_LAYOUT_OPTIONS.columnWidth,
      320 / 2 + 156 / 2 + DEFAULT_LAYOUT_OPTIONS.edgeLabelGap,
    );
    expect(b.x - a.x).toBeCloseTo(expectedPitch);
    // 端どうしの隙間は edgeLabelGap ぶん（チップが収まる余白）が確保される
    const gapBetweenEdges = b.x - b.width / 2 - (a.x + a.width / 2);
    expect(gapBetweenEdges).toBeCloseTo(DEFAULT_LAYOUT_OPTIONS.edgeLabelGap);
  });

  it('縦長ノードを積むとレーンが実サイズぶん厚くなり、ノード矩形が重ならない（horizontal）', () => {
    // 同一セル（同 order・同レーン）に背の高いノードを積む。
    const nodes: LayoutInputNode[] = [
      { id: 'b1', roleId: 'r-approver', order: 0, width: 156, height: 120 },
      { id: 'b2', roleId: 'r-approver', order: 0, width: 156, height: 80 },
      { id: 'b3', roleId: 'r-approver', order: 0, width: 156, height: 52 },
    ];
    const layout = computeFlowLayout(nodes, [], roles, {
      orientation: 'horizontal',
    });
    const approverLane = layout.lanes.find((l) => l.roleId === 'r-approver')!;
    // レーン厚は積んだ実高さの合計 + ギャップ + パディング以上
    const stack =
      120 + 80 + 52 + 2 * DEFAULT_LAYOUT_OPTIONS.verticalGap;
    expect(approverLane.height).toBeGreaterThanOrEqual(stack);
    // 積んだ 3 ノードはクロス軸（Y）で実サイズ分離し、矩形が重ならない
    const [n1, n2, n3] = ['b1', 'b2', 'b3'].map(
      (id) => layout.nodes.find((n) => n.id === id)!,
    );
    expect(n1.y + n1.height / 2).toBeLessThanOrEqual(n2.y - n2.height / 2);
    expect(n2.y + n2.height / 2).toBeLessThanOrEqual(n3.y - n3.height / 2);
    // すべて自レーン帯内に収まる
    for (const n of [n1, n2, n3]) {
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(approverLane.top);
      expect(n.y + n.height / 2).toBeLessThanOrEqual(
        approverLane.top + approverLane.height,
      );
    }
  });

  it('vertical では width が主軸/ height がクロス軸に効く（個別サイズ）', () => {
    // vertical: 主軸=y（高さで間隔）, クロス軸=x（幅でレーン厚）
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0, width: 156, height: 200 },
      { id: 'b', roleId: 'r-customer', order: 1, width: 156, height: 52 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'vertical',
    });
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(a.height).toBe(200);
    const expectedPitch = Math.max(
      DEFAULT_LAYOUT_OPTIONS.columnWidth,
      200 / 2 + 52 / 2 + DEFAULT_LAYOUT_OPTIONS.edgeLabelGap,
    );
    // 主軸（y）方向の中心間ピッチが高さを考慮して広がる
    expect(b.y - a.y).toBeCloseTo(expectedPitch);
  });
});

// ===========================================
// computeFlowLayout — 運ぶ情報チップ用の主軸余白（edgeLabelGap）
// ===========================================
describe('computeFlowLayout (edgeLabelGap)', () => {
  it('edgeLabelGap を大きくすると主軸ピッチが広がる（チップ余白の確保）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 1 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const small = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
      edgeLabelGap: 40,
    });
    const large = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
      edgeLabelGap: 240,
    });
    const dx = (l: ReturnType<typeof computeFlowLayout>) => {
      const a = l.nodes.find((n) => n.id === 'a')!;
      const b = l.nodes.find((n) => n.id === 'b')!;
      return b.x - a.x;
    };
    expect(dx(large)).toBeGreaterThan(dx(small));
  });

  it('edgeLabelGap が小さく columnWidth に収まる場合は等ピッチ（columnWidth）になる', () => {
    // 156 + edgeLabelGap(20) = 176 < columnWidth(210) → ピッチは columnWidth に張り付く
    const nodes: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-customer', order: 1 },
    ];
    const edges: LayoutInputEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
    const layout = computeFlowLayout(nodes, edges, roles, {
      orientation: 'horizontal',
      edgeLabelGap: 20,
    });
    const a = layout.nodes.find((n) => n.id === 'a')!;
    const b = layout.nodes.find((n) => n.id === 'b')!;
    expect(b.x - a.x).toBeCloseTo(DEFAULT_LAYOUT_OPTIONS.columnWidth);
  });

  it('DEFAULT_LAYOUT_OPTIONS は edgeLabelGap を持つ（既定 120）', () => {
    expect(DEFAULT_LAYOUT_OPTIONS.edgeLabelGap).toBe(120);
  });
});

// ===========================================
// computeLaneBands — 自由配置ノードに追従する背景レーン帯
// ===========================================
describe('computeLaneBands', () => {
  // 各ロールに 1 ノードずつ自由配置（中心座標 + サイズ）
  const freeNodes: BandInputNode[] = [
    { id: 'a', roleId: 'r-customer', x: 100, y: 60, width: 156, height: 52 },
    { id: 'b', roleId: 'r-approver', x: 320, y: 220, width: 156, height: 52 },
    { id: 'c', roleId: 'r-system', x: 540, y: 380, width: 156, height: 52 },
  ];

  it('ロールごとに 1 レーンを roles の並び順で返す', () => {
    const res = computeLaneBands(freeNodes, roles, 'horizontal');
    expect(res.lanes).toHaveLength(roles.length);
    expect(res.lanes.map((l) => l.roleId)).toEqual([
      'r-customer',
      'r-approver',
      'r-system',
    ]);
    expect(res.orientation).toBe('horizontal');
  });

  it('roleId 不明/未指定のノードは末尾の未割当レーンに集約される', () => {
    const withUnassigned: BandInputNode[] = [
      ...freeNodes,
      { id: 'x', x: 700, y: 500, width: 156, height: 52 }, // 未指定
      { id: 'y', roleId: 'ghost', x: 720, y: 520, width: 156, height: 52 }, // 不明
    ];
    const res = computeLaneBands(withUnassigned, roles, 'horizontal');
    expect(res.lanes).toHaveLength(roles.length + 1);
    const last = res.lanes[res.lanes.length - 1];
    expect(last.roleId).toBe(DEFAULT_LANE_BANDS_OPTIONS.unassignedLaneId);
  });

  it('horizontal: レーン帯は上→下に並び、重ならず、各帯はそのノードを内包する', () => {
    const res = computeLaneBands(freeNodes, roles, 'horizontal');
    expect(res.lanes[0].top).toBeLessThan(res.lanes[1].top);
    expect(res.lanes[1].top).toBeLessThan(res.lanes[2].top);
    for (const lane of res.lanes) {
      expect(lane.height).toBeGreaterThan(0);
      expect(lane.centerY).toBe(lane.top + lane.height / 2);
    }
    // 前レーンの下端 <= 次レーンの上端（重ならない・順序を保つ）
    expect(res.lanes[0].top + res.lanes[0].height).toBeLessThanOrEqual(
      res.lanes[1].top,
    );
    expect(res.lanes[1].top + res.lanes[1].height).toBeLessThanOrEqual(
      res.lanes[2].top,
    );
    // 各帯はそのロールのノード中心を内包する（自由配置に追従）
    for (const n of freeNodes) {
      const lane = res.lanes.find((l) => l.roleId === n.roleId)!;
      expect(n.y).toBeGreaterThanOrEqual(lane.top);
      expect(n.y).toBeLessThanOrEqual(lane.top + lane.height);
    }
  });

  it('horizontal: 縦に広がったノード群を持つレーンは厚く、1点だけのレーンは minLaneHeight', () => {
    // r-approver に縦に大きく広がったノードを 2 つ、r-system は無し
    const nodes: BandInputNode[] = [
      { id: 'a', roleId: 'r-customer', x: 100, y: 60, width: 156, height: 52 },
      { id: 'b1', roleId: 'r-approver', x: 300, y: 60, width: 156, height: 52 },
      { id: 'b2', roleId: 'r-approver', x: 500, y: 460, width: 156, height: 52 },
    ];
    const res = computeLaneBands(nodes, roles, 'horizontal');
    const customer = res.lanes.find((l) => l.roleId === 'r-customer')!;
    const approver = res.lanes.find((l) => l.roleId === 'r-approver')!;
    const system = res.lanes.find((l) => l.roleId === 'r-system')!;
    // 縦に広がったレーンは 1 点だけのレーンより厚い（minLaneHeight を超える）
    expect(approver.height).toBeGreaterThan(customer.height);
    expect(approver.height).toBeGreaterThan(
      DEFAULT_LANE_BANDS_OPTIONS.minLaneHeight,
    );
    // ノードを持たないレーンは最小厚
    expect(system.height).toBe(DEFAULT_LANE_BANDS_OPTIONS.minLaneHeight);
    // approver 帯は最も下のノード（y=460）まで伸びる（自由配置の下方向に追従）
    expect(approver.top + approver.height).toBeGreaterThanOrEqual(460);
  });

  it('horizontal: 横に並んだノード（side by side）は薄い 1 行に収まり、ノードを内包する', () => {
    // 同じレーンに横並び（Y は同じ、X だけ違う）。レーンは原点(cursor=0)から
    // 連続配置されるので、ノード(y=80)を内包するため帯は minLaneHeight 以上に
    // なるが、縦に広がったレーンよりは十分薄い。
    const nodes: BandInputNode[] = [
      { id: 'a', roleId: 'r-customer', x: 100, y: 80, width: 156, height: 52 },
      { id: 'b', roleId: 'r-customer', x: 320, y: 80, width: 156, height: 52 },
      { id: 'c', roleId: 'r-customer', x: 540, y: 80, width: 156, height: 52 },
    ];
    const res = computeLaneBands(nodes, roles, 'horizontal');
    const customer = res.lanes.find((l) => l.roleId === 'r-customer')!;
    // 最小厚以上で、横並び（縦の広がり無し）なので過度に厚くならない
    expect(customer.height).toBeGreaterThanOrEqual(
      DEFAULT_LANE_BANDS_OPTIONS.minLaneHeight,
    );
    // ノード(中心 y=80, 高さ 52)を帯が確実に内包する（band ⊇ content）
    expect(customer.top).toBeLessThanOrEqual(80 - 52 / 2);
    expect(customer.top + customer.height).toBeGreaterThanOrEqual(80 + 52 / 2);
    // 帯の幅（時間軸）は一番右のノードを含む
    expect(res.width).toBeGreaterThanOrEqual(540 + 156 / 2);
  });

  it('vertical: 軸が入れ替わり、レーン列は左→右に並び、重ならず、各列はそのノードを内包する', () => {
    const res = computeLaneBands(freeNodes, roles, 'vertical');
    expect(res.orientation).toBe('vertical');
    expect(res.lanes[0].left).toBeLessThan(res.lanes[1].left);
    expect(res.lanes[1].left).toBeLessThan(res.lanes[2].left);
    for (const lane of res.lanes) {
      expect(lane.width).toBeGreaterThan(0);
      expect(lane.centerX).toBe(lane.left + lane.width / 2);
    }
    // 重ならない（前列の右端 <= 次列の左端）
    expect(res.lanes[0].left + res.lanes[0].width).toBeLessThanOrEqual(
      res.lanes[1].left,
    );
    // 各列はそのロールのノード中心を内包する
    for (const n of freeNodes) {
      const lane = res.lanes.find((l) => l.roleId === n.roleId)!;
      expect(n.x).toBeGreaterThanOrEqual(lane.left);
      expect(n.x).toBeLessThanOrEqual(lane.left + lane.width);
    }
  });

  it('vertical: 横に広がったノード群を持つレーンは幅が広がる', () => {
    const nodes: BandInputNode[] = [
      { id: 'a', roleId: 'r-customer', x: 60, y: 100, width: 156, height: 52 },
      { id: 'b1', roleId: 'r-approver', x: 60, y: 300, width: 156, height: 52 },
      { id: 'b2', roleId: 'r-approver', x: 460, y: 500, width: 156, height: 52 },
    ];
    const res = computeLaneBands(nodes, roles, 'vertical');
    const customer = res.lanes.find((l) => l.roleId === 'r-customer')!;
    const approver = res.lanes.find((l) => l.roleId === 'r-approver')!;
    expect(approver.width).toBeGreaterThan(customer.width);
  });

  it('ノードが空でも壊れず、minLaneHeight 厚のレーンを返す', () => {
    const res = computeLaneBands([], roles, 'horizontal');
    expect(res.lanes).toHaveLength(roles.length);
    for (const lane of res.lanes) {
      expect(lane.height).toBe(DEFAULT_LANE_BANDS_OPTIONS.minLaneHeight);
    }
    expect(res.width).toBeGreaterThan(0);
    expect(res.height).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------
  // laneHeightOverrides — 手動リサイズの永続化（per-role 厚オーバーライド）
  // -----------------------------------------------------------------
  describe('laneHeightOverrides', () => {
    it('horizontal: オーバーライドのあるレーンはその厚みになり、無いレーンは自動のまま', () => {
      // r-customer に手動で厚み 300 を指定（自動なら minLaneHeight）
      const res = computeLaneBands(freeNodes, roles, 'horizontal', {
        laneHeightOverrides: { 'r-customer': 300 },
      });
      const customer = res.lanes.find((l) => l.roleId === 'r-customer')!;
      const approver = res.lanes.find((l) => l.roleId === 'r-approver')!;
      // オーバーライド適用
      expect(customer.height).toBe(300);
      // 指定の無いレーンは従来どおり最小厚（自動）
      expect(approver.height).toBe(DEFAULT_LANE_BANDS_OPTIONS.minLaneHeight);
      // レーンは重ならず順序を保つ（オーバーライドで広げても後続が押し下がる）
      expect(customer.top + customer.height).toBeLessThanOrEqual(approver.top);
    });

    it('vertical: オーバーライドはレーン幅に適用される', () => {
      const res = computeLaneBands(freeNodes, roles, 'vertical', {
        laneHeightOverrides: { 'r-approver': 280 },
      });
      const approver = res.lanes.find((l) => l.roleId === 'r-approver')!;
      expect(approver.width).toBe(280);
    });

    it('内容の自動厚がオーバーライドより大きい場合は内容を優先（max を採用）', () => {
      // r-approver は縦に大きく広がる（y=60 と y=460）→ 自動厚は大きい
      const nodes: BandInputNode[] = [
        { id: 'b1', roleId: 'r-approver', x: 300, y: 60, width: 156, height: 52 },
        { id: 'b2', roleId: 'r-approver', x: 500, y: 460, width: 156, height: 52 },
      ];
      // 自動厚（≈ 460-60 + パディング + ノード高）より小さい override=120 を渡す
      const auto = computeLaneBands(nodes, roles, 'horizontal');
      const overridden = computeLaneBands(nodes, roles, 'horizontal', {
        laneHeightOverrides: { 'r-approver': 120 },
      });
      const autoApprover = auto.lanes.find((l) => l.roleId === 'r-approver')!;
      const ovApprover = overridden.lanes.find((l) => l.roleId === 'r-approver')!;
      // override が自動厚より小さいので、内容に追従する自動厚が勝つ（縮まない）
      expect(ovApprover.height).toBe(autoApprover.height);
      expect(ovApprover.height).toBeGreaterThan(120);
    });

    it('オーバーライド未指定（デフォルト空）は従来挙動と完全一致する', () => {
      const withDefault = computeLaneBands(freeNodes, roles, 'horizontal');
      const withEmpty = computeLaneBands(freeNodes, roles, 'horizontal', {
        laneHeightOverrides: {},
      });
      expect(withEmpty.lanes.map((l) => l.height)).toEqual(
        withDefault.lanes.map((l) => l.height),
      );
    });
  });
});

// ===========================================
// 整形⇄レンダリングの整合（回帰テスト: ノードがレーン帯からはみ出さない）
// ===========================================
//
// バグ: 整形（computeFlowLayout）はノードを Role.laneHeight/defaultLaneHeight 由来の
// レーン厚で配置するのに対し、レンダラ（computeLaneBands）は per-flow の
// laneHeightOverrides でレーン帯を描いていたため、両者のレーン厚が食い違い、
// 整形後にノード中心がレーン帯の外（帯の上/下）に落ちることがあった。
//
// 不変条件: 整形後の各コンテンツノードの「クロス軸中心」は、そのロールの
// レーン帯 [lane.top, lane.top+lane.height]（horizontal）/
// [lane.left, lane.left+lane.width]（vertical）の内側に必ず収まる。
//
// この describe は SwimlaneCanvas の実パイプライン（整形の中心座標を左上に変換して
// 保存 → 背景レーン帯をその保存位置から再算出）を関数レベルで再現し、はみ出しが
// ゼロであることを検証する。整形に laneHeightOverrides を渡すことで両エンジンが
// 同一のレーン厚を使う前提を固定する。
describe('整形⇄レンダリング整合: ノードはレーン帯からはみ出さない', () => {
  // SwimlaneCanvas と一致させたノードサイズ（NODE_W/NODE_H == opt.nodeWidth/Height）
  const NODE_W = DEFAULT_LAYOUT_OPTIONS.nodeWidth;
  const NODE_H = DEFAULT_LAYOUT_OPTIONS.nodeHeight;

  /**
   * 整形 → 保存 → 背景帯再算出 の実パイプラインを関数レベルで再現する。
   * 戻り値は computeLaneBands の結果と、保存位置から復元した各ノードの BandInputNode。
   */
  function tidyThenBands(
    inputNodes: LayoutInputNode[],
    edges: LayoutInputEdge[],
    inputRoles: LayoutRole[],
    orientation: 'horizontal' | 'vertical',
    laneHeightOverrides: Record<string, number> = {},
  ) {
    // 1) 整形: 両エンジンが同一レーン厚を使うよう overrides を渡す
    const layout = computeFlowLayout(inputNodes, edges, inputRoles, {
      orientation,
      laneHeightOverrides,
    });
    // 2) 保存（中心→左上）→ 背景帯用に復元（左上→中心）。SwimlaneCanvas と同一。
    const bandNodes: BandInputNode[] = layout.nodes.map((pn) => {
      const left = pn.x - pn.width / 2;
      const top = pn.y - pn.height / 2;
      return {
        id: pn.id,
        roleId: pn.roleId,
        x: left + NODE_W / 2,
        y: top + NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
      };
    });
    // 3) 背景レーン帯を保存位置から再算出（レンダラと同一の overrides）
    const bands = computeLaneBands(bandNodes, inputRoles, orientation, {
      laneHeightOverrides,
    });
    return { layout, bandNodes, bands };
  }

  /** 各ノードのクロス軸中心が自ロールのレーン帯に収まることを表明する。 */
  function expectAllNodesInsideBands(
    bandNodes: BandInputNode[],
    bands: ReturnType<typeof computeLaneBands>,
    orientation: 'horizontal' | 'vertical',
  ) {
    const isHorizontal = orientation === 'horizontal';
    for (const n of bandNodes) {
      const lane = bands.lanes.find(
        (l) => l.roleId === (n.roleId ?? DEFAULT_LANE_BANDS_OPTIONS.unassignedLaneId),
      )!;
      expect(lane).toBeDefined();
      const start = isHorizontal ? lane.top : lane.left!;
      const size = isHorizontal ? lane.height : lane.width!;
      const center = isHorizontal ? n.y : n.x;
      // クロス軸中心が帯の内側（さらにノード半分も帯内）に収まる
      const half = (isHorizontal ? n.height : n.width) / 2;
      expect(center).toBeGreaterThanOrEqual(start);
      expect(center).toBeLessThanOrEqual(start + size);
      // ノード全体（中心±半サイズ）も帯に内包される（縁にぴったり張り付かない）
      expect(center - half).toBeGreaterThanOrEqual(start);
      expect(center + half).toBeLessThanOrEqual(start + size);
    }
  }

  const linearNodes: LayoutInputNode[] = [
    { id: 'a', type: 'START', roleId: 'r-customer', order: 0 },
    { id: 'b', type: 'PROCESS', roleId: 'r-approver', order: 1 },
    { id: 'c', type: 'SYSTEM_INTEGRATION', roleId: 'r-system', order: 2 },
    { id: 'd', type: 'PROCESS', roleId: 'r-customer', order: 3 },
  ];

  it('horizontal: 整形後すべてのノードがレーン帯内に収まる（override なし）', () => {
    const { bandNodes, bands } = tidyThenBands(
      linearNodes,
      [],
      roles,
      'horizontal',
    );
    expectAllNodesInsideBands(bandNodes, bands, 'horizontal');
  });

  it('vertical: 整形後すべてのノードがレーン帯内に収まる（override なし）', () => {
    const { bandNodes, bands } = tidyThenBands(linearNodes, [], roles, 'vertical');
    expectAllNodesInsideBands(bandNodes, bands, 'vertical');
  });

  it('horizontal: 同一セル多重ノード（自動拡張レーン）でもはみ出さない', () => {
    const crowded: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b1', roleId: 'r-approver', order: 0 },
      { id: 'b2', roleId: 'r-approver', order: 0 },
      { id: 'b3', roleId: 'r-approver', order: 0 },
      { id: 'c', roleId: 'r-system', order: 1 },
    ];
    const { bandNodes, bands } = tidyThenBands(crowded, [], roles, 'horizontal');
    expectAllNodesInsideBands(bandNodes, bands, 'horizontal');
  });

  it('horizontal: laneHeightOverride があってもノードがレーン帯内に収まる', () => {
    // r-customer を手動で 300 に広げる。override が 整形 にも渡るので
    // 後続レーンの top が押し下がっても整形のノード Y がそれに追従する。
    const overrides = { 'r-customer': 300 };
    const { bandNodes, bands } = tidyThenBands(
      linearNodes,
      [],
      roles,
      'horizontal',
      overrides,
    );
    // override が効いている（customer 帯が 300 以上）
    const customer = bands.lanes.find((l) => l.roleId === 'r-customer')!;
    expect(customer.height).toBeGreaterThanOrEqual(300);
    // それでも全ノードがレーン帯内
    expectAllNodesInsideBands(bandNodes, bands, 'horizontal');
  });

  it('vertical: laneHeightOverride があってもノードがレーン帯内に収まる', () => {
    const overrides = { 'r-approver': 280 };
    const { bandNodes, bands } = tidyThenBands(
      linearNodes,
      [],
      roles,
      'vertical',
      overrides,
    );
    const approver = bands.lanes.find((l) => l.roleId === 'r-approver')!;
    expect(approver.width).toBeGreaterThanOrEqual(280);
    expectAllNodesInsideBands(bandNodes, bands, 'vertical');
  });

  it('複数レーンに override があり、未割当ノードも混在してもはみ出さない', () => {
    const mixed: LayoutInputNode[] = [
      { id: 'a', roleId: 'r-customer', order: 0 },
      { id: 'b', roleId: 'r-approver', order: 1 },
      { id: 'u', order: 2 }, // 未割当
      { id: 'c', roleId: 'r-system', order: 3 },
    ];
    const overrides = { 'r-customer': 260, 'r-system': 320 };
    const { bandNodes, bands } = tidyThenBands(
      mixed,
      [],
      roles,
      'horizontal',
      overrides,
    );
    expectAllNodesInsideBands(bandNodes, bands, 'horizontal');
  });
});

// ===========================================
// 整形(TIDY) ノード重なり禁止（回帰: 2 ノードが左端 1 列に潰れて重なるバグ）
// ===========================================
//
// バグ: 整形すると 2 ノードが（特に少数ノード + 循環エッジで）互いの上に重なる/
// 左端のレーンラベル付近の極小領域に詰め込まれることがあった。
//
// 原因: タイムライン軸が order だけで決まっていたため、同じ order を持つノードは
// （エッジで連鎖していても）同一列に積み上がっていた。n1→n2→n1 のように全ノードが
// 同 order だと、全員が先頭列（x=marginX, レーンラベル直近）に積まれて潰れた。
//
// 不変条件: computeFlowLayout 後、いかなる 2 つのコンテンツノードの矩形
// （中心 ± NODE_W/2, NODE_H/2）も互いに重ならない（disjoint）。これを
// horizontal / vertical 両方、小さな循環 2〜3 ノードグラフで検証する。
describe('整形: ノード矩形は互いに重ならない（disjoint）', () => {
  // SwimlaneCanvas と一致させたノードサイズ（== opt.nodeWidth/Height）
  const NODE_W = DEFAULT_LAYOUT_OPTIONS.nodeWidth;
  const NODE_H = DEFAULT_LAYOUT_OPTIONS.nodeHeight;

  /** 中心座標の 2 ノードの矩形が重なる面積 > 0 か。 */
  function rectsOverlap(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): boolean {
    const ox =
      Math.min(a.x + NODE_W / 2, b.x + NODE_W / 2) -
      Math.max(a.x - NODE_W / 2, b.x - NODE_W / 2);
    const oy =
      Math.min(a.y + NODE_H / 2, b.y + NODE_H / 2) -
      Math.max(a.y - NODE_H / 2, b.y - NODE_H / 2);
    return ox > 0 && oy > 0;
  }

  /** 整形後の全ノード対が互いに重ならないことを表明する。 */
  function expectNoPairwiseOverlap(
    nodes: LayoutInputNode[],
    edges: LayoutInputEdge[],
    orientation: 'horizontal' | 'vertical',
  ) {
    const layout = computeFlowLayout(nodes, edges, roles, { orientation });
    // 入力ノード数だけ位置が出る
    expect(layout.nodes).toHaveLength(nodes.length);
    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        expect(
          rectsOverlap(a, b),
          `${a.id}(${a.x},${a.y}) と ${b.id}(${b.x},${b.y}) が重なっている`,
        ).toBe(false);
      }
    }
  }

  it('2 ノード循環（同一レーン・同 order）は重ならず時間軸に展開される', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n1' }, // バックエッジ（循環）
    ];
    expectNoPairwiseOverlap(nodes, edges, 'horizontal');
    expectNoPairwiseOverlap(nodes, edges, 'vertical');

    // 連鎖は時間軸方向に別の列へ展開される（左端 1 列に潰れない）
    const h = computeFlowLayout(nodes, edges, roles, { orientation: 'horizontal' });
    const hById = (id: string) => h.nodes.find((n) => n.id === id)!;
    expect(hById('n1').x).not.toBe(hById('n2').x);
    const v = computeFlowLayout(nodes, edges, roles, { orientation: 'vertical' });
    const vById = (id: string) => v.nodes.find((n) => n.id === id)!;
    expect(vById('n1').y).not.toBe(vById('n2').y);
  });

  it('3 ノード循環（同一レーン・同 order）でも重ならない', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-customer', order: 0 },
      { id: 'n3', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n1' }, // バックエッジ（循環）
    ];
    expectNoPairwiseOverlap(nodes, edges, 'horizontal');
    expectNoPairwiseOverlap(nodes, edges, 'vertical');
  });

  it('複数レーンにまたがる 2〜3 ノード循環でも重ならない', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-approver', order: 0 },
      { id: 'n3', roleId: 'r-system', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
      { id: 'e3', source: 'n3', target: 'n1' }, // バックエッジ（循環）
    ];
    expectNoPairwiseOverlap(nodes, edges, 'horizontal');
    expectNoPairwiseOverlap(nodes, edges, 'vertical');
  });

  it('自己ループのみの 2 ノード（同 order, 連結なし）も重ならない', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-customer', order: 0 },
    ];
    const edges: LayoutInputEdge[] = [
      { id: 'e1', source: 'n1', target: 'n1' }, // 自己ループ
      { id: 'e2', source: 'n2', target: 'n2' }, // 自己ループ
    ];
    expectNoPairwiseOverlap(nodes, edges, 'horizontal');
    expectNoPairwiseOverlap(nodes, edges, 'vertical');
  });

  it('エッジ無しで同 order に積まれた 3 ノードも矩形は重ならない（積み上げ disjoint）', () => {
    const nodes: LayoutInputNode[] = [
      { id: 'n1', roleId: 'r-customer', order: 0 },
      { id: 'n2', roleId: 'r-customer', order: 0 },
      { id: 'n3', roleId: 'r-customer', order: 0 },
    ];
    expectNoPairwiseOverlap(nodes, [], 'horizontal');
    expectNoPairwiseOverlap(nodes, [], 'vertical');
  });
});
