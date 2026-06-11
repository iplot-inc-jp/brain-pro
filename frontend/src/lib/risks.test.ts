import { describe, it, expect } from 'vitest';
import {
  classifyPriority,
  countByPriority,
  suggestPriority,
  pickLevel,
  normalizeRiskType,
  strategiesForRiskType,
  THREAT_STRATEGIES,
  OPPORTUNITY_STRATEGIES,
  pickScore,
  riskScore,
  scoreBand,
  lifecycleMeta,
  riskLifecycleMeta,
  heatmapCellKey,
  countHeatmapCells,
  type Risk,
} from './risks';

function mk(partial: Partial<Risk> & { id: string }): Risk {
  return {
    projectId: 'p',
    code: null,
    type: null,
    event: null,
    causeCategory: null,
    probability: null,
    impact: null,
    priority: null,
    countermeasure: null,
    needsMtg: null,
    mtgDate: null,
    deadline: null,
    owner: null,
    status: null,
    note: null,
    order: 0,
    ...partial,
  };
}

describe('pickLevel', () => {
  it('exact match (with surrounding whitespace) returns the level', () => {
    expect(pickLevel(' 高 ')).toBe('高');
    expect(pickLevel('中')).toBe('中');
    expect(pickLevel('低')).toBe('低');
  });

  it('non-matching / verbose / null values return empty', () => {
    expect(pickLevel('発生確率(高/中/低)')).toBe('');
    expect(pickLevel(null)).toBe('');
    expect(pickLevel(undefined)).toBe('');
    expect(pickLevel('')).toBe('');
  });
});

describe('classifyPriority', () => {
  it('maps Japanese and English variants', () => {
    expect(classifyPriority('高')).toBe('high');
    expect(classifyPriority('High')).toBe('high');
    expect(classifyPriority('中')).toBe('mid');
    expect(classifyPriority(' medium ')).toBe('mid');
    expect(classifyPriority('低')).toBe('low');
    expect(classifyPriority('LOW')).toBe('low');
  });

  it('blank / unknown values are other', () => {
    expect(classifyPriority(null)).toBe('other');
    expect(classifyPriority('')).toBe('other');
    expect(classifyPriority('   ')).toBe('other');
    expect(classifyPriority('緊急')).toBe('other');
  });
});

describe('countByPriority', () => {
  it('tallies risks by priority bucket', () => {
    const counts = countByPriority([
      mk({ id: 'a', priority: '高' }),
      mk({ id: 'b', priority: '高' }),
      mk({ id: 'c', priority: '中' }),
      mk({ id: 'd', priority: '低' }),
      mk({ id: 'e', priority: null }),
      mk({ id: 'f', priority: '謎' }),
    ]);
    expect(counts).toEqual({ high: 2, mid: 1, low: 1, other: 2 });
  });

  it('empty list yields all zeros', () => {
    expect(countByPriority([])).toEqual({ high: 0, mid: 0, low: 0, other: 0 });
  });
});

describe('suggestPriority', () => {
  it('combines probability and impact into a level', () => {
    expect(suggestPriority('高', '高')).toBe('高'); // 3+3=6
    expect(suggestPriority('高', '中')).toBe('高'); // 3+2=5
    expect(suggestPriority('高', '低')).toBe('中'); // 3+1=4
    expect(suggestPriority('中', '中')).toBe('中'); // 2+2=4
    expect(suggestPriority('中', '低')).toBe('低'); // 2+1=3
    expect(suggestPriority('低', '低')).toBe('低'); // 1+1=2
  });

  it('returns empty when either side is unset / invalid', () => {
    expect(suggestPriority('高', null)).toBe('');
    expect(suggestPriority(null, '低')).toBe('');
    expect(suggestPriority('発生確率', '影響度')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// PMBOK 追加ヘルパー
// ---------------------------------------------------------------------------

describe('normalizeRiskType', () => {
  it('OPPORTUNITY stays OPPORTUNITY', () => {
    expect(normalizeRiskType('OPPORTUNITY')).toBe('OPPORTUNITY');
  });

  it('THREAT / null / undefined / garbage all normalize to THREAT', () => {
    expect(normalizeRiskType('THREAT')).toBe('THREAT');
    expect(normalizeRiskType(null)).toBe('THREAT');
    expect(normalizeRiskType(undefined)).toBe('THREAT');
    expect(normalizeRiskType('')).toBe('THREAT');
    expect(normalizeRiskType('opportunity')).toBe('THREAT'); // 大文字小文字は区別
    expect(normalizeRiskType('謎')).toBe('THREAT');
  });
});

describe('strategiesForRiskType', () => {
  it('THREAT yields 回避/転嫁/軽減/受容', () => {
    expect(strategiesForRiskType('THREAT')).toEqual([...THREAT_STRATEGIES]);
    expect(strategiesForRiskType('THREAT')).toEqual([
      '回避',
      '転嫁',
      '軽減',
      '受容',
    ]);
  });

  it('OPPORTUNITY yields 活用/共有/強化/受容', () => {
    expect(strategiesForRiskType('OPPORTUNITY')).toEqual([
      ...OPPORTUNITY_STRATEGIES,
    ]);
    expect(strategiesForRiskType('OPPORTUNITY')).toEqual([
      '活用',
      '共有',
      '強化',
      '受容',
    ]);
  });

  it('null / undefined / garbage fall back to threat strategies', () => {
    expect(strategiesForRiskType(null)).toEqual([...THREAT_STRATEGIES]);
    expect(strategiesForRiskType(undefined)).toEqual([...THREAT_STRATEGIES]);
    expect(strategiesForRiskType('謎')).toEqual([...THREAT_STRATEGIES]);
  });
});

describe('pickScore', () => {
  it('accepts integers 1-5', () => {
    expect(pickScore(1)).toBe(1);
    expect(pickScore(3)).toBe(3);
    expect(pickScore(5)).toBe(5);
  });

  it('rejects out-of-range / non-integer / null / undefined', () => {
    expect(pickScore(0)).toBeNull();
    expect(pickScore(6)).toBeNull();
    expect(pickScore(2.5)).toBeNull();
    expect(pickScore(null)).toBeNull();
    expect(pickScore(undefined)).toBeNull();
  });
});

describe('riskScore', () => {
  it('multiplies probability and impact', () => {
    expect(riskScore(1, 1)).toBe(1);
    expect(riskScore(3, 4)).toBe(12);
    expect(riskScore(5, 5)).toBe(25);
  });

  it('propagates null when either side is unset / invalid', () => {
    expect(riskScore(null, 3)).toBeNull();
    expect(riskScore(3, null)).toBeNull();
    expect(riskScore(undefined, undefined)).toBeNull();
    expect(riskScore(0, 3)).toBeNull(); // 範囲外は未評価扱い
    expect(riskScore(3, 6)).toBeNull();
  });
});

describe('scoreBand', () => {
  it('band boundaries: 4→low, 5→mid, 12→mid, 15→high, 25→high', () => {
    expect(scoreBand(4)).toBe('low');
    expect(scoreBand(5)).toBe('mid');
    expect(scoreBand(12)).toBe('mid');
    expect(scoreBand(15)).toBe('high');
    expect(scoreBand(25)).toBe('high');
  });

  it('extremes within 1-25', () => {
    expect(scoreBand(1)).toBe('low');
    // 5×5 マトリクス上 13/14 は出現しないが、>=15 が high の境界であること
    expect(scoreBand(14)).toBe('mid');
  });
});

describe('lifecycleMeta', () => {
  it('known lifecycles return their meta', () => {
    expect(lifecycleMeta('IDENTIFIED')).toEqual(
      riskLifecycleMeta.IDENTIFIED,
    );
    expect(lifecycleMeta('CLOSED').label).toBe('終結');
  });

  it('unknown / null values fall back without throwing', () => {
    expect(lifecycleMeta('LEGACY_STATE').label).toBe('LEGACY_STATE');
    expect(lifecycleMeta(null).label).toBe('—');
    expect(lifecycleMeta(undefined).label).toBe('—');
  });
});

describe('countHeatmapCells', () => {
  it('counts THREAT risks with both scores evaluated, keyed by 確率-影響', () => {
    const m = countHeatmapCells([
      mk({ id: 'a', riskType: 'THREAT', probabilityScore: 3, impactScore: 4 }),
      mk({ id: 'b', riskType: 'THREAT', probabilityScore: 3, impactScore: 4 }),
      mk({ id: 'c', riskType: 'THREAT', probabilityScore: 5, impactScore: 5 }),
    ]);
    expect(m.get(heatmapCellKey(3, 4))).toBe(2);
    expect(m.get(heatmapCellKey(5, 5))).toBe(1);
    expect(m.size).toBe(2);
  });

  it('riskType null/undefined counts as THREAT', () => {
    const m = countHeatmapCells([
      mk({ id: 'a', riskType: null, probabilityScore: 2, impactScore: 2 }),
      mk({ id: 'b', probabilityScore: 2, impactScore: 2 }), // riskType undefined
    ]);
    expect(m.get(heatmapCellKey(2, 2))).toBe(2);
  });

  it('excludes OPPORTUNITY and unevaluated scores', () => {
    const m = countHeatmapCells([
      mk({
        id: 'opp',
        riskType: 'OPPORTUNITY',
        probabilityScore: 4,
        impactScore: 4,
      }),
      mk({ id: 'no-p', riskType: 'THREAT', impactScore: 3 }),
      mk({ id: 'no-i', riskType: 'THREAT', probabilityScore: 3 }),
      mk({
        id: 'oob',
        riskType: 'THREAT',
        probabilityScore: 0,
        impactScore: 9,
      }),
    ]);
    expect(m.size).toBe(0);
  });
});
