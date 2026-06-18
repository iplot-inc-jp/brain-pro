import { describe, it, expect } from 'vitest';
import { transposeFreeElement, type LaneBand } from './flow-lane-transpose';

// horizontal: レーン=横帯（top/height, cross=y）。time=x。
const H_LANES: LaneBand[] = [
  { roleId: 'r1', crossStart: 0, crossThickness: 100 },
  { roleId: 'r2', crossStart: 100, crossThickness: 100 },
];
// vertical: レーン=縦列（left/width, cross=x）。time=y。
const V_LANES: LaneBand[] = [
  { roleId: 'r1', crossStart: 0, crossThickness: 60 },
  { roleId: 'r2', crossStart: 60, crossThickness: 60 },
];

describe('transposeFreeElement', () => {
  it('maps an element in lane r2 from horizontal to vertical, preserving relative spot', () => {
    // horizontal: time x in [0..400], element center (200, 150) → lane r2 (y 100..200), midway.
    const out = transposeFreeElement({
      center: { x: 200, y: 150 },
      size: { w: 40, h: 40 },
      fromOrientation: 'horizontal',
      toOrientation: 'vertical',
      oldLanes: H_LANES,
      newLanes: V_LANES,
      oldMain: { min: 0, max: 400 },
      newMain: { min: 0, max: 800 },
    });
    // relMain = 200/400 = 0.5 → newMain(y) = 0.5*800 = 400
    // relCross = (150-100)/100 = 0.5 → newCross(x) = 60 + 0.5*60 = 90
    // center (x=90, y=400) → top-left (90-20, 400-20) = (70, 380)
    expect(out).toEqual({ positionX: 70, positionY: 380 });
  });

  it('maps vertical → horizontal symmetrically', () => {
    const out = transposeFreeElement({
      center: { x: 90, y: 400 },
      size: { w: 40, h: 40 },
      fromOrientation: 'vertical',
      toOrientation: 'horizontal',
      oldLanes: V_LANES,
      newLanes: H_LANES,
      oldMain: { min: 0, max: 800 },
      newMain: { min: 0, max: 400 },
    });
    // vertical: main=y=400 → rel 0.5 → newMain(x)=200; cross=x=90 in r2(60..120) rel 0.5 → newCross(y)=100+50=150
    // center (200,150) → top-left (180,130)
    expect(out).toEqual({ positionX: 180, positionY: 130 });
  });

  it('returns null when the element is in no lane', () => {
    const out = transposeFreeElement({
      center: { x: 200, y: 999 }, // y far below both lanes
      size: { w: 40, h: 40 },
      fromOrientation: 'horizontal',
      toOrientation: 'vertical',
      oldLanes: H_LANES,
      newLanes: V_LANES,
      oldMain: { min: 0, max: 400 },
      newMain: { min: 0, max: 800 },
    });
    expect(out).toBeNull();
  });

  it("returns null when the element's lane has no counterpart in the new orientation", () => {
    const out = transposeFreeElement({
      center: { x: 200, y: 50 }, // lane r1
      size: { w: 40, h: 40 },
      fromOrientation: 'horizontal',
      toOrientation: 'vertical',
      oldLanes: H_LANES,
      newLanes: [{ roleId: 'rX', crossStart: 0, crossThickness: 60 }], // no r1
      oldMain: { min: 0, max: 400 },
      newMain: { min: 0, max: 800 },
    });
    expect(out).toBeNull();
  });

  it('falls back to 0.5 relMain when content has zero span (single node)', () => {
    const out = transposeFreeElement({
      center: { x: 123, y: 50 }, // lane r1
      size: { w: 40, h: 40 },
      fromOrientation: 'horizontal',
      toOrientation: 'vertical',
      oldLanes: H_LANES,
      newLanes: V_LANES,
      oldMain: { min: 200, max: 200 }, // zero span
      newMain: { min: 0, max: 800 },
    });
    // relMain → 0.5 → newMain(y)=400; relCross=(50-0)/100=0.5 → newCross(x)=0+30=30
    // center (30,400) → top-left (10,380)
    expect(out).toEqual({ positionX: 10, positionY: 380 });
  });
});
