import { buildMergePlan } from './merge-plan';

const extraction = {
  summary: 's',
  tags: ['受注', '受注'], // 重複はまとめる
  entities: [{ label: '受注System', kind: 'SYSTEM' }],
  relations: [{ from: '受注', to: '受注System', label: '使う' }],
};

describe('buildMergePlan', () => {
  it('タグ/実体を正規化キーで一意化し、relation 端点を解決', () => {
    const plan = buildMergePlan(extraction);
    // ノード要求は normalizedLabel で一意（受注[TAG], 受注system[ENTITY]）
    expect(plan.nodes).toHaveLength(2);
    expect(plan.mentions).toHaveLength(2);
    expect(plan.relations[0]).toMatchObject({
      fromKey: '受注',
      toKey: '受注system',
      label: '使う',
    });
  });

  it('非文字列のタグ/実体/関係ラベルは無視して落ちない（LLM ノイズ耐性）', () => {
    const noisy = {
      summary: 's',
      // 数値/null/オブジェクトの混入
      tags: ['正常', 123, null, {}],
      entities: [
        { label: '実体A', kind: 'SYSTEM' },
        { label: 456, kind: 'ORG' }, // label 非文字列 → 無視
        { kind: 'PERSON' }, // label 欠落 → 無視
      ],
      relations: [
        { from: '正常', to: '実体A', label: 7 }, // label 非文字列 → label なし扱い
        { from: 789, to: '実体A' }, // from 非文字列 → addNode で undefined → スキップ
      ],
    } as unknown as Parameters<typeof buildMergePlan>[0];

    const plan = buildMergePlan(noisy);
    const labels = plan.nodes.map((n) => n.label).sort();
    expect(labels).toEqual(['実体A', '正常']);
    // 有効な relation は from=正常,to=実体A の1本。label は非文字列なので undefined。
    expect(plan.relations).toHaveLength(1);
    expect(plan.relations[0]).toMatchObject({
      fromKey: '正常',
      toKey: '実体a',
    });
    expect(plan.relations[0].label).toBeUndefined();
  });
});
