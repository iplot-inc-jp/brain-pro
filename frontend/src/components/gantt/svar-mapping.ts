// 我々のドメイン（Task / TaskDependency）を SVAR Gantt（wx-react-gantt）の
// データ形（tasks / links）へ変換する純粋関数群。React / DOM に依存しない。
//
// 設計メモ:
//  - SVAR の progress は CSS の width(%) にそのまま使われる 0..100 スケール
//    （ライブラリ実体で `progress + "%"`）。我々の Task.progress も 0..100 なので無変換。
//  - 親（子を持つ）タスクは type:'summary'。マイルストーンは type:'milestone'。
//  - 日付が無いタスクはバーが消えてしまうため、既定ウィンドウ（today..+7d）を与える。
//  - link は id を我々の dependency.id に一致させる（delete-link で dep.id を直接得るため）。
//    source=先行(predecessor), target=後続(successor), type:'e2s'（finish→start）。

import type { Task, TaskDependency } from '@/lib/tasks';
import type { SvarTask, SvarLink } from 'wx-react-gantt';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' / ISO を Date に。null/不正は null。 */
export function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const head = value.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(head);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

function clampProgress(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export interface MapTasksOptions {
  /** 日付が無いタスクのバー開始に使う基準日（通常は今日）。 */
  today?: Date;
  /** 日付が無いタスクのバー幅（日数）。デフォルト 7。 */
  defaultSpanDays?: number;
  /** WBS 番号（id -> '1.2.3'）。あれば text に前置する。 */
  wbsNumbers?: Map<string, string>;
}

/**
 * Task[] を SVAR の SvarTask[] に変換する。
 * - parentId を参照されているタスクは summary（親バー）。
 * - milestone は type:'milestone'。
 * - start/end が無ければ today..+defaultSpanDays の窓を与える（バーを必ず表示）。
 */
export function mapTasksToSvar(
  tasks: Task[],
  options: MapTasksOptions = {}
): SvarTask[] {
  const today = startOfLocalDay(options.today ?? new Date());
  const span = Math.max(1, options.defaultSpanDays ?? 7);
  const wbs = options.wbsNumbers;

  const parentIds = new Set<string>();
  for (const t of tasks) if (t.parentId) parentIds.add(t.parentId);

  return tasks.map((t) => {
    const s = toDate(t.startDate);
    const e = toDate(t.dueDate);

    let start: Date;
    let end: Date;
    if (s && e) {
      // 逆転していたら入れ替える
      [start, end] = s.getTime() <= e.getTime() ? [s, e] : [e, s];
    } else if (s) {
      start = s;
      end = addDays(s, 1);
    } else if (e) {
      start = addDays(e, -1);
      end = e;
    } else {
      // 日付なし: 既定ウィンドウ
      start = today;
      end = addDays(today, span);
    }

    const isParent = parentIds.has(t.id);
    const type: SvarTask['type'] = t.milestone
      ? 'milestone'
      : isParent
        ? 'summary'
        : 'task';

    const prefix = wbs?.get(t.id);
    const text = prefix ? `${prefix} ${t.title}` : t.title;

    const task: SvarTask = {
      id: t.id,
      text,
      start,
      end,
      progress: clampProgress(t.progress),
      type,
      open: true,
    };
    if (t.parentId && parentExists(tasks, t.parentId)) {
      task.parent = t.parentId;
    }
    return task;
  });
}

/** TaskDependency[] を SVAR の SvarLink[] に変換（id を温存）。 */
export function mapDepsToSvar(deps: TaskDependency[]): SvarLink[] {
  return deps.map((d) => ({
    id: d.id,
    source: d.predecessorId,
    target: d.successorId,
    type: 'e2s', // finish-to-start
  }));
}

/** SVAR の Date を 'YYYY-MM-DD' に（ローカル日付）。バックエンドへ渡す ISO 文字列の素。 */
export function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parentExists(tasks: Task[], parentId: string): boolean {
  return tasks.some((t) => t.id === parentId);
}
