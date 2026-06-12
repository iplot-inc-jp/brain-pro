'use client';

/**
 * ER図ページ。
 *
 * データカタログのテーブル（カラム含む）をERエンティティカードとして描き、
 * データオブジェクト（DFDデータストア／オブジェクト関係性マップと共通のマスタ）を
 * **点線の角丸囲み**としてグルーピング表示する。
 *
 * - GET /er-graph で objects / tables(columns) / fkEdges / relations を取得し SVG キャンバスに描画
 * - テーブルのドラッグ → erPosition をデバウンス一括保存（PUT /er-positions）
 * - 表示モード切替（全カラム / キーのみ / テーブル名のみ）・自動整列・ズーム/パン
 * - キャンバス下の一覧パネルで「所属オブジェクト」を即時変更（PUT /tables/:id/data-object）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Boxes, Database, DownloadCloud, Loader2, Plus, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { dataObjectApi, type ErGraphDto } from '@/lib/data-objects';
import { DEFAULT_OBJECT_COLOR, OBJECT_COLORS } from '../object-map/_components/object-map-shared';
import { ErCanvas } from './_components/ErCanvas';
import { TableListPanel } from './_components/TableListPanel';
import { CreateObjectDialog } from './_components/CreateObjectDialog';
import { computeAutoArrange, type ErDisplayMode, type Point } from './_components/er-layout';

/** ドラッグ後の位置保存デバウンス（ms） */
const SAVE_DEBOUNCE_MS = 800;

export default function ErDiagramPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [graph, setGraph] = useState<ErGraphDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 操作系（保存・紐づけ）の軽微なエラー。キャンバスは生かしたままバナー表示する */
  const [actionError, setActionError] = useState<string | null>(null);

  const [mode, setMode] = useState<ErDisplayMode>('all');

  // テーブル位置（ローカルが正。ドラッグで更新し、デバウンスでサーバへ一括保存）
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savingPositions, setSavingPositions] = useState(false);

  const [arranging, setArranging] = useState(false);
  const [savingLinkTableId, setSavingLinkTableId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // オブジェクト作成ダイアログ。一覧パネルの select「＋新規作成」起点のときは
  // pendingLinkTableId に紐づけ先テーブルIDを保持し、作成後にそのテーブルへ紐づける。
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [pendingLinkTableId, setPendingLinkTableId] = useState<string | null>(null);

  // ===== 取得 =====

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const g = await dataObjectApi.getErGraph(projectId);
      setGraph(g);

      // 位置の初期化。未配置（全テーブルが原点に固まっている）の場合は
      // ローカルで自動整列して見える状態にする（保存は「自動整列」ボタンで明示的に）。
      const init: Record<string, Point> = {};
      for (const t of g.tables) init[t.id] = { x: t.erPositionX, y: t.erPositionY };
      const allAtOrigin =
        g.tables.length > 0 && g.tables.every((t) => t.erPositionX === 0 && t.erPositionY === 0);
      if (allAtOrigin) {
        const arranged = computeAutoArrange(g.objects, g.tables);
        arranged.forEach((p, id) => {
          init[id] = p;
        });
      }
      // 未保存（dirty）のドラッグ位置はローカル値を優先し、サーバ値で巻き戻さない。
      // dirty のままにしておけば、保留中のデバウンス保存／次回の flush で保存される。
      for (const id of Array.from(dirtyIdsRef.current)) {
        if (!(id in init)) {
          // テーブル自体が消えていたら保存対象がないので破棄
          dirtyIdsRef.current.delete(id);
          continue;
        }
        const p = positionsRef.current[id];
        if (p) init[id] = p;
      }
      setPositions(init);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ER図の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // アンマウント時にデバウンスタイマーを破棄
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // ===== 位置保存（デバウンス一括） =====

  const flushSavePositions = useCallback(async () => {
    const ids = Array.from(dirtyIdsRef.current);
    if (ids.length === 0) return;
    const items = ids
      .map((id) => {
        const p = positionsRef.current[id];
        return p ? { id, positionX: p.x, positionY: p.y } : null;
      })
      .filter((v): v is { id: string; positionX: number; positionY: number } => v !== null);
    if (items.length === 0) return;
    setSavingPositions(true);
    try {
      await dataObjectApi.saveErPositions(projectId, items);
      ids.forEach((id) => dirtyIdsRef.current.delete(id));
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ER図位置の保存に失敗しました');
    } finally {
      setSavingPositions(false);
    }
  }, [projectId]);

  const scheduleSavePositions = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushSavePositions();
    }, SAVE_DEBOUNCE_MS);
  }, [flushSavePositions]);

  const handleMoveTable = useCallback((tableId: string, position: Point) => {
    dirtyIdsRef.current.add(tableId);
    setPositions((prev) => ({ ...prev, [tableId]: position }));
  }, []);

  const handleDragEnd = useCallback(() => {
    scheduleSavePositions();
  }, [scheduleSavePositions]);

  // ===== 自動整列 =====

  const handleAutoArrange = useCallback(async () => {
    if (!graph) return;
    setArranging(true);
    try {
      const arranged = computeAutoArrange(graph.objects, graph.tables);
      const next: Record<string, Point> = { ...positionsRef.current };
      const items: { id: string; positionX: number; positionY: number }[] = [];
      arranged.forEach((p, id) => {
        next[id] = p;
        items.push({ id, positionX: p.x, positionY: p.y });
      });
      setPositions(next);
      if (items.length > 0) {
        await dataObjectApi.saveErPositions(projectId, items);
      }
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'ER図位置の保存に失敗しました');
    } finally {
      setArranging(false);
    }
  }, [graph, projectId]);

  // ===== テーブル ⇄ オブジェクト紐づけ（一覧パネルから即時保存） =====

  const handleLinkChange = useCallback(
    async (tableId: string, dataObjectId: string | null) => {
      if (!graph) return;
      const prevValue = graph.tables.find((t) => t.id === tableId)?.dataObjectId ?? null;
      if (prevValue === dataObjectId) return;
      // 楽観更新（点線囲み・一覧グルーピングへ即反映）
      setGraph((g) =>
        g
          ? { ...g, tables: g.tables.map((t) => (t.id === tableId ? { ...t, dataObjectId } : t)) }
          : g,
      );
      setSavingLinkTableId(tableId);
      try {
        await dataObjectApi.linkTableToObject(tableId, dataObjectId);
        setActionError(null);
      } catch (err) {
        // 失敗したら巻き戻す
        setGraph((g) =>
          g
            ? {
                ...g,
                tables: g.tables.map((t) =>
                  t.id === tableId ? { ...t, dataObjectId: prevValue } : t,
                ),
              }
            : g,
        );
        setActionError(err instanceof Error ? err.message : 'テーブルの紐づけに失敗しました');
      } finally {
        setSavingLinkTableId(null);
      }
    },
    [graph],
  );

  // ===== オブジェクト新規作成（ダイアログ → 共通マスタとして作成） =====

  /** ダイアログを開く。fromTableId 指定時は作成後にそのテーブルへ紐づける */
  const openCreateDialog = useCallback((fromTableId: string | null = null) => {
    setPendingLinkTableId(fromTableId);
    setCreateDialogOpen(true);
  }, []);

  const handleCreateDialogOpenChange = useCallback((open: boolean) => {
    setCreateDialogOpen(open);
    // 閉じたら（キャンセル含む）紐づけ予約はクリア
    if (!open) setPendingLinkTableId(null);
  }, []);

  const handleCreateObject = useCallback(
    async (name: string, description: string) => {
      // object-map ページの handleAddObject と同じ既定値（色・グリッド座標・order）。
      // 関係性マップ上にも整然と現れるようにする。
      const count = graph?.objects.length ?? 0;
      // 作成失敗はそのまま throw し、ダイアログ側で表示する（開いたまま・入力保持）
      const created = await dataObjectApi.createObject(projectId, {
        name,
        description: description || undefined,
        color: OBJECT_COLORS[count % OBJECT_COLORS.length] ?? DEFAULT_OBJECT_COLOR,
        positionX: 80 + (count % 4) * 240,
        positionY: 80 + Math.floor(count / 4) * 150,
        order: count,
      });
      // select の「＋新規作成」起点なら、作成と同時にそのテーブルを紐づける。
      // 紐づけだけ失敗してもオブジェクトは作成済みなので、バナー表示に留めて
      // load() は必ず実行する（作成結果を ER 図・一覧へ反映し、再試行での重複作成を防ぐ）。
      try {
        if (pendingLinkTableId) {
          await dataObjectApi.linkTableToObject(pendingLinkTableId, created.id);
        }
        setActionError(null);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'テーブルの紐づけに失敗しました');
      }
      await load();
    },
    [graph, projectId, pendingLinkTableId, load],
  );

  // ===== DFDから取り込み（オブジェクト0件のときの導線） =====

  const handleImportFromDfd = useCallback(async () => {
    setImporting(true);
    try {
      await dataObjectApi.importFromDfd(projectId);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'DFDからの取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  }, [projectId, load]);

  const hasTables = (graph?.tables.length ?? 0) > 0;
  const hasObjects = (graph?.objects.length ?? 0) > 0;

  const fkEdgeCount = graph?.fkEdges.length ?? 0;
  const summary = useMemo(() => {
    if (!graph) return '';
    return `オブジェクト ${graph.objects.length} / テーブル ${graph.tables.length} / FK ${fkEdgeCount} / 関係 ${graph.relations.length}`;
  }, [graph, fkEdgeCount]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ER図"
        description="データカタログのテーブルをER図として描き、データオブジェクト（点線囲み）でグルーピングします。"
        help="テーブル＝ERエンティティカード、オブジェクト＝点線の角丸囲みです。FK参照はカード間の実線、オブジェクト間の関係（関係性マップで定義）は囲み同士の点線＋カーディナリティ（1-1 / 1-N / N-N）で表します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <Button className="bg-blue-600 hover:bg-blue-700" onClick={() => openCreateDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              オブジェクト追加
            </Button>
            <HowToPanel
              title="ER図の使い方"
              steps={[
                'テーブルカードをドラッグして配置できます（位置は自動保存）。所属オブジェクトの点線囲みはドラッグに追従します。',
                'ツールバーで「全カラム / キーのみ / テーブル名のみ」の表示を切り替えられます。FKエッジはカードの高さに追従します。',
                '「自動整列」でオブジェクトごとにテーブルをグリッド配置します（オブジェクトは横並び、未分類は右端）。',
                'キャンバス下の一覧パネルで各テーブルの「所属オブジェクト」を変更すると即時保存され、囲みに反映されます。',
                '「オブジェクト追加」でデータオブジェクトを新規作成できます。一覧パネルの所属 select の「＋ 新規オブジェクトを作成…」なら、作成と同時にそのテーブルが紐づきます。',
                'カラムのFK（参照先テーブル）はデータカタログの各テーブル詳細で編集できます。',
              ]}
            />
            <ManualButton feature="er-diagram" />
          </>
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <Share2 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <p className="text-sm text-indigo-800">
          データオブジェクトは、DFDのデータストア・オブジェクト関係性マップ・ER図の囲みを貫く共通マスタです。
          {summary && <span className="ml-2 text-indigo-600">（{summary}）</span>}
        </p>
      </div>

      {actionError && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm text-red-600">{actionError}</p>
          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setActionError(null)}>
            閉じる
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card className="bg-white border-red-200">
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-red-600">{error}</p>
            <Button variant="outline" onClick={() => void load()}>
              再読み込み
            </Button>
          </CardContent>
        </Card>
      ) : !hasTables ? (
        // 空状態: テーブル0件 → データカタログへ誘導
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
              <Database className="h-8 w-8 text-gray-400" />
            </div>
            <p className="mb-2 text-gray-500">テーブルがまだありません</p>
            <p className="mb-4 text-center text-sm text-gray-400">
              ER図はデータカタログのテーブル・カラムから描かれます。
              <br />
              まずデータカタログでDB直結・スキーマ取り込み(AI)・手動作成のいずれかでテーブルを登録してください。
            </p>
            <Link href={`/dashboard/projects/${projectId}/catalog`}>
              <Button className="bg-blue-600 hover:bg-blue-700">
                <Database className="mr-2 h-4 w-4" />
                データカタログへ
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <>
          {!hasObjects && (
            // 空状態: オブジェクト0件 → 関係性マップ / DFD取り込みへ誘導（テーブルは未分類として描画中）
            <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2">
                <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                <p className="text-sm text-amber-800">
                  データオブジェクトが未定義のため、全テーブルを「未分類」として表示しています。
                  オブジェクト関係性マップで定義するか、第1レベルDFDのデータストアから取り込めます。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-700 hover:bg-amber-100"
                  onClick={() => openCreateDialog()}
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  オブジェクトを追加
                </Button>
                <Link href={`/dashboard/projects/${projectId}/object-map`}>
                  <Button variant="outline" size="sm" className="border-amber-300 text-amber-700 hover:bg-amber-100">
                    <Boxes className="mr-1.5 h-4 w-4" />
                    関係性マップへ
                  </Button>
                </Link>
                <Button
                  size="sm"
                  className="bg-amber-600 hover:bg-amber-700"
                  onClick={handleImportFromDfd}
                  disabled={importing}
                >
                  {importing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <DownloadCloud className="mr-1.5 h-4 w-4" />
                  )}
                  DFDから取り込み
                </Button>
              </div>
            </div>
          )}

          {/* SVGキャンバス */}
          <div className="h-[calc(100vh-340px)] min-h-[480px] overflow-hidden rounded-lg border border-gray-200">
            {graph && (
              <ErCanvas
                graph={graph}
                positions={positions}
                mode={mode}
                onModeChange={setMode}
                onMoveTable={handleMoveTable}
                onDragEnd={handleDragEnd}
                onAutoArrange={() => void handleAutoArrange()}
                arranging={arranging}
                savingPositions={savingPositions}
              />
            )}
          </div>

          {/* 一覧パネル（オブジェクト別グルーピング＋所属変更） */}
          {graph && (
            <TableListPanel
              projectId={projectId}
              objects={graph.objects}
              tables={graph.tables}
              savingLinkTableId={savingLinkTableId}
              onLinkChange={(tableId, dataObjectId) => void handleLinkChange(tableId, dataObjectId)}
              onCreateForTable={(tableId) => openCreateDialog(tableId)}
            />
          )}
        </>
      )}

      {/* オブジェクト作成ダイアログ（共通マスタとして作成。select 起点なら作成後に紐づけ） */}
      <CreateObjectDialog
        open={createDialogOpen}
        onOpenChange={handleCreateDialogOpenChange}
        onSubmit={handleCreateObject}
      />
    </div>
  );
}
