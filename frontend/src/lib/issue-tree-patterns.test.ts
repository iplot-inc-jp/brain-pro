import { describe, it, expect } from 'vitest';
import {
  ISSUE_TREE_PATTERNS,
  ISSUE_NODE_KINDS,
  KIND_CONFIG,
  PATTERN_META,
  ROOT_PRIMARY_KIND,
  rootKindForPattern,
  childKindForPattern,
  patternFromLegacyType,
  legacyTreeTypeForPattern,
  emptyRollupCounts,
  addVerificationToCounts,
  rollupStatus,
  computeDimmedNodeIds,
  type DimmableNode,
  type IssueTreePattern,
} from './issue-tree-patterns';

describe('issue-tree-patterns config', () => {
  it('defines meta for all 6 patterns', () => {
    expect(ISSUE_TREE_PATTERNS).toHaveLength(6);
    for (const p of ISSUE_TREE_PATTERNS) {
      expect(PATTERN_META[p]).toBeTruthy();
      expect(PATTERN_META[p].label.length).toBeGreaterThan(0);
      expect(ROOT_PRIMARY_KIND[p].length).toBeGreaterThan(0);
    }
  });

  it('defines guide + example (root + children) for all 6 patterns', () => {
    for (const p of ISSUE_TREE_PATTERNS) {
      const meta = PATTERN_META[p];
      expect(meta.guide.length).toBeGreaterThan(0);
      expect(meta.example.rootLabel.length).toBeGreaterThan(0);
      expect(meta.example.children.length).toBeGreaterThan(0);
      for (const c of meta.example.children) {
        expect(c.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('example matches 教材 早見表 (root labels)', () => {
    expect(PATTERN_META.ISSUE_POINT.example.rootLabel).toBe('営業利益率が低下している');
    expect(PATTERN_META.WHY.example.rootLabel).toBe('売上が前年比 -10%');
    expect(PATTERN_META.WHAT.example.rootLabel).toBe('購買業務');
    expect(PATTERN_META.HOW.example.rootLabel).toBe('在庫予測精度の向上');
    expect(PATTERN_META.MECE_ACTION.example.rootLabel).toBe('営業利益率 6.0% を達成する');
    expect(PATTERN_META.KPI.example.rootLabel).toBe('営業利益率 6.0%');
  });

  it('childKindForPattern mirrors backend decideSuggestKind', () => {
    expect(childKindForPattern('ISSUE_POINT')).toBe('POINT');
    expect(childKindForPattern('WHY')).toBe('CAUSE');
    expect(childKindForPattern('WHAT')).toBe('ELEMENT');
    expect(childKindForPattern('HOW')).toBe('OPTION');
    expect(childKindForPattern('MECE_ACTION')).toBe('ACTION');
    expect(childKindForPattern('KPI')).toBe('METRIC');
    // target kind overrides pattern default
    expect(childKindForPattern('ISSUE_POINT', 'CAUSE')).toBe('CAUSE');
    expect(childKindForPattern('WHY', 'HYPOTHESIS')).toBe('VERIFICATION');
    expect(childKindForPattern('HOW', 'VERIFICATION')).toBe('VERIFICATION');
  });

  it('defines config for all 11 kinds with a valid affordance', () => {
    expect(ISSUE_NODE_KINDS).toHaveLength(11);
    const valid = new Set(['verification', 'recommendation', 'task', 'metric', null]);
    for (const k of ISSUE_NODE_KINDS) {
      const cfg = KIND_CONFIG[k];
      expect(cfg).toBeTruthy();
      expect(valid.has(cfg.affordance)).toBe(true);
      // 種別ごとの説明（編集パネルのホバーツールチップ用）が全種別にある。
      expect(cfg.description.length).toBeGreaterThan(0);
    }
  });

  it('maps affordances per spec', () => {
    expect(KIND_CONFIG.CAUSE.affordance).toBe('verification');
    expect(KIND_CONFIG.POINT.affordance).toBe('verification');
    expect(KIND_CONFIG.HYPOTHESIS.affordance).toBe('verification');
    expect(KIND_CONFIG.VERIFICATION.affordance).toBe('verification');
    expect(KIND_CONFIG.RESULT.affordance).toBe('verification');
    expect(KIND_CONFIG.OPTION.affordance).toBe('recommendation');
    expect(KIND_CONFIG.COUNTERMEASURE.affordance).toBe('recommendation');
    expect(KIND_CONFIG.ACTION.affordance).toBe('task');
    expect(KIND_CONFIG.METRIC.affordance).toBe('metric');
    expect(KIND_CONFIG.ELEMENT.affordance).toBeNull();
    expect(KIND_CONFIG.ISSUE.affordance).toBeNull();
  });

  it('recursion: POINT/CAUSE/ELEMENT/OPTION/ACTION/METRIC can add same-kind child', () => {
    const recursive: Array<keyof typeof KIND_CONFIG> = [
      'POINT',
      'CAUSE',
      'ELEMENT',
      'OPTION',
      'ACTION',
      'METRIC',
    ];
    for (const k of recursive) {
      expect(KIND_CONFIG[k].childAddButtons.some((b) => b.childKind === k)).toBe(true);
    }
  });

  it('issue-point chain: POINT→HYPOTHESIS→VERIFICATION→RESULT', () => {
    expect(KIND_CONFIG.POINT.childAddButtons.some((b) => b.childKind === 'HYPOTHESIS')).toBe(true);
    expect(KIND_CONFIG.HYPOTHESIS.childAddButtons.some((b) => b.childKind === 'VERIFICATION')).toBe(
      true,
    );
    expect(KIND_CONFIG.VERIFICATION.childAddButtons.some((b) => b.childKind === 'RESULT')).toBe(
      true,
    );
  });

  it('rootKindForPattern: KPI→METRIC, others→ISSUE', () => {
    expect(rootKindForPattern('KPI')).toBe('METRIC');
    (['ISSUE_POINT', 'WHY', 'WHAT', 'HOW', 'MECE_ACTION'] as IssueTreePattern[]).forEach((p) => {
      expect(rootKindForPattern(p)).toBe('ISSUE');
    });
  });

  it('legacy type <-> pattern fallbacks', () => {
    expect(patternFromLegacyType('SOLUTION')).toBe('HOW');
    expect(patternFromLegacyType('WHY')).toBe('WHY');
    expect(patternFromLegacyType(undefined)).toBe('WHY');
    expect(legacyTreeTypeForPattern('HOW')).toBe('SOLUTION');
    expect(legacyTreeTypeForPattern('MECE_ACTION')).toBe('SOLUTION');
    expect(legacyTreeTypeForPattern('WHY')).toBe('WHY');
    expect(legacyTreeTypeForPattern('ISSUE_POINT')).toBe('WHY');
  });
});

describe('rollup (発散→収束)', () => {
  it('NA is not counted', () => {
    const c = addVerificationToCounts(emptyRollupCounts(), 'NA');
    expect(c.total).toBe(0);
    expect(rollupStatus(c)).toBe('none');
  });

  it('all CONFIRMED => confirmed', () => {
    let c = emptyRollupCounts();
    c = addVerificationToCounts(c, 'CONFIRMED');
    c = addVerificationToCounts(c, 'CONFIRMED');
    expect(c.total).toBe(2);
    expect(c.confirmed).toBe(2);
    expect(rollupStatus(c)).toBe('confirmed');
  });

  it('any REJECTED => rejected (takes precedence over confirmed)', () => {
    let c = emptyRollupCounts();
    c = addVerificationToCounts(c, 'CONFIRMED');
    c = addVerificationToCounts(c, 'REJECTED');
    expect(rollupStatus(c)).toBe('rejected');
  });

  it('UNKNOWN / NEEDS_HEARING (no reject) => partial', () => {
    let c = emptyRollupCounts();
    c = addVerificationToCounts(c, 'CONFIRMED');
    c = addVerificationToCounts(c, 'UNKNOWN');
    expect(rollupStatus(c)).toBe('partial');

    let d = emptyRollupCounts();
    d = addVerificationToCounts(d, 'NEEDS_HEARING');
    expect(d.unknown).toBe(1);
    expect(rollupStatus(d)).toBe('partial');
  });

  it('reject beats unknown', () => {
    let c = emptyRollupCounts();
    c = addVerificationToCounts(c, 'UNKNOWN');
    c = addVerificationToCounts(c, 'REJECTED');
    expect(rollupStatus(c)).toBe('rejected');
  });
});

describe('computeDimmedNodeIds (打ち手の採用連動グレーアウト)', () => {
  const mk = (
    id: string,
    parentId: string | null,
    kind: DimmableNode['kind'],
    recommendation: DimmableNode['recommendation'],
  ): DimmableNode => ({ id, parentId, kind, recommendation });

  it('採用が無いグループは誰も淡色にしない', () => {
    const dim = computeDimmedNodeIds([
      mk('a', 'p', 'OPTION', 'NA'),
      mk('b', 'p', 'OPTION', 'HOLD'),
      mk('c', 'p', 'COUNTERMEASURE', 'REJECT'),
    ]);
    expect(dim.size).toBe(0);
  });

  it('採用があると同親の打ち手系で採用以外を淡色にする', () => {
    const dim = computeDimmedNodeIds([
      mk('a', 'p', 'OPTION', 'ADOPT'),
      mk('b', 'p', 'OPTION', 'HOLD'),
      mk('c', 'p', 'COUNTERMEASURE', 'NA'),
    ]);
    expect(dim.has('a')).toBe(false); // 採用は通常表示
    expect(dim.has('b')).toBe(true);
    expect(dim.has('c')).toBe(true);
  });

  it('OPTION と COUNTERMEASURE は同じ打ち手グループとして混在判定する', () => {
    const dim = computeDimmedNodeIds([
      mk('a', 'p', 'COUNTERMEASURE', 'ADOPT'),
      mk('b', 'p', 'OPTION', 'NA'),
    ]);
    expect(dim.has('b')).toBe(true);
  });

  it('親が違えばグループは独立（別親の採用は影響しない）', () => {
    const dim = computeDimmedNodeIds([
      mk('a', 'p1', 'OPTION', 'ADOPT'),
      mk('b', 'p1', 'OPTION', 'NA'),
      mk('c', 'p2', 'OPTION', 'NA'),
      mk('d', 'p2', 'OPTION', 'HOLD'),
    ]);
    expect(dim.has('b')).toBe(true); // p1: 採用あり
    expect(dim.has('c')).toBe(false); // p2: 採用なし
    expect(dim.has('d')).toBe(false);
  });

  it('打ち手でない種別は親に採用があっても淡色対象にしない', () => {
    const dim = computeDimmedNodeIds([
      mk('a', 'p', 'OPTION', 'ADOPT'),
      mk('cause', 'p', 'CAUSE', 'NA'),
      mk('point', 'p', 'POINT', 'NA'),
    ]);
    expect(dim.has('cause')).toBe(false);
    expect(dim.has('point')).toBe(false);
  });

  it('parentId=null（ルート直下）の打ち手兄弟も束ねて判定する', () => {
    const dim = computeDimmedNodeIds([
      mk('a', null, 'OPTION', 'ADOPT'),
      mk('b', null, 'OPTION', 'REJECT'),
    ]);
    expect(dim.has('b')).toBe(true);
  });
});
