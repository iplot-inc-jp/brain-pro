'use client';

// SVAR Gantt（wx-react-gantt）のクライアント専用ラッパー。
//
// このコンポーネントは DOM に依存するため、ページ側からは next/dynamic({ ssr:false })
// で読み込む。ここで CSS を取り込み、ライブラリの命令 API（init コールバックで受け取る
// `api`）を使って drag / resize / progress / link 作成・削除 を上位コールバックへ橋渡しする。

import { useCallback, useRef } from 'react';
import {
  Gantt,
  Willow,
  type GanttApi,
  type SvarTask,
  type SvarLink,
  type SvarScale,
  type SvarColumn,
  type UpdateTaskEvent,
  type AddLinkEvent,
  type DeleteLinkEvent,
} from 'wx-react-gantt';
import 'wx-react-gantt/dist/gantt.css';

export type SvarGanttScaleMode = 'day' | 'week';

export interface SvarGanttProps {
  tasks: SvarTask[];
  links: SvarLink[];
  columns: SvarColumn[];
  scaleMode: SvarGanttScaleMode;
  cellHeight?: number;
  /**
   * バーの移動 / リサイズ / 進捗変更が「確定」したとき（inProgress=false）に発火。
   * task には start / end / progress のうち変化したものが入りうる。
   */
  onTaskCommit: (
    id: string,
    patch: { start?: Date; end?: Date; progress?: number }
  ) => void | Promise<void>;
  /** 依存（リンク）が作成されたとき。source=先行, target=後続。 */
  onLinkCreate: (
    predecessorId: string,
    successorId: string
  ) => void | Promise<void>;
  /** 依存（リンク）が削除されたとき。id は我々の dependency.id。 */
  onLinkDelete: (dependencyId: string) => void | Promise<void>;
}

const DAY_SCALES: SvarScale[] = [
  { unit: 'month', step: 1, format: 'yyyy年M月' },
  { unit: 'day', step: 1, format: 'd' },
];

const WEEK_SCALES: SvarScale[] = [
  { unit: 'month', step: 1, format: 'yyyy年M月' },
  { unit: 'week', step: 1, format: 'M/d' },
];

export default function SvarGantt({
  tasks,
  links,
  columns,
  scaleMode,
  cellHeight = 36,
  onTaskCommit,
  onLinkCreate,
  onLinkDelete,
}: SvarGanttProps) {
  // コールバックは最新参照を ref に保持（init は一度しか呼ばれない想定のため）。
  const cbRef = useRef({ onTaskCommit, onLinkCreate, onLinkDelete });
  cbRef.current = { onTaskCommit, onLinkCreate, onLinkDelete };

  const handleInit = useCallback((api: GanttApi) => {
    // --- バー移動 / リサイズ / 進捗変更 ---
    // update-task はドラッグ中も連続発火するので、確定（inProgress=false）時のみ送る。
    api.on('update-task', (ev: UpdateTaskEvent) => {
      if (ev.inProgress) return;
      const t = ev.task ?? {};
      const patch: { start?: Date; end?: Date; progress?: number } = {};
      if (t.start instanceof Date) patch.start = t.start;
      if (t.end instanceof Date) patch.end = t.end;
      if (typeof t.progress === 'number') patch.progress = t.progress;
      if (Object.keys(patch).length === 0) return;
      void cbRef.current.onTaskCommit(String(ev.id), patch);
    });

    // --- 依存（リンク）作成 ---
    api.on('add-link', (ev: AddLinkEvent) => {
      const link = ev.link;
      if (!link) return;
      void cbRef.current.onLinkCreate(String(link.source), String(link.target));
    });

    // --- 依存（リンク）削除 ---
    api.on('delete-link', (ev: DeleteLinkEvent) => {
      void cbRef.current.onLinkDelete(String(ev.id));
    });
  }, []);

  const scales = scaleMode === 'week' ? WEEK_SCALES : DAY_SCALES;
  const cellWidth = scaleMode === 'week' ? 60 : 34;

  return (
    <Willow>
      <Gantt
        tasks={tasks}
        links={links}
        scales={scales}
        columns={columns}
        cellWidth={cellWidth}
        cellHeight={cellHeight}
        init={handleInit}
      />
    </Willow>
  );
}
