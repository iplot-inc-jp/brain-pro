'use client';

/**
 * オブジェクト関係性マップ。
 *
 * データオブジェクト（DFDのデータストア / ER図の点線囲みと同一マスタ）を
 * 角丸カードとして自由配置し、オブジェクト間のリレーション
 * （カーディナリティ 1:1 / 1:多 / 多:多）を編集するページ。
 *  - 上: 軽量SVGキャンバス（ドラッグ移動・ズーム/パン・ノブドラッグ接続/2クリック接続・エッジ編集ポップ）
 *  - 右: 選択オブジェクトの詳細パネル（所属テーブルの付け外し＋ER図リンク）
 *  - 下: オブジェクト一覧／リレーション一覧のテーブルビュー
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Boxes, Import, Plus, Spline, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { useToast } from '@/components/ui/use-toast';
import { tablesApi, type Table } from '@/lib/api';
import {
  dataObjectApi,
  dataObjectAnnotationApi,
  type DataObjectAnnotationDto,
  type DataObjectAnnotationKind,
  type ObjectGraphDto,
  type PositionItem,
  type RelationCardinality,
} from '@/lib/data-objects';
import { ObjectMapCanvas } from './_components/ObjectMapCanvas';
import { ObjectDetailPanel } from './_components/ObjectDetailPanel';
import { ObjectListTable } from './_components/ObjectListTable';
import { RelationListTable } from './_components/RelationListTable';
import { DEFAULT_OBJECT_COLOR, OBJECT_COLORS } from './_components/object-map-shared';

export default function ObjectMapPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { toast } = useToast();

  const [graph, setGraph] = useState<ObjectGraphDto | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [annotations, setAnnotations] = useState<DataObjectAnnotationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  const showError = useCallback(
    (err: unknown, fallback: string) => {
      toast({
        variant: 'destructive',
        title: err instanceof Error ? err.message : fallback,
      });
    },
    [toast],
  );

  // ===== 取得 =====
  const load = useCallback(
    async (withSpinner: boolean) => {
      if (withSpinner) setLoading(true);
      setError(null);
      try {
        const [g, t, a] = await Promise.all([
          dataObjectApi.getGraph(projectId),
          tablesApi.list(projectId).catch(() => [] as Table[]),
          dataObjectAnnotationApi.list(projectId).catch(() => [] as DataObjectAnnotationDto[]),
        ]);
        setGraph(g);
        setTables(t);
        setAnnotations(a);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (withSpinner) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  const refresh = useCallback(() => load(false), [load]);

  // ===== 位置のデバウンス保存 =====
  const pendingPos = useRef(new Map<string, PositionItem>());
  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (posTimer.current) clearTimeout(posTimer.current);
    };
  }, []);

  const handleObjectMoved = useCallback(
    (id: string, x: number, y: number) => {
      // 楽観更新（再取得しないので fitView も飛ばない）
      setGraph((g) =>
        g
          ? {
              ...g,
              objects: g.objects.map((o) =>
                o.id === id ? { ...o, positionX: x, positionY: y } : o,
              ),
            }
          : g,
      );
      pendingPos.current.set(id, { id, positionX: x, positionY: y });
      if (posTimer.current) clearTimeout(posTimer.current);
      posTimer.current = setTimeout(() => {
        const items = Array.from(pendingPos.current.values());
        pendingPos.current.clear();
        if (items.length === 0) return;
        void dataObjectApi
          .savePositions(projectId, items)
          .catch((err) => showError(err, '位置の保存に失敗しました'));
      }, 600);
    },
    [projectId, showError],
  );

  // ===== オブジェクト =====
  const handleAddObject = useCallback(async () => {
    const count = graph?.objects.length ?? 0;
    try {
      const created = await dataObjectApi.createObject(projectId, {
        name: `オブジェクト${count + 1}`,
        color: OBJECT_COLORS[count % OBJECT_COLORS.length] ?? DEFAULT_OBJECT_COLOR,
        positionX: 80 + (count % 4) * 240,
        positionY: 80 + Math.floor(count / 4) * 150,
        order: count,
      });
      await refresh();
      setSelectedObjectId(created.id);
    } catch (err) {
      showError(err, 'オブジェクトの作成に失敗しました');
    }
  }, [graph, projectId, refresh, showError]);

  const handleUpdateObject = useCallback(
    async (
      id: string,
      patch: { name?: string; description?: string | null; color?: string | null },
    ) => {
      try {
        await dataObjectApi.updateObject(id, patch);
        await refresh();
      } catch (err) {
        showError(err, 'オブジェクトの更新に失敗しました');
      }
    },
    [refresh, showError],
  );

  const handleDeleteObject = useCallback(
    async (id: string) => {
      try {
        await dataObjectApi.deleteObject(id);
        if (selectedObjectId === id) setSelectedObjectId(null);
        await refresh();
      } catch (err) {
        showError(err, 'オブジェクトの削除に失敗しました');
      }
    },
    [selectedObjectId, refresh, showError],
  );

  // ===== DFD取り込み =====
  const handleImportFromDfd = useCallback(async () => {
    setImporting(true);
    try {
      const result = await dataObjectApi.importFromDfd(projectId);
      toast({
        title: 'DFDのデータストアから取り込みました',
        description: `新規作成 ${result.created}件 / DFDノード紐づけ ${result.linked}件`,
      });
      await refresh();
    } catch (err) {
      showError(err, 'DFDからの取り込みに失敗しました');
    } finally {
      setImporting(false);
    }
  }, [projectId, toast, refresh, showError]);

  // ===== リレーション =====
  const handleCreateRelation = useCallback(
    async (
      sourceObjectId: string,
      targetObjectId: string,
      cardinality?: RelationCardinality,
      label?: string | null,
      sourceHandle?: string | null,
      targetHandle?: string | null,
    ) => {
      if (sourceObjectId === targetObjectId) return;
      // 同方向の重複は作らない
      const exists = graph?.relations.some(
        (r) => r.sourceObjectId === sourceObjectId && r.targetObjectId === targetObjectId,
      );
      if (exists) {
        toast({ title: 'この2つのオブジェクト間には既に同じ向きの関係線があります' });
        return;
      }
      try {
        await dataObjectApi.createRelation(projectId, {
          sourceObjectId,
          targetObjectId,
          cardinality: cardinality ?? 'ONE_TO_MANY',
          label: label ?? null,
          sourceHandle: sourceHandle ?? null,
          targetHandle: targetHandle ?? null,
        });
        await refresh();
      } catch (err) {
        showError(err, '関係線の作成に失敗しました');
      }
    },
    [graph, projectId, toast, refresh, showError],
  );

  const handleUpdateRelation = useCallback(
    async (
      id: string,
      patch: {
        sourceObjectId?: string;
        targetObjectId?: string;
        cardinality?: RelationCardinality;
        label?: string | null;
        pathStyle?: string | null;
        sourceHandle?: string | null;
        targetHandle?: string | null;
      },
    ) => {
      try {
        await dataObjectApi.updateRelation(id, patch);
        await refresh();
      } catch (err) {
        showError(err, '関係線の更新に失敗しました');
      }
    },
    [refresh, showError],
  );

  const handleDeleteRelation = useCallback(
    async (id: string) => {
      try {
        await dataObjectApi.deleteRelation(id);
        await refresh();
      } catch (err) {
        showError(err, '関係線の削除に失敗しました');
      }
    },
    [refresh, showError],
  );

  // ===== 付箋/メモ =====
  const handleAddAnnotation = useCallback(
    async (kind: DataObjectAnnotationKind, x: number, y: number) => {
      try {
        const created = await dataObjectAnnotationApi.create(projectId, {
          kind,
          text: '',
          positionX: Math.round(x),
          positionY: Math.round(y),
          order: annotations.length,
        });
        setAnnotations((list) => [...list, created]);
      } catch (err) {
        showError(err, '付箋/メモの作成に失敗しました');
      }
    },
    [projectId, annotations.length, showError],
  );

  // 付箋/メモ位置のデバウンス保存（オブジェクト位置と同じパターン）
  const pendingAnnotationPos = useRef(new Map<string, PositionItem>());
  const annotationPosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (annotationPosTimer.current) clearTimeout(annotationPosTimer.current);
    };
  }, []);

  const handleAnnotationMoved = useCallback(
    (id: string, x: number, y: number) => {
      // 楽観更新（再取得しない）
      setAnnotations((list) =>
        list.map((a) => (a.id === id ? { ...a, positionX: x, positionY: y } : a)),
      );
      pendingAnnotationPos.current.set(id, { id, positionX: x, positionY: y });
      if (annotationPosTimer.current) clearTimeout(annotationPosTimer.current);
      annotationPosTimer.current = setTimeout(() => {
        const items = Array.from(pendingAnnotationPos.current.values());
        pendingAnnotationPos.current.clear();
        if (items.length === 0) return;
        void Promise.all(
          items.map((it) =>
            dataObjectAnnotationApi.update(it.id, { positionX: it.positionX, positionY: it.positionY }),
          ),
        ).catch((err) => showError(err, '付箋/メモの位置の保存に失敗しました'));
      }, 600);
    },
    [showError],
  );

  const handleUpdateAnnotationText = useCallback(
    async (id: string, text: string) => {
      // 楽観更新してから保存（失敗時は再取得で巻き戻す）
      setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, text } : a)));
      try {
        await dataObjectAnnotationApi.update(id, { text });
      } catch (err) {
        showError(err, '付箋/メモの更新に失敗しました');
        await refresh();
      }
    },
    [showError, refresh],
  );

  const handleDeleteAnnotation = useCallback(
    async (id: string) => {
      try {
        await dataObjectAnnotationApi.remove(id);
        setAnnotations((list) => list.filter((a) => a.id !== id));
      } catch (err) {
        showError(err, '付箋/メモの削除に失敗しました');
      }
    },
    [showError],
  );

  // ===== テーブル紐づけ =====
  const handleLinkTable = useCallback(
    async (tableId: string, dataObjectId: string | null) => {
      try {
        await dataObjectApi.linkTableToObject(tableId, dataObjectId);
        await refresh();
      } catch (err) {
        showError(err, 'テーブルの紐づけに失敗しました');
      }
    },
    [refresh, showError],
  );

  const objects = graph?.objects ?? [];
  const relations = graph?.relations ?? [];
  const selectedObject = selectedObjectId
    ? objects.find((o) => o.id === selectedObjectId) ?? null
    : null;

  // テーブルID → 所属オブジェクト（詳細パネルの「現在: ◯◯」表示用）
  const tableLinkMap = new Map<string, { objectId: string; objectName: string }>();
  for (const o of objects) {
    for (const t of o.tables) {
      tableLinkMap.set(t.id, { objectId: o.id, objectName: o.name });
    }
  }

  const isEmpty = objects.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        title="オブジェクト関係性マップ"
        description="業務データの「オブジェクト」（DFDのデータストアと同一マスタ）を並べ、オブジェクト間の関係とカーディナリティ（1:1 / 1:多 / 多:多）を整理します。"
        help="オブジェクトは、DFDのデータストア・データカタログのテーブル・ER図の点線囲みを貫く同一マスタです。「DFDのデータストアから取り込み」で第1レベルDFDのデータストアをオブジェクト化し、カード間の関係線でデータ構造の骨格（カーディナリティ）を設計します。各オブジェクトにはカタログのテーブルを紐づけられ、ER図ページで実テーブルの構造に展開されます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <HowToPanel
              title="オブジェクト関係性マップの使い方"
              steps={[
                '「DFDのデータストアから取り込み」で、第1レベルDFDのデータストアをオブジェクトとして取り込みます（同名は再利用・冪等）。',
                'カードをドラッグして配置を整えます（位置は自動保存）。ホイールでズーム、背景ドラッグでパンできます。',
                'カードにマウスを乗せると4辺に丸ノブが出ます。ノブをドラッグして別のカード（またはそのノブ）の上で離すと関係線が引けます（空白で離す/ESCで中断）。「関係線を追加」ボタンの2クリック接続（接続元 → 接続先）も使えます。',
                '関係線をクリックすると、カーディナリティ（1:1 / 1:多 / 多:多）・ラベルの編集と削除ができます。線の両端の 1/N 表記と線色で種類を確認できます。',
                'カードをクリックすると右パネルが開き、詳細編集と「所属テーブル」の付け外し、ER図ページへの移動ができます。',
                'キャンバス下の一覧ビューでも、オブジェクトとリレーションを表形式で編集できます。',
              ]}
            />
            <ManualButton feature="object-map" />
          </>
        }
      />

      <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
        <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-indigo-600" />
        <p className="text-sm text-indigo-800">
          DFDのデータストアをオブジェクトとして取り込み、オブジェクト間のカーディナリティを設計します。
          ここで決めた骨格が、データカタログのテーブル・ER図の点線囲みにつながります。
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
            <Button variant="outline" onClick={() => void load(true)}>
              再読み込み
            </Button>
          </CardContent>
        </Card>
      ) : isEmpty ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="py-12 text-center space-y-4">
            <Boxes className="mx-auto h-10 w-10 text-gray-300" />
            <p className="text-gray-500">
              オブジェクトはまだありません。
              <br />
              まずは第1レベルDFDのデータストアから取り込むのがおすすめです。
            </p>
            <div className="flex items-center justify-center gap-2">
              <Button onClick={() => void handleImportFromDfd()} disabled={importing}>
                {importing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Import className="mr-2 h-4 w-4" />
                )}
                DFDのデータストアから取り込み
              </Button>
              <Button variant="outline" onClick={() => void handleAddObject()}>
                <Plus className="mr-2 h-4 w-4" />
                オブジェクトを手で追加
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ===== キャンバス＋右サイドパネル ===== */}
          <div className="flex h-[calc(100vh-340px)] min-h-[420px] gap-3">
            <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-gray-200">
              <ObjectMapCanvas
                objects={objects}
                relations={relations}
                annotations={annotations}
                selectedObjectId={selectedObjectId}
                onSelectObject={setSelectedObjectId}
                onObjectMoved={handleObjectMoved}
                onCreateRelation={(s, t, sh, th) =>
                  handleCreateRelation(s, t, undefined, undefined, sh, th)
                }
                onUpdateRelation={handleUpdateRelation}
                onDeleteRelation={handleDeleteRelation}
                onAddObject={() => void handleAddObject()}
                onImportFromDfd={() => void handleImportFromDfd()}
                importing={importing}
                onAddAnnotation={handleAddAnnotation}
                onAnnotationMoved={handleAnnotationMoved}
                onUpdateAnnotationText={handleUpdateAnnotationText}
                onDeleteAnnotation={handleDeleteAnnotation}
              />
            </div>
            {selectedObject && (
              <ObjectDetailPanel
                object={selectedObject}
                projectId={projectId}
                allTables={tables}
                tableLinkMap={tableLinkMap}
                onClose={() => setSelectedObjectId(null)}
                onUpdate={handleUpdateObject}
                onDelete={handleDeleteObject}
                onLinkTable={handleLinkTable}
              />
            )}
          </div>

          {/* ===== 一覧ビュー ===== */}
          <div className="space-y-4">
            <div className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Database className="h-4 w-4 text-gray-400" />
                オブジェクト一覧（{objects.length}）
              </h2>
              <ObjectListTable
                objects={objects}
                selectedObjectId={selectedObjectId}
                onSelect={setSelectedObjectId}
                onUpdate={handleUpdateObject}
                onDelete={handleDeleteObject}
              />
            </div>
            <div className="space-y-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                <Spline className="h-4 w-4 text-gray-400" />
                リレーション一覧（{relations.length}）
              </h2>
              <RelationListTable
                objects={objects}
                relations={relations}
                onCreate={(body) =>
                  handleCreateRelation(
                    body.sourceObjectId,
                    body.targetObjectId,
                    body.cardinality,
                    body.label,
                  )
                }
                onUpdate={handleUpdateRelation}
                onDelete={handleDeleteRelation}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
