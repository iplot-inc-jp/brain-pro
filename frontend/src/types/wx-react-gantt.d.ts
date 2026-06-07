// wx-react-gantt (SVAR Gantt) はバンドルに型定義を同梱していないため、
// 本プロジェクトで利用する範囲だけ手書きの ambient 宣言を与える。
// 実体は dist/gantt.js（ESM, client-only）。
declare module 'wx-react-gantt' {
  import type { ComponentType } from 'react';

  /** SVAR タスク（バー）データ */
  export interface SvarTask {
    id: string | number;
    text: string;
    start?: Date;
    end?: Date;
    duration?: number;
    /** 0..1 想定（SVAR の進捗は割合） */
    progress?: number;
    parent?: string | number;
    type?: 'task' | 'summary' | 'milestone';
    open?: boolean;
    lazy?: boolean;
    [key: string]: unknown;
  }

  /** SVAR リンク（依存）データ。source=先行, target=後続 */
  export interface SvarLink {
    id: string | number;
    source: string | number;
    target: string | number;
    /** e2s(finish→start) 等。FS は "e2s" */
    type: string;
  }

  export interface SvarScale {
    unit: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
    step: number;
    format: string | ((date: Date) => string);
    css?: (date: Date) => string;
  }

  export interface SvarColumn {
    id: string;
    header?: string;
    width?: number;
    align?: 'left' | 'center' | 'right';
    flexgrow?: number;
    [key: string]: unknown;
  }

  /** update-task イベントのペイロード（drag-move / resize / progress / 編集保存で発火） */
  export interface UpdateTaskEvent {
    id: string | number;
    /** マージ後のタスク差分（start / end / progress / text などが入りうる） */
    task: Partial<SvarTask>;
    /** ドラッグ中は true。確定時に false / undefined */
    inProgress?: boolean;
    eventSource?: string;
    [key: string]: unknown;
  }

  export interface AddLinkEvent {
    /** 追加直後は id が未確定のことがある */
    id?: string | number;
    link: { id?: string | number; source: string | number; target: string | number; type: string };
  }

  export interface DeleteLinkEvent {
    id: string | number;
  }

  /** SVAR の命令/イベント API（init コールバックで受け取る） */
  export interface GanttApi {
    /** アクション発火後に呼ばれる購読 */
    on(event: 'update-task', handler: (ev: UpdateTaskEvent) => void): void;
    on(event: 'add-link', handler: (ev: AddLinkEvent) => void): void;
    on(event: 'delete-link', handler: (ev: DeleteLinkEvent) => void): void;
    on(event: string, handler: (ev: any) => void): void;
    /** アクション実行前に割り込み（false / 例外でキャンセル可） */
    intercept(event: string, handler: (ev: any) => boolean | void): void;
    /** アクションを明示実行 */
    exec(event: string, payload: any): void;
    /** 現在のストア状態 */
    getState(): { tasks: any; links: SvarLink[]; [key: string]: unknown };
    getTask(id: string | number): SvarTask | undefined;
  }

  export interface GanttProps {
    tasks: SvarTask[];
    links?: SvarLink[];
    scales?: SvarScale[];
    columns?: SvarColumn[] | false;
    cellWidth?: number;
    cellHeight?: number;
    scaleHeight?: number;
    readonly?: boolean;
    zoom?: boolean;
    /** マウント時に api を受け取るコールバック */
    init?: (api: GanttApi) => void;
  }

  export const Gantt: ComponentType<GanttProps>;
  export const Toolbar: ComponentType<any>;
  export const ContextMenu: ComponentType<any>;
  /** テーマプロバイダ（子をラップして willow テーマを適用） */
  export const Willow: ComponentType<{ children?: React.ReactNode }>;
  export const WillowDark: ComponentType<{ children?: React.ReactNode }>;
  export const defaultColumns: SvarColumn[];
  export const defaultEditorShape: any[];
  export const defaultMenuOptions: any[];
  export const defaultToolbarButtons: any[];
}
