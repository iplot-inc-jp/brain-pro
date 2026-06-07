'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Network, Table2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { DfdCanvas } from '@/components/dfd/DfdCanvas';
import { DataFlowTable } from '@/components/dfd/DataFlowTable';
import {
  dfdApi,
  type DfdDiagram,
  type DfdNode as DfdNodeModel,
  type DfdFlow as DfdFlowModel,
  type DfdNodeKind,
} from '@/lib/dfd';

/**
 * 第1レベルDFD（プロジェクト全体）。
 * FUNCTION ノード = プロジェクトの業務フロー群、データフロー = フロー間連携(FlowNodeLink)。
 * FUNCTION ノードを開くと第2レベル（flows/[refFlowId]?tab=dfd）へドリルダウンする。
 */
export default function ProjectDfdPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;

  const [diagram, setDiagram] = useState<DfdDiagram | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'diagram' | 'table'>('diagram');

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

  useEffect(() => {
    void load();
  }, [load]);

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
    },
    [diagram, load],
  );

  const handleUpdateNode = useCallback(
    async (id: string, patch: Partial<DfdNodeModel>) => {
      await dfdApi.updateNode(id, patch);
      await load();
    },
    [load],
  );

  const handleDeleteNode = useCallback(
    async (id: string) => {
      await dfdApi.deleteNode(id);
      await load();
    },
    [load],
  );

  const handleAddFlow = useCallback(
    async (body: { sourceNodeId: string; targetNodeId: string; dataItem: string }) => {
      if (!diagram) return;
      await dfdApi.addFlow(diagram.id, body);
      await load();
    },
    [diagram, load],
  );

  const handleUpdateFlow = useCallback(
    async (id: string, patch: Partial<DfdFlowModel>) => {
      await dfdApi.updateFlow(id, patch);
      await load();
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
          <HowToPanel
            title="第1レベルDFDの使い方"
            steps={[
              '「再生成」で、プロジェクトの業務フローをFUNCTIONノードとして自動生成します（手動追加・位置は保持）。',
              'フロー間のデータ連携（クロスフローリンク）は、源泉フロー → 宛先フローのデータフローとして描かれます。',
              'FUNCTIONノードをダブルクリック（または「開く」）すると、その業務フロー単体のDFD（第2レベル）へドリルダウンします。',
              '「図 / 一覧表」を切り替えて、データフロー一覧表でも確認できます。PNG出力で図を画像として保存できます。',
            ]}
          />
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <Share2 className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <p className="text-sm text-indigo-800">
          プロジェクトの業務フロー群を「処理（FUNCTION）」として並べ、フロー間の連携をデータフローとして俯瞰します。
          各FUNCTIONを開くと、そのフロー単体のDFD（第2レベル）に潜れます。
        </p>
      </div>

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
      ) : isEmpty ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="py-12 text-center space-y-3">
            <p className="text-gray-500">
              第1レベルDFDはまだ生成されていません。「DFDを生成」でプロジェクトの業務フローから自動生成します。
            </p>
            <Button onClick={handleRegenerate} disabled={busy}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Network className="mr-2 h-4 w-4" />
              )}
              DFDを生成
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
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
                onAddNode={handleAddNode}
                onUpdateNode={handleUpdateNode}
                onDeleteNode={handleDeleteNode}
                onAddFlow={handleAddFlow}
                onUpdateFlow={handleUpdateFlow}
                onDeleteFlow={handleDeleteFlow}
                onSavePositions={handleSavePositions}
                onRegenerate={handleRegenerate}
                onFunctionOpen={handleFunctionOpen}
              />
            </div>
          ) : diagram ? (
            <DataFlowTable diagram={diagram} />
          ) : null}
        </>
      )}
    </div>
  );
}
