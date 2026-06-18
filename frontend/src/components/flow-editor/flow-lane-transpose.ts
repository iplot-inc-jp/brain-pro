// 縦横切替時、自由配置要素（画像 / ICON注釈）を「どのレーン(ロール)のどこにいたか」を
// 相対的に解釈して新しい向きのレーン幾何へ移し替える純粋関数。
//
// 背景: コンテンツノードは roleId+order から computeFlowLayout が構造的に再配置するため
// 縦横を切り替えても正しい位置に来るが、自由配置の画像/アイコンは絶対座標保持のため
// 置き去りになる。ここでは要素の「レーン内の相対位置（時間軸方向% × レーン横断方向%）」を
// 旧レーン幾何から求め、新レーン幾何に同じ比率で写像する。DOM もエイリアス import も持たない。

export type FlowOrientation = 'horizontal' | 'vertical';

/** レーン1本の横断方向（cross）の帯。horizontal は y(top/height)、vertical は x(left/width)。 */
export interface LaneBand {
  roleId: string;
  crossStart: number;
  crossThickness: number;
}

/** 時間軸（main）方向のコンテンツ範囲（ノード中心の最小〜最大）。 */
export interface MainBounds {
  min: number;
  max: number;
}

export interface TransposeParams {
  /** 要素の中心座標（world）。 */
  center: { x: number; y: number };
  /** 要素のサイズ（top-left 復元用）。 */
  size: { w: number; h: number };
  fromOrientation: FlowOrientation;
  toOrientation: FlowOrientation;
  /** 旧向きのレーン帯（roleId 付き）。 */
  oldLanes: LaneBand[];
  /** 新向きのレーン帯（roleId 付き）。 */
  newLanes: LaneBand[];
  /** 旧向きの time 軸コンテンツ範囲。 */
  oldMain: MainBounds;
  /** 新向きの time 軸コンテンツ範囲。 */
  newMain: MainBounds;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** horizontal: main=x / cross=y。vertical: main=y / cross=x。 */
function split(o: FlowOrientation, x: number, y: number): { main: number; cross: number } {
  return o === 'horizontal' ? { main: x, cross: y } : { main: y, cross: x };
}

/**
 * 自由配置要素を旧向きのレーン相対位置から新向きへ移し替えた top-left を返す。
 * 旧向きでどのレーンにも入っていない／同 roleId のレーンが新向きに無い場合は null
 * （呼び出し側は従来位置を維持 or 別ロジックにフォールバック）。
 */
export function transposeFreeElement(p: TransposeParams): { positionX: number; positionY: number } | null {
  const old = split(p.fromOrientation, p.center.x, p.center.y);

  // 旧向き: 横断座標がどのレーン帯に入るか（境界は半開区間で末尾レーンは閉じる）。
  const oldLane =
    p.oldLanes.find(
      (l) => old.cross >= l.crossStart && old.cross <= l.crossStart + l.crossThickness,
    ) ?? null;
  if (!oldLane) return null;

  const newLane = p.newLanes.find((l) => l.roleId === oldLane.roleId) ?? null;
  if (!newLane) return null;

  const relCross =
    oldLane.crossThickness > 0
      ? clamp01((old.cross - oldLane.crossStart) / oldLane.crossThickness)
      : 0.5;
  const oldSpan = p.oldMain.max - p.oldMain.min;
  const relMain = oldSpan > 0 ? clamp01((old.main - p.oldMain.min) / oldSpan) : 0.5;

  const newCross = newLane.crossStart + relCross * newLane.crossThickness;
  const newMain = p.newMain.min + relMain * (p.newMain.max - p.newMain.min);

  // 新向きで (main,cross) を (x,y) に戻す。
  const cx = p.toOrientation === 'horizontal' ? newMain : newCross;
  const cy = p.toOrientation === 'horizontal' ? newCross : newMain;

  return {
    positionX: Math.round(cx - p.size.w / 2),
    positionY: Math.round(cy - p.size.h / 2),
  };
}
