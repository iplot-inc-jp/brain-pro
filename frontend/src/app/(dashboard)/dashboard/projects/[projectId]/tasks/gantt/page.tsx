'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  GanttChartSquare,
  ListTodo,
  Link2,
  X,
  Plus,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import {
  tasksApi,
  buildTaskTree,
  computeWbsNumbers,
  collectDescendantIds,
  type Task,
  type TaskDependency,
} from '@/lib/tasks';
import {
  mapTasksToFrappe,
  dateToYmd,
} from '@/components/gantt/frappe-mapping';
import type {
  FrappeGanttProps,
} from '@/components/gantt/FrappeGantt';
import type { FrappeViewMode } from 'frappe-gantt';

// frappe-gantt は DOM 依存のクライアント専用ライブラリのため、SSR を切って動的読み込み。
const FrappeGantt = dynamic<FrappeGanttProps>(
  () => import('@/components/gantt/FrappeGantt'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
      </div>
    ),
  }
);

type ZoomMode = 'day' | 'week' | 'month';

const VIEW_MODE_MAP: Record<ZoomMode, FrappeViewMode> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
};

const ZOOM_OPTIONS: { mode: ZoomMode; label: string; title: string }[] = [
  { mode: 'day', label: '日', title: '日表示（拡大）' },
  { mode: 'week', label: '週', title: '週表示' },
  { mode: 'month', label: '月', title: '月表示（縮小）' },
];

export default function GanttPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState<ZoomMode>('day');

  // 依存関係パネルで編集対象に選ぶタスク。
  const [depTaskId, setDepTaskId] = useState<string>('');
  // 「先行に追加」プルダウンの選択値。
  const [pickPredId, setPickPredId] = useState<string>('');

  // マウスでの依存（矢印）作成: 接続モードと、選択済みの先行タスク。
  const [connectMode, setConnectMode] = useState(false);
  const [pendingFromId, setPendingFromId] = useState<string | null>(null);

  // ガントカードの全画面表示トグル（他ページの全画面と同じ作法）。
  const [isFullscreen, setIsFullscreen] = useState(false);

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
  // ドメイン -> frappe-gantt データ（WBS 表示順）
  // ---------------------------------------------------------------------
  const frappeTasks = useMemo(
    () => mapTasksToFrappe(tasks, dependencies),
    [tasks, dependencies]
  );

  // WBS 番号・表示順（依存関係パネルのラベル・並び用）。
  const tree = useMemo(() => buildTaskTree(tasks), [tasks]);
  const wbs = useMemo(() => computeWbsNumbers(tree), [tree]);

  // WBS 表示順に並べた一覧（id / 表示ラベル）。
  const orderedTaskList = useMemo(() => {
    return [...tasks]
      .map((t) => ({
        id: t.id,
        title: t.title,
        wbs: wbs.get(t.id) ?? '',
      }))
      .sort((a, b) => {
        // WBS 文字列を数値ごとに比較（'1.10' > '1.2'）。
        const pa = a.wbs.split('.').map(Number);
        const pb = b.wbs.split('.').map(Number);
        const len = Math.max(pa.length, pb.length);
        for (let i = 0; i < len; i++) {
          const da = pa[i] ?? 0;
          const db = pb[i] ?? 0;
          if (da !== db) return da - db;
        }
        return a.title.localeCompare(b.title);
      });
  }, [tasks, wbs]);

  const taskLabel = useCallback(
    (id: string) => {
      const t = tasks.find((x) => x.id === id);
      if (!t) return id;
      const num = wbs.get(id);
      return num ? `${num} ${t.title}` : t.title;
    },
    [tasks, wbs]
  );

  // ---------------------------------------------------------------------
  // ガント操作 -> バックエンド
  // ---------------------------------------------------------------------

  // バー移動 / リサイズ確定。frappe の end は終了日「込み」なのでそのまま期限日にする。
  const handleDateChange = useCallback(
    async (id: string, start: Date, end: Date) => {
      try {
        await tasksApi.update(id, {
          startDate: dateToYmd(start),
          dueDate: dateToYmd(end),
        });
        await fetchAll();
      } catch (err) {
        console.error('Failed to update task dates:', err);
        await fetchAll();
      }
    },
    [fetchAll]
  );

  // 進捗ハンドル操作確定。
  const handleProgressChange = useCallback(
    async (id: string, progress: number) => {
      try {
        await tasksApi.update(id, {
          progress: Math.max(0, Math.min(100, Math.round(progress))),
        });
        await fetchAll();
      } catch (err) {
        console.error('Failed to update task progress:', err);
        await fetchAll();
      }
    },
    [fetchAll]
  );

  // バークリック。接続モード OFF なら詳細へ、ON なら矢印を引く 2 クリック操作。
  const handleClick = useCallback(
    (id: string) => {
      // 通常モード: タスク詳細へ移動。
      if (!connectMode) {
        router.push(`/dashboard/projects/${projectId}/tasks/${id}`);
        return;
      }
      // 接続モード 1 クリック目: 先行タスクとして選択。
      if (!pendingFromId) {
        setPendingFromId(id);
        return;
      }
      // 同じバーをもう一度クリック: 取消。
      if (pendingFromId === id) {
        setPendingFromId(null);
        return;
      }
      // 2 クリック目（別バー）: 先行(pendingFromId)→後続(id) の依存を作成。
      const from = pendingFromId;
      const to = id;
      setPendingFromId(null);
      // 同一依存が既にあれば何もしない（重複防止）。逆向きの重複も防ぐ。
      const exists = dependencies.some(
        (d) =>
          (d.predecessorId === from && d.successorId === to) ||
          (d.predecessorId === to && d.successorId === from)
      );
      if (exists) return;
      void (async () => {
        try {
          await tasksApi.addDep(to, from);
          await fetchAll();
        } catch (err) {
          console.error('Failed to add dependency:', err);
          await fetchAll();
        }
      })();
    },
    [connectMode, pendingFromId, dependencies, router, projectId, fetchAll]
  );

  // 接続モードのトグル。OFF にするときは選択中の先行も解除する。
  const toggleConnectMode = useCallback(() => {
    setConnectMode((on) => {
      if (on) setPendingFromId(null);
      return !on;
    });
  }, []);

  // 矢印クリック -> その依存を削除（確認あり）。
  const handleArrowClick = useCallback(
    async (fromId: string, toId: string) => {
      const dep = dependencies.find(
        (d) => d.predecessorId === fromId && d.successorId === toId
      );
      if (!dep) return;
      if (!window.confirm('この依存(矢印)を削除しますか？')) return;
      try {
        await tasksApi.removeDep(dep.id);
        await fetchAll();
      } catch (err) {
        console.error('Failed to remove dependency:', err);
        await fetchAll();
      }
    },
    [dependencies, fetchAll]
  );

  // 親タスクの変更（GUI）。'' は「なし（トップレベル）」= parentId:null。
  const handleParentChange = useCallback(
    async (value: string) => {
      if (!depTaskId) return;
      try {
        await tasksApi.update(depTaskId, { parentId: value || null });
        await fetchAll();
      } catch (err) {
        console.error('Failed to update parent:', err);
        await fetchAll();
      }
    },
    [depTaskId, fetchAll]
  );

  // ESC で接続モードを終了（選択中の先行も解除）。
  useEffect(() => {
    if (!connectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPendingFromId(null);
        setConnectMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connectMode]);

  // ESC で全画面を解除（入力欄フォーカス中は無視）。他ページの全画面と同じ作法。
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        t?.isContentEditable
      ) {
        return;
      }
      setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // ---------------------------------------------------------------------
  // 依存関係パネル -> バックエンド
  // ---------------------------------------------------------------------

  // 先行を追加: addDep(後続Id=選択中タスク, 先行Id=ピック)。
  const handleAddPredecessor = useCallback(async () => {
    if (!depTaskId || !pickPredId) return;
    try {
      await tasksApi.addDep(depTaskId, pickPredId);
      setPickPredId('');
      await fetchAll();
    } catch (err) {
      console.error('Failed to add dependency:', err);
      await fetchAll();
    }
  }, [depTaskId, pickPredId, fetchAll]);

  // 依存を削除: removeDep(dependency.id)。
  const handleRemoveDep = useCallback(
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

  // 選択中タスクを後続とする既存依存（先行リスト）。
  const currentDeps = useMemo(
    () => dependencies.filter((d) => d.successorId === depTaskId),
    [dependencies, depTaskId]
  );

  // 先行候補: 自分・自分の子孫・既に先行になっているものを除外（循環/重複防止）。
  const predecessorCandidates = useMemo(() => {
    if (!depTaskId) return [];
    const descendants = collectDescendantIds(tasks, depTaskId);
    const already = new Set(currentDeps.map((d) => d.predecessorId));
    return orderedTaskList.filter(
      (t) =>
        t.id !== depTaskId && !descendants.has(t.id) && !already.has(t.id)
    );
  }, [depTaskId, tasks, currentDeps, orderedTaskList]);

  // 親タスク候補: 自分・自分の子孫を除外（循環防止）。WBS 表示順。
  const parentCandidates = useMemo(() => {
    if (!depTaskId) return [];
    const descendants = collectDescendantIds(tasks, depTaskId);
    return orderedTaskList.filter(
      (t) => t.id !== depTaskId && !descendants.has(t.id)
    );
  }, [depTaskId, tasks, orderedTaskList]);

  // 選択中タスクの現在の親 id（なしは ''）。Select の value 用。
  const currentParentId = useMemo(
    () => tasks.find((t) => t.id === depTaskId)?.parentId ?? '',
    [tasks, depTaskId]
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
        description="バーをドラッグで移動・端を掴んでリサイズ・進捗ハンドルで進捗を編集できます（変更は即保存）。「依存を追加」ボタンの接続モードでバーを2回クリックすると矢印（依存）が引け、矢印クリックで削除できます。親子関係・依存は下のパネルでも編集できます。"
        help="左の WBS 一覧と右のタイムラインが同じ行で並びます。バーは開始日〜期限、塗りは進捗です。バーをドラッグすると開始日・期限が、端のハンドルで期間が、進捗ハンドルで進捗が更新され、すべて自動でサーバに保存されます。マウスでの依存編集は、(1)「依存を追加」ボタンで接続モードにし先行→後続の順にバーを2クリックして矢印を引く、(2) 矢印をクリックすると確認のうえ依存を削除、で行えます。通常モードではバークリックでタスク詳細へ移動します。親子関係（親タスク）は下のパネルのセレクトで変更できます。"
        backHref={`/dashboard/projects/${projectId}/tasks`}
        backLabel="タスク管理に戻る"
        actions={
          <>
            <HowToPanel
              steps={[
                'バー本体を左右にドラッグすると、開始日と期限がスライドして即保存されます。',
                'バーの左右の端を掴んでドラッグすると、開始日／期限だけを伸縮できます。',
                'バー上の進捗ハンドル（バー右端の小さなつまみ）をドラッグすると進捗％が更新されます。',
                '「依存を追加」ボタンで接続モードにし、先行タスク→後続タスクの順にバーを2回クリックすると依存（矢印）が引けます（ESC で終了）。',
                '依存の矢印をクリックすると、確認のうえその依存を削除できます。',
                '親子関係は下のパネルの「親タスク」セレクトで変更できます（依存の追加・削除も同パネルで可能）。',
                '通常モードではバー本体のクリックでタスク詳細へ移動します。',
                '右上の「日 / 週 / 月」で目盛りの粒度を切り替えられます。',
              ]}
            />
            <ManualButton feature="tasks-gantt" />
            <Button
              type="button"
              variant={connectMode ? 'default' : 'outline'}
              onClick={toggleConnectMode}
              className={`gap-1.5 ${
                connectMode ? 'bg-blue-600 text-white hover:bg-blue-700' : ''
              }`}
              title="接続モード: 先行→後続の順にバーを2回クリックして依存（矢印）を引く"
              aria-pressed={connectMode}
            >
              <Link2 className="h-4 w-4" />
              依存を追加
            </Button>
            <Link href={`/dashboard/projects/${projectId}/tasks`}>
              <Button variant="outline" className="gap-1.5">
                <ListTodo className="h-4 w-4" />
                タスク一覧
              </Button>
            </Link>
            <div className="flex items-center rounded-md border border-gray-300 bg-white p-0.5">
              {ZOOM_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setZoom(opt.mode)}
                  className={`flex items-center gap-1 rounded px-2.5 py-1 text-sm transition-colors ${
                    zoom === opt.mode
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                  title={opt.title}
                >
                  {opt.label}
                </button>
              ))}
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
        <>
          {/* 接続モードのヒントバナー */}
          {connectMode && (
            <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <Link2 className="h-4 w-4 shrink-0" />
              <span>
                先行タスクのバー→後続タスクのバーの順にクリックすると依存(矢印)が引けます。もう一度同じバーで取消、ESC/もう一度ボタンで終了。
              </span>
            </div>
          )}

          {/*
            ガントカード。frappe-gantt 自身が内部スクロール（.gantt-container）を
            持つため、外側カードでは overflow-auto を重ねない（二重スクロール＝
            ドラッグで外側が動く不具合の一因になるため）。relative + 全画面ボタン。
          */}
          <Card
            className={
              isFullscreen
                ? 'fixed inset-0 z-50 flex flex-col overflow-hidden rounded-none border-0 bg-white'
                : 'relative border-gray-200 bg-white'
            }
          >
            {/* 全画面トグル（右上オーバーレイ）。 */}
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="absolute right-2 top-2 z-20 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              title={isFullscreen ? '全画面を解除（Esc）' : '全画面表示'}
              aria-pressed={isFullscreen}
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
              {isFullscreen ? '縮小' : '全画面'}
            </button>

            {/*
              frappe-gantt（クライアント専用・SSR 無効）。
              全画面切替でコンテナ幅が変わるので key を変えて再マウントし、
              新しい幅で確実に再描画させる。全画面時は残り高さいっぱいに広げ、
              内側の .gantt-container がスクロールする。
            */}
            <div
              key={isFullscreen ? 'fs' : 'normal'}
              className={`gantt-host ${connectMode ? 'gantt-connect' : ''} ${
                isFullscreen ? 'min-h-0 flex-1 overflow-auto' : ''
              }`}
              style={isFullscreen ? undefined : { minHeight: 420 }}
            >
              <FrappeGantt
                tasks={frappeTasks}
                viewMode={VIEW_MODE_MAP[zoom]}
                onDateChange={handleDateChange}
                onProgressChange={handleProgressChange}
                onClick={handleClick}
                onArrowClick={handleArrowClick}
                mode={connectMode ? 'connect' : 'navigate'}
                pendingFromId={pendingFromId}
              />
            </div>
          </Card>

          {/* 親子関係・依存関係パネル（マウス操作のフォールバック兼 親タスク編集） */}
          <Card className="border-gray-200 bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <Link2 className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-gray-800">
                親子関係・依存関係
              </h2>
              <span className="text-xs text-gray-400">
                タスクを選んで、親タスク（WBSの親子）と「先行」タスク（先行→後続の矢印）を編集します。
              </span>
            </div>

            <div className="mb-4 max-w-md">
              <label className="mb-1 block text-xs font-medium text-gray-500">
                対象タスク（後続）
              </label>
              <Select value={depTaskId} onValueChange={setDepTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="タスクを選択…" />
                </SelectTrigger>
                <SelectContent>
                  {orderedTaskList.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.wbs ? `${t.wbs} ${t.title}` : t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {depTaskId ? (
              <div className="space-y-4">
                {/* 親タスク（WBS の親子関係）の変更 */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    親タスク
                  </p>
                  <div className="max-w-md">
                    <Select
                      // 「なし」は内部的に '__root__'（空文字は Select の placeholder と衝突するため）。
                      value={currentParentId || '__root__'}
                      onValueChange={(v) =>
                        handleParentChange(v === '__root__' ? '' : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="親タスクを選択…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__root__">
                          なし（トップレベル）
                        </SelectItem>
                        {parentCandidates.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.wbs ? `${t.wbs} ${t.title}` : t.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 既存の先行リスト */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    現在の先行タスク
                  </p>
                  {currentDeps.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      先行タスクはありません
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {currentDeps.map((d) => (
                        <li
                          key={d.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 py-1 pl-3 pr-1.5 text-sm text-blue-700"
                        >
                          <span>{taskLabel(d.predecessorId)}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveDep(d.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-blue-400 transition-colors hover:bg-blue-100 hover:text-blue-700"
                            title="この依存を削除"
                            aria-label="この依存を削除"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* 先行を追加 */}
                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-500">
                    先行タスクを追加
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[16rem] flex-1">
                      <Select
                        value={pickPredId}
                        onValueChange={setPickPredId}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="先行にするタスクを選択…" />
                        </SelectTrigger>
                        <SelectContent>
                          {predecessorCandidates.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-400">
                              追加できるタスクがありません
                            </div>
                          ) : (
                            predecessorCandidates.map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.wbs ? `${t.wbs} ${t.title}` : t.title}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      onClick={handleAddPredecessor}
                      disabled={!pickPredId}
                      className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                    >
                      <Plus className="h-4 w-4" />
                      追加
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                まずは上で対象タスクを選択してください。
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
