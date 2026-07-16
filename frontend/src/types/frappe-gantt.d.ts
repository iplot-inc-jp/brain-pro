// frappe-gantt (MIT, v1.2.x) は型定義を同梱していないため、
// 本プロジェクトで利用する範囲だけ手書きの ambient 宣言を与える。
// 実体は dist/frappe-gantt.es.js（ESM, default export のクラス）。
declare module 'frappe-gantt' {
  /** frappe-gantt が表示する 1 タスク（バー）。 */
  export interface FrappeTask {
    id: string;
    name: string;
    /** 'YYYY-MM-DD' もしくは ISO 文字列。 */
    start: string;
    /** 'YYYY-MM-DD' もしくは ISO 文字列（フラッペでは終了日「込み」）。 */
    end: string;
    /** 0..100 の進捗％。 */
    progress: number;
    /**
     * 先行タスク id を「,」区切りで並べた文字列（または id 配列）。
     * この task に向かって先行 → 後続の矢印が描かれる。
     */
    dependencies?: string | string[];
    custom_class?: string;
    [key: string]: unknown;
  }

  /** 表示モード（目盛り粒度）。 */
  export type FrappeViewMode =
    | 'Hour'
    | 'Quarter Day'
    | 'Half Day'
    | 'Day'
    | 'Week'
    | 'Two Weeks'
    | 'Month'
    | 'Year';

  export interface FrappeViewModeDefinition {
    name: FrappeViewMode;
    step: string;
    padding?: string | [string, string];
    column_width?: number;
    date_format?: string;
    snap_at?: string;
    lower_text?:
      | string
      | ((date: Date, previous?: Date, language?: string) => string);
    upper_text?:
      | string
      | ((date: Date, previous?: Date, language?: string) => string);
    thick_line?: (date: Date) => boolean;
    upper_text_frequency?: number;
  }

  export interface FrappeGanttOptions {
    view_mode?: FrappeViewMode;
    view_modes?: Array<FrappeViewMode | FrappeViewModeDefinition>;
    language?: string;
    /** 編集を全面無効化（true で読み取り専用）。 */
    readonly?: boolean;
    /** 進捗ハンドルのみ無効化。 */
    readonly_progress?: boolean;
    /** 日付ドラッグ／リサイズのみ無効化。 */
    readonly_dates?: boolean;
    bar_height?: number;
    padding?: number;
    column_width?: number;
    container_height?: number | 'auto';
    popup_on?: 'click' | 'hover';
    lines?: 'both' | 'horizontal' | 'vertical' | 'none';
    infinite_padding?: boolean;
    /** 初期スクロール位置。'today' / 'start' / 'end' / 'YYYY-MM-DD'。 */
    scroll_to?: string;
    /** バー本体を左右ドラッグしたとき（id でなく task と新しい start/end）。 */
    on_date_change?: (task: FrappeTask, start: Date, end: Date) => void;
    /** 進捗ハンドルを動かしたとき。 */
    on_progress_change?: (task: FrappeTask, progress: number) => void;
    /** バーをクリックしたとき。 */
    on_click?: (task: FrappeTask) => void;
    /** 表示モードを切り替えたとき。 */
    on_view_change?: (mode: { name: string } | string) => void;
    popup?: ((...args: unknown[]) => unknown) | false;
    [key: string]: unknown;
  }

  /**
   * `new Gantt(wrapper, tasks, options)`。
   * wrapper は CSS セレクタ文字列 / HTMLElement / SVGElement。
   */
  export default class Gantt {
    constructor(
      wrapper: string | HTMLElement | SVGElement,
      tasks: FrappeTask[],
      options?: FrappeGanttOptions
    );
    /** タスク配列を差し替えて再描画（現在の表示モードは維持）。 */
    refresh(tasks: FrappeTask[]): void;
    /** 表示モードを切り替える。 */
    change_view_mode(mode?: FrappeViewMode): void;
    /** オプションをマージして再構成。 */
    update_options(options: FrappeGanttOptions): void;
  }
}
