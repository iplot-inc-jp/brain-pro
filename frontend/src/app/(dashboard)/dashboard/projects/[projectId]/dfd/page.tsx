'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Boxes, Loader2, Network, Table2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { useToast } from '@/components/ui/use-toast';
import { DfdCanvas } from '@/components/dfd/DfdCanvas';
import { DataFlowTable } from '@/components/dfd/DataFlowTable';
import { InformationTypeRegistry } from '@/components/dfd/InformationTypeRegistry';
import {
  dfdApi,
  type DfdDiagram,
  type DfdNode as DfdNodeModel,
  type DfdFlow as DfdFlowModel,
  type DfdNodeKind,
  type DfdAnnotation,
  type DfdAnnotationKind,
  type InformationType,
} from '@/lib/dfd';
import { dataObjectApi, type DataObjectDto } from '@/lib/data-objects';
import { useReadOnly } from '@/components/read-only-context';
import { EditGate } from '@/components/edit-gate';
import { ExportImportButton } from '@/components/io/ExportImportButton';
import { entityJsonIo, type EntityBundle } from '@/lib/io';

/**
 * 第1レベルDFD（プロジェクト全体）。
 * FUNCTION ノード = プロジェクトの業務フロー群、データフロー = フロー間連携(FlowNodeLink)。
 * FUNCTION ノードを開くと第2レベル（flows/[refFlowId]?tab=dfd）へドリルダウンする。
 */
export default function ProjectDfdPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const { toast } = useToast();
  const { canEdit } = useReadOnly();
  // 閲覧専用時に編集系コールバックを無効化（DfdCanvas は全て ?. 呼び）。
  const ro = <T,>(fn: T): T | undefined => (canEdit ? fn : undefined);

  const [diagram, setDiagram] = useState<DfdDiagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'diagram' | 'table'>('diagram');
  const [informationTypes, setInformationTypes] = useState<InformationType[]>([]);
  // オブジェクト（共通マスタ）一覧。DATA_STORE ノードの紐づけセレクタ・バッジに使う。
  const [dataObjects, setDataObjects] = useState<DataObjectDto[]>([]);
  // 注釈（付箋・メモ）。diagram.nodes/flows とは別系統（再生成の影響を受けない）。
  const [annotations, setAnnotations] = useState<DfdAnnotation[]>([]);
  // 未統合データストア → オブジェクト統合（import-from-dfd）の実行中フラグ。
  const [integrating, setIntegrating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await dfdApi.getByProject(projectId);
      setDiagram(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // オブジェクト（共通マスタ）を取得（失敗してもDFD表示は継続）
  const loadDataObjects = useCallback(async () => {
    try {
      const graph = await dataObjectApi.getGraph(projectId);
      setDataObjects(graph.objects);
    } catch (err) {
      console.error('Failed to fetch data objects:', err);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
    void loadDataObjects();
  }, [load, loadDataObjects]);

  // 注釈（付箋・メモ）一覧を取得（GET /dfd-diagrams/:diagramId/annotations）。
  // 取得失敗はDFD描画の致命ではない（付箋が出ないだけ）。
  const fetchAnnotations = useCallback(async (diagramId: string) => {
    try {
      const list = await dfdApi.listAnnotations(diagramId);
      setAnnotations(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to fetch annotations:', err);
    }
  }, []);

  const diagramId = diagram?.id ?? null;
  useEffect(() => {
    if (diagramId) void fetchAnnotations(diagramId);
  }, [diagramId, fetchAnnotations]);

  // ===========================================
  // 注釈（付箋・メモ）の追加・更新・削除
  // 成功後は annotations 状態を楽観更新（位置/本文の小刻みな更新で再取得を避けちらつきを防ぐ）。
  // ===========================================
  const handleAddAnnotation = useCallback(
    async (kind: DfdAnnotationKind, init: { positionX: number; positionY: number }) => {
      if (!diagramId) return;
      try {
        const created = await dfdApi.addAnnotation(diagramId, {
          kind,
          text: '',
          positionX: init.positionX,
          positionY: init.positionY,
        });
        setAnnotations((prev) => [...prev, created]);
      } catch (err) {
        console.error('Failed to create annotation:', err);
      }
    },
    [diagramId],
  );

  const handleUpdateAnnotation = useCallback(
    async (id: string, patch: Partial<Omit<DfdAnnotation, 'id'>>) => {
      if (!diagramId) return;
      // 楽観更新（ドラッグ移動・本文編集が即座に反映され、再取得のちらつきを避ける）
      setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      try {
        await dfdApi.updateAnnotation(id, patch);
      } catch (err) {
        console.error('Failed to update annotation:', err);
        // 失敗時はサーバ状態へ戻す
        void fetchAnnotations(diagramId);
      }
    },
    [diagramId, fetchAnnotations],
  );

  const handleDeleteAnnotation = useCallback(
    async (id: string) => {
      if (!diagramId) return;
      // 楽観更新（削除を即座に反映）
      setAnnotations((prev) => prev.filter((a) => a.id !== id));
      try {
        await dfdApi.deleteAnnotation(id);
      } catch (err) {
        console.error('Failed to delete annotation:', err);
        void fetchAnnotations(diagramId);
      }
    },
    [diagramId, fetchAnnotations],
  );

  // 未統合データストア → オブジェクト統合（既存の import-from-dfd API。冪等）。
  // 成功したら件数をトーストで知らせ、DFD（unlinkedDataStoreCount）とオブジェクト一覧を再取得する。
  const handleIntegrateDataStores = useCallback(async () => {
    setIntegrating(true);
    try {
      const result = await dataObjectApi.importFromDfd(projectId);
      toast({
        title: 'データストアをオブジェクトに統合しました',
        description: `新規作成 ${result.created}件 / DFDノード紐づけ ${result.linked}件`,
      });
      await load();
      await loadDataObjects();
    } catch (err) {
      toast({
        variant: 'destructive',
        title: err instanceof Error ? err.message : 'オブジェクトへの統合に失敗しました',
      });
    } finally {
      setIntegrating(false);
    }
  }, [projectId, toast, load, loadDataObjects]);

  const handleRegenerate = useCallback(async () => {
    setBusy(true);
    try {
      const d = await dfdApi.generateByProject(projectId);
      setDiagram(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const handleAddNode = useCallback(
    async (body: Partial<DfdNodeModel> & { kind: DfdNodeKind; label: string }) => {
      if (!diagram) return;
      await dfdApi.addNode(diagram.id, body);
      await load();
      // DATA_STORE は backend が同名オブジェクトを get-or-create して自動リンクするため、
      // オブジェクト一覧も再取得してバッジ・セレクタへ即反映する。
      if (body.kind === 'DATA_STORE') await loadDataObjects();
    },
    [diagram, load, loadDataObjects],
  );

  const handleUpdateNode = useCallback(
    async (id: string, patch: Partial<DfdNodeModel>) => {
      await dfdApi.updateNode(id, patch);
      await load();
      // label 変更はリンク済みオブジェクトの rename（衝突時はリンク付け替え）になるため、
      // オブジェクト一覧も再取得して名前のズレを防ぐ。
      if (patch.label !== undefined || patch.dataObjectId !== undefined) await loadDataObjects();
    },
    [load, loadDataObjects],
  );

  const handleDeleteNode = useCallback(
    async (id: string) => {
      await dfdApi.deleteNode(id);
      await load();
    },
    [load],
  );

  // データフロー追加（矢印を引く）。**楽観更新**で、サーバが返した実体（実IDの flow）を
  // ローカル diagram.flows に追記し、ブロッキングな再取得（load）はしない＝矢印作成のたびに
  // リロード/ちらつきしないようにする。失敗時のみ load() で再同期する。
  const handleAddFlow = useCallback(
    async (body: {
      sourceNodeId: string;
      targetNodeId: string;
      dataItem: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
    }) => {
      if (!diagram) return;
      try {
        const created = await dfdApi.addFlow(diagram.id, body);
        setDiagram((prev) => (prev ? { ...prev, flows: [...prev.flows, created] } : prev));
      } catch {
        await load(); // 失敗時のみ再取得で再同期
      }
    },
    [diagram, load],
  );

  // データフロー更新（ラベル・情報種別・線形状・位置）。**楽観更新**で、サーバが返した
  // 更新後の flow をローカル diagram.flows にマージし、ブロッキングな再取得（load）はしない。
  // フロー更新はノード編集と違い他エンティティ（オブジェクト等）への波及がないため loadDataObjects も不要。
  // 失敗時のみ load() で再同期する。
  const handleUpdateFlow = useCallback(
    async (id: string, patch: Partial<DfdFlowModel>) => {
      try {
        const updated = await dfdApi.updateFlow(id, patch);
        setDiagram((prev) =>
          prev ? { ...prev, flows: prev.flows.map((f) => (f.id === id ? updated : f)) } : prev,
        );
      } catch {
        await load(); // 失敗時のみ再取得で再同期
      }
    },
    [load],
  );

  // データフロー再ルーティング（端点ドラッグで source/target ノード・接続側を付け替え）
  // PATCH /api/dfd-flows/:id で更新。**楽観更新**でローカル diagram.flows を即書き換え、
  // 再取得（load）はしない＝矢印付け替えのたびにリロード/ちらつきしないようにする。
  // 失敗時のみ load() で巻き戻す。
  const handleReconnectFlow = useCallback(
    async (
      flowId: string,
      next: {
        sourceNodeId: string;
        targetNodeId: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      },
    ) => {
      setDiagram((prev) =>
        prev
          ? {
              ...prev,
              flows: prev.flows.map((f) =>
                f.id === flowId
                  ? {
                      ...f,
                      sourceNodeId: next.sourceNodeId,
                      targetNodeId: next.targetNodeId,
                      sourceHandle: next.sourceHandle ?? null,
                      targetHandle: next.targetHandle ?? null,
                    }
                  : f,
              ),
            }
          : prev,
      );
      try {
        await dfdApi.updateFlow(flowId, {
          sourceNodeId: next.sourceNodeId,
          targetNodeId: next.targetNodeId,
          sourceHandle: next.sourceHandle ?? null,
          targetHandle: next.targetHandle ?? null,
        });
      } catch {
        await load(); // 失敗時のみ再取得で巻き戻し
      }
    },
    [load],
  );

  const handleDeleteFlow = useCallback(
    async (id: string) => {
      await dfdApi.deleteFlow(id);
      await load();
    },
    [load],
  );

  const handleSavePositions = useCallback(
    async (positions: { id: string; positionX: number; positionY: number }[]) => {
      if (!diagram) return;
      // 楽観更新（再取得で fitView がリセットされ位置が飛ぶのを防ぐ）
      setDiagram((prev) =>
        prev
          ? {
              ...prev,
              nodes: prev.nodes.map((n) => {
                const p = positions.find((q) => q.id === n.id);
                return p ? { ...n, positionX: p.positionX, positionY: p.positionY } : n;
              }),
            }
          : prev,
      );
      await dfdApi.savePositions(diagram.id, positions);
    },
    [diagram],
  );

  // FUNCTION ノード → 第2レベル（そのフローのDFDタブ）へドリルダウン
  const handleFunctionOpen = useCallback(
    (refFlowId: string) => {
      router.push(`/dashboard/projects/${projectId}/flows/${refFlowId}?tab=dfd`);
    },
    [projectId, router],
  );

  const isEmpty = !diagram || diagram.nodes.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="DFD（第1レベル）"
        description="プロジェクト全体のデータフロー図。業務フローを「処理（FUNCTION）」として、フロー間の連携をデータフローで可視化します。"
        help="第1レベルDFDは、プロジェクトの各業務フローを1つの処理として描き、フロー間の入出力連携（FlowNodeLink）をデータフローとして示します。FUNCTIONノードを開くと、その業務フロー単体のDFD（第2レベル）へドリルダウンできます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              title="第1レベルDFDの使い方"
              steps={[
                '「再生成」で、プロジェクトの業務フローをFUNCTIONノードとして自動生成します（手動追加・位置は保持）。',
                'フロー間のデータ連携（クロスフローリンク）は、源泉フロー → 宛先フローのデータフローとして描かれます。',
                'FUNCTIONノードをダブルクリック（または「開く」）すると、その業務フロー単体のDFD（第2レベル）へドリルダウンします。',
                '「図 / 一覧表」を切り替えて、データフロー一覧表でも確認できます。PNG出力で図を画像として保存できます。',
              ]}
            />
            <ManualButton feature="dfd" />
            <ExportImportButton
              label="DFD（第1レベル）"
              fileBaseName="dfd-level1"
              size="sm"
              canEdit={canEdit}
              withModeChoice={false}
              importHint="選択した JSON でこの第1レベルDFDの中身（ノード・データフロー）を丸ごと置き換えます。注意: 手動で追加したノードだけでなく、自動生成（generate）で作られたノード/フローも区別なく全置換されます。FUNCTION ノードの refFlowId（業務フローへのリンク）は、GET の値をそのまま往復させた場合のみ保持され、自動生成の冪等突合に使われます。値を書き換える / 落とすと自動生成が別ノードを作り直すため、リンクは編集しないでください。"
              getExport={() => entityJsonIo.exportProjectDfd(projectId)}
              onImport={(parsed) =>
                entityJsonIo.importProjectDfd(projectId, parsed as EntityBundle)
              }
              onDone={() => void load()}
            />
          </>
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <Share2 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <p className="text-sm text-indigo-800">
          プロジェクトの業務フロー群を「処理（FUNCTION）」として並べ、フロー間の連携をデータフローとして俯瞰します。
          各FUNCTIONを開くと、そのフロー単体のDFD（第2レベル）に潜れます。
        </p>
      </div>

      {loading && !diagram ? (
        // スピナーは初回ロード（diagram 未取得）のみ。リフェッチ(loading=true でも diagram あり)
        // では DfdCanvas をアンマウントしない＝再マウント時の fitView で拡大率が戻るのを防ぐ。
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
      ) : isEmpty ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-gray-500">
              第1レベルDFDはまだ生成されていません。{canEdit ? '「DFDを生成」でプロジェクトの業務フローから自動生成します。' : '編集権限がないため生成できません。'}
            </p>
            {canEdit && (
            <Button onClick={handleRegenerate} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Network className="mr-2 h-4 w-4" />
              )}
              DFDを生成
            </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 未統合データストアのバナー: オブジェクト（共通マスタ）に統合して名前を一元管理する */}
          {diagram && diagram.unlinkedDataStoreCount > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <Boxes className="h-5 w-5 shrink-0 text-amber-600" />
              <p className="min-w-[200px] flex-1 text-sm text-amber-800">
                未統合のデータストアが {diagram.unlinkedDataStoreCount} 件あります。
                オブジェクト（共通マスタ）に統合すると、オブジェクトマップ・ER図と名前が同期されます。
              </p>
              {canEdit && (
              <Button
                size="sm"
                onClick={handleIntegrateDataStores}
                disabled={integrating}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                {integrating ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Boxes className="mr-1.5 h-4 w-4" />
                )}
                オブジェクトに統合
              </Button>
              )}
            </div>
          )}

          {/* 図 / 一覧表 サブ切替 */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setView('diagram')}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'diagram'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Network className="h-4 w-4" />図
            </button>
            <button
              type="button"
              onClick={() => setView('table')}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                view === 'table'
                  ? 'border-blue-600 bg-blue-50 text-blue-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              <Table2 className="h-4 w-4" />一覧表
            </button>
          </div>

          {view === 'diagram' && diagram ? (
            <div className="h-[calc(100vh-320px)] overflow-hidden rounded-lg border border-gray-200">
              <DfdCanvas
                diagram={diagram}
                projectId={projectId}
                informationTypes={informationTypes}
                dataObjects={dataObjects}
                onAddNode={ro(handleAddNode)}
                onUpdateNode={ro(handleUpdateNode)}
                onDeleteNode={ro(handleDeleteNode)}
                onAddFlow={ro(handleAddFlow)}
                onUpdateFlow={ro(handleUpdateFlow)}
                onReconnectFlow={ro(handleReconnectFlow)}
                onDeleteFlow={ro(handleDeleteFlow)}
                onSavePositions={ro(handleSavePositions)}
                onRegenerate={ro(handleRegenerate)}
                onFunctionOpen={handleFunctionOpen}
                annotations={annotations}
                onAddAnnotation={ro(handleAddAnnotation)}
                onUpdateAnnotation={ro(handleUpdateAnnotation)}
                onDeleteAnnotation={ro(handleDeleteAnnotation)}
              />
            </div>
          ) : diagram ? (
            <DataFlowTable diagram={diagram} informationTypes={informationTypes} />
          ) : null}
        </>
      )}

      {/* 情報種別レジストリ（プロジェクト単位。DFDの有無に関わらず常時表示） */}
      {!loading && !error && (
        <EditGate dim={false}>
          <InformationTypeRegistry projectId={projectId} onInformationTypesChange={setInformationTypes} />
        </EditGate>
      )}
    </div>
  );
}
