// ベンダリングした frappe-gantt v1.2.2（./index.js）の型定義。
// 形は既存の ambient 宣言 src/types/frappe-gantt.d.ts（declare module 'frappe-gantt'）
// を流用する。実体（ランタイム）は ./index.js。
import GanttBase from 'frappe-gantt';
import type { FrappeViewMode } from 'frappe-gantt';

export type { FrappeTask, FrappeViewMode, FrappeGanttOptions } from 'frappe-gantt';

export default class Gantt extends GanttBase {
  /**
   * 表示モードを切り替える。maintain_pos=true で現在のスクロール位置を維持
   * （ベンダリング元 v1.2.2 から存在する第2引数。ambient 宣言には無いためここで補う）。
   */
  change_view_mode(mode?: FrappeViewMode, maintain_pos?: boolean): void;
  /**
   * document など外部に登録したリスナーを解除する（vendor 独自追加）。
   * React 側のアンマウント時に DOM を破棄する前に呼ぶ。
   */
  destroy(): void;
}
