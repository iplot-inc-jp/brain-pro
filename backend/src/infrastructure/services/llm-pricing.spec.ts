import { estimateCostUsd, pricingFor } from './llm-pricing';

describe('llm-pricing', () => {
  it('既知モデル(sonnet)の input/output からコストを概算する', () => {
    // sonnet 4.6: input $3 / output $15 per MTok
    const cost = estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 4); // 18.0
  });

  it('opus は $5/$25、haiku は $1/$5、fable は $10/$50 per MTok（前方一致）', () => {
    expect(estimateCostUsd('claude-opus-4-8', 1_000_000, 0)).toBeCloseTo(5, 4);
    expect(estimateCostUsd('claude-opus-4-8', 0, 1_000_000)).toBeCloseTo(25, 4);
    expect(estimateCostUsd('claude-haiku-4-5', 1_000_000, 1_000_000)).toBeCloseTo(1 + 5, 4);
    expect(estimateCostUsd('claude-fable-5', 1_000_000, 1_000_000)).toBeCloseTo(10 + 50, 4);
  });

  it('未知モデルは既定(sonnet)単価にフォールバックして計算する', () => {
    const known = estimateCostUsd('claude-sonnet-4-6', 500_000, 0);
    const unknown = estimateCostUsd('totally-unknown-model', 500_000, 0);
    expect(unknown).toBeCloseTo(known, 6);
  });

  it('cache read/creation トークンも概算に加える（read=入力割引, creation=入力割増）', () => {
    const base = estimateCostUsd('claude-sonnet-4-6', 0, 0);
    const withCache = estimateCostUsd('claude-sonnet-4-6', 0, 0, 1_000_000, 1_000_000);
    expect(withCache).toBeGreaterThan(base);
  });

  it('pricingFor は既知モデルの単価を返す', () => {
    const p = pricingFor('claude-sonnet-4-6');
    expect(p.inputPerMTok).toBe(3);
    expect(p.outputPerMTok).toBe(15);
  });
});
