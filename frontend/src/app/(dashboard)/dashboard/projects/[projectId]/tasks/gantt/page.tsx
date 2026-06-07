'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import {
  Loader2,
  GanttChartSquare,
  ZoomIn,
  ZoomOut,
  ListTodo,
} from 'lucide-react';
import {
  tasksApi,
  buildTaskTree,
  computeWbsNumbers,
  type Task,
  type TaskDependency,
} from '@/lib/tasks';
import {
  mapTasksToSvar,
  mapDepsToSvar,
  dateToYmd,
} from '@/components/gantt/svar-mapping';
import type {
  SvarGanttScaleMode,
  SvarGanttProps,
} from '@/components/gantt/SvarGantt';
import type { SvarColumn } from 'wx-react-gantt';

// SVAR Gantt は DOM 依存のクライアント専用ライブラリのため、SSR を切って動的読み込み。
const SvarGantt = dynamic<SvarGanttProps>(
  () => import('@/components/gantt/SvarGantt'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </div>
    ),
  }
);

// 左側グリッドの列定義（WBS 表示）。
const GANTT_COLUMNS: SvarColumn[] = [
  { id: 'text', header: 'WBS / タスク名', flexgrow: 2, width: 280 },
  { id: 'start', header: '開始', align: 'center', width: 96 },
  { id: 'duration', header: '日数', align: 'center', width: 64 },
];

const ROW_HEIGHT = 36;

export default function GanttPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<SvarGanttScaleMode>('day');

  // ---------------------------------------------------------------------
  // データ取得
  // ---------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    try {
      const data = await tasksApi.list(projectId);
      setTasks(data.tasks ?? []);
      setDependencies(data.dependencies ?? []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ---------------------------------------------------------------------
  // ドメイン -> SVAR データ
  // ---------------------------------------------------------------------
  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const wbs = useMemo(() => computeWbsNumbers(tree), [tree]);

  const svarTasks = useMemo(
    () => mapTasksToSvar(tasks, { wbsNumbers: wbs }),
    [tasks, wbs]
  );
  const svarLinks = useMemo(() => mapDepsToSvar(dependencies), [dependencies]);

  // ---------------------------------------------------------------------
  // インタラクション -> バックエンド
  // ---------------------------------------------------------------------

  // バー移動 / リサイズ / 進捗変更（確定時）。
  const handleTaskCommit = useCallback(
    async (
      id: string,
      patch: { start?: Date; end?: Date; progress?: number }
    ) => {
      const body: {
        startDate?: string;
        dueDate?: string;
        progress?: number;
      } = {};
      if (patch.start) body.startDate = dateToYmd(patch.start);
      if (patch.end) {
        // SVAR の end は「終了日の翌日 0:00（排他）」を指すため 1 日戻して期限日にする。
        const due = new Date(patch.end.getTime() - 24 * 60 * 60 * 1000);
        body.dueDate = dateToYmd(due);
      }
      if (typeof patch.progress === 'number') {
        body.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
      }
      if (Object.keys(body).length === 0) return;
      try {
        await tasksApi.update(id, body);
        await fetchAll();
      } catch (err) {
        console.error('Failed to update task:', err);
        // 失敗時はサーバ状態へ戻すため再取得
        await fetchAll();
      }
    },
    [fetchAll]
  );

  // 依存（リンク）作成: source=先行, target=後続。
  // 我々の API は addDep(後続Id, 先行Id)。
  const handleLinkCreate = useCallback(
    async (predecessorId: string, successorId: string) => {
      try {
        await tasksApi.addDep(successorId, predecessorId);
        await fetchAll();
      } catch (err) {
        console.error('Failed to add dependency:', err);
        await fetchAll();
      }
    },
    [fetchAll]
  );

  // 依存（リンク）削除: link.id = 我々の dependency.id。
  const handleLinkDelete = useCallback(
    async (dependencyId: string) => {
      try {
        await tasksApi.removeDep(dependencyId);
        await fetchAll();
      } catch (err) {
        console.error('Failed to remove dependency:', err);
        await fetchAll();
      }
    },
    [fetchAll]
  );

  // ---------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <GanttChartSquare className="h-5 w-5 text-blue-600" />
            WBS / ガントチャート
          </span>
        }
        description="バーをドラッグで移動・端を掴んでリサイズ・進捗ハンドルで進捗、バー間をつないで依存関係を編集できます（変更は即保存）"
        help="左の WBS グリッドと右のタイムラインが同じ行で並びます。バーは開始日〜期限、塗りは進捗、親行は子の範囲をまとめたサマリーバーです。バーをドラッグすると開始日・期限が、端のハンドルで期間が、進捗ハンドルで進捗が更新され、バー同士をつなぐと先行→後続の依存（矢印）が作成されます。すべて自動でサーバに保存されます。"
        backHref={`/dashboard/projects/${projectId}/tasks`}
        backLabel="タスク管理に戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                'バー本体を左右にドラッグすると、開始日と期限がスライドして即保存されます。',
                'バーの左右の端を掴んでドラッグすると、開始日／期限だけを伸縮できます。',
                'バー上の進捗ハンドル（左下の丸）をドラッグすると進捗％が更新されます。',
                'バーの端から別のバーへドラッグして離すと、先行→後続の依存関係（矢印）が作成されます。',
                '依存線（矢印）をクリックして削除すると、依存関係が解除されます。',
                '親（サマリー）行は子タスクの範囲を自動でまとめて表示します。',
                '右上の「日 / 週」で目盛りの粒度を切り替えられます。',
              ]}
            />
            <Link href={`/dashboard/projects/${projectId}/tasks`}>
              <Button variant="outline" className="gap-1.5">
                <ListTodo className="h-4 w-4" />
                タスク一覧
              </Button>
            </Link>
            <div className="flex items-center rounded-md border border-gray-300 bg-white p-0.5">
              <button
                type="button"
                onClick={() => setZoom('day')}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-sm transition-colors ${
                  zoom === 'day'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title="日表示（拡大）"
              >
                <ZoomIn className="h-3.5 w-3.5" />日
              </button>
              <button
                type="button"
                onClick={() => setZoom('week')}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-sm transition-colors ${
                  zoom === 'week'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                title="週表示（縮小）"
              >
                <ZoomOut className="h-3.5 w-3.5" />週
              </button>
            </div>
          </>
        }
      />

      {tasks.length === 0 ? (
        <Card className="border-gray-200 bg-white">
          <div className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <GanttChartSquare className="h-8 w-8 text-gray-400" />
            </div>
            <p className="mb-2 text-gray-500">タスクがありません</p>
            <p className="mb-4 text-sm text-gray-400">
              タスク管理画面で WBS を作成するとガントに反映されます
            </p>
            <Link href={`/dashboard/projects/${projectId}/tasks`}>
              <Button className="bg-blue-600 hover:bg-blue-700">
                タスク管理へ
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden border-gray-200 bg-white">
          {/* SVAR Gantt（クライアント専用・SSR 無効） */}
          <div className="gantt-host" style={{ height: '70vh', minHeight: 420 }}>
            <SvarGantt
              tasks={svarTasks}
              links={svarLinks}
              columns={GANTT_COLUMNS}
              scaleMode={zoom}
              cellHeight={ROW_HEIGHT}
              onTaskCommit={handleTaskCommit}
              onLinkCreate={handleLinkCreate}
              onLinkDelete={handleLinkDelete}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
