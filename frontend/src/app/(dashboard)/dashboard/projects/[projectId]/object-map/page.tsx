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
import { diagramElementApi, type DiagramElementDto } from '@/lib/diagram-elements';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import { useToast } from '@/components/ui/use-toast';
import { tablesApi, type Table } from '@/lib/api';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';
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
import { ObjectScopeLinkPanel } from './_components/ObjectScopeLinkPanel';
import { ScopeMembersPanel } from './_components/ScopeMembersPanel';
import { CARD_W, CARD_H, DEFAULT_OBJECT_COLOR, OBJECT_COLORS } from './_components/object-map-shared';
import { useReadOnly } from '@/components/read-only-context';
import { EditGate } from '@/components/edit-gate';
import { FeatureSectionIo } from '@/components/io/FeatureSectionIo';
import {
  BackgroundJobsPanel,
  type BackgroundJobsPanelHandle,
} from '@/components/background-jobs-panel';
import { enqueueAiJob } from '@/lib/jobs';
import { useBackgroundJob } from '@/hooks/use-background-job';
import type { ObjectGraphDto as JobObjectGraph } from '@/lib/data-objects';

/** スコープ囲みの既定色（インディゴ。キャンバスの DEFAULT_SCOPE_COLOR と揃える） */
const DEFAULT_SCOPE_COLOR = '#6366f1';

export default function ObjectMapPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { toast } = useToast();
  const { canEdit } = useReadOnly();

  const [graph, setGraph] = useState<ObjectGraphDto | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [annotations, setAnnotations] = useState<DataObjectAnnotationDto[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  // ===== 画像要素（ImageElement） =====
  const [imageElements, setImageElements] = useState<DiagramElementDto[]>([]);
  // 領域一覧パネルからのフォーカス要求トリガ（インクリメントでキャンバスが中央寄せ）
  const [focusNonce, setFocusNonce] = useState(0);
  // 領域紐付けパネルで保存中のオブジェクトID（ピッカーを一時無効化）
  const [savingScopeObjectId, setSavingScopeObjectId] = useState<string | null>(null);
  // バックグラウンド処理一覧（ジョブ起票後に refresh する）
  const jobsPanelRef = useRef<BackgroundJobsPanelHandle | null>(null);

  // ===== Mermaid生成ジョブの監視（useBackgroundJob で 1.5 秒ポーリング） =====
  // 進行中のジョブIDを state で持ち、フックに監視させる。
  // handleImportMermaid はこのジョブの終端状態に解決/棄却する Promise を返す
  // （キャンバス側ダイアログのスピナー/エラー表示はこの Promise に従う）。
  const [mermaidJobId, setMermaidJobId] = useState<string | null>(null);
  const { job: mermaidJob } = useBackgroundJob(mermaidJobId);
  // ダイアログに返した Promise の resolve/reject をフック側の終端で呼ぶための保管。
  const mermaidSettlers = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

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
        const [g, t, a, sp, imgs] = await Promise.all([
          dataObjectApi.getGraph(projectId),
          tablesApi.list(projectId).catch(() => [] as Table[]),
          dataObjectAnnotationApi.list(projectId).catch(() => [] as DataObjectAnnotationDto[]),
          subProjectApi.list(projectId).catch(() => [] as SubProjectMaster[]),
          diagramElementApi.list(projectId, 'OBJECT_MAP', projectId).catch(() => [] as DiagramElementDto[]),
        ]);
        setGraph(g);
        setTables(t);
        setAnnotations(a);
        setSubProjects(sp);
        setImageElements(imgs.filter((el) => el.type === 'IMAGE'));
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
      // 楽観: サーバ返却の実体を即追加（全体 refresh しない＝即反映）
      setGraph((g) => (g ? { ...g, objects: [...g.objects, created] } : g));
      setSelectedObjectId(created.id);
    } catch (err) {
      showError(err, 'オブジェクトの作成に失敗しました');
      await refresh(); // 失敗時のみ再取得で巻き戻し
    }
  }, [graph, projectId, refresh, showError]);

  const handleUpdateObject = useCallback(
    async (
      id: string,
      patch: { name?: string; description?: string | null; color?: string | null },
    ) => {
      try {
        const updated = await dataObjectApi.updateObject(id, patch);
        // 楽観: サーバ返却の実体をマージ（全体 refresh しない＝即反映）
        setGraph((g) =>
          g ? { ...g, objects: g.objects.map((o) => (o.id === id ? updated : o)) } : g,
        );
      } catch (err) {
        showError(err, 'オブジェクトの更新に失敗しました');
        await refresh(); // 失敗時のみ再取得で巻き戻し
      }
    },
    [refresh, showError],
  );

  const handleDeleteObject = useCallback(
    async (id: string) => {
      if (selectedObjectId === id) setSelectedObjectId(null);
      // 楽観: 該当オブジェクト＋それに接続する関係を即除去（全体 refresh しない＝即反映）
      setGraph((g) =>
        g
          ? {
              ...g,
              objects: g.objects.filter((o) => o.id !== id),
              relations: g.relations.filter(
                (r) => r.sourceObjectId !== id && r.targetObjectId !== id,
              ),
            }
          : g,
      );
      try {
        await dataObjectApi.deleteObject(id);
      } catch (err) {
        showError(err, 'オブジェクトの削除に失敗しました');
        await refresh(); // 失敗時のみ巻き戻し
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
        const created = await dataObjectApi.createRelation(projectId, {
          sourceObjectId,
          targetObjectId,
          cardinality: cardinality ?? 'ONE_TO_MANY',
          label: label ?? null,
          sourceHandle: sourceHandle ?? null,
          targetHandle: targetHandle ?? null,
        });
        // 楽観: サーバ返却の実体（実ID）を即追加（全体 refresh しない＝即反映）
        setGraph((g) => (g ? { ...g, relations: [...g.relations, created] } : g));
      } catch (err) {
        showError(err, '関係線の作成に失敗しました');
        await refresh(); // 失敗時のみ再取得で巻き戻し
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
        const updated = await dataObjectApi.updateRelation(id, patch);
        // 楽観: サーバ返却の実体をマージ（全体 refresh しない＝即反映）
        setGraph((g) =>
          g ? { ...g, relations: g.relations.map((r) => (r.id === id ? updated : r)) } : g,
        );
      } catch (err) {
        showError(err, '関係線の更新に失敗しました');
        await refresh(); // 失敗時のみ再取得で巻き戻し
      }
    },
    [refresh, showError],
  );

  const handleDeleteRelation = useCallback(
    async (id: string) => {
      // 楽観: 該当関係を即除去（全体 refresh しない＝即反映）
      setGraph((g) =>
        g ? { ...g, relations: g.relations.filter((r) => r.id !== id) } : g,
      );
      try {
        await dataObjectApi.deleteRelation(id);
      } catch (err) {
        showError(err, '関係線の削除に失敗しました');
        await refresh(); // 失敗時のみ巻き戻し
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

  // ===== スコープ囲み（領域） =====
  // 作成（既定サイズ 320×200・点線・薄塗り・領域未設定）
  const handleAddScope = useCallback(
    async (positionX: number, positionY: number) => {
      try {
        const created = await dataObjectAnnotationApi.create(projectId, {
          kind: 'SCOPE',
          text: '',
          positionX: Math.round(positionX),
          positionY: Math.round(positionY),
          width: 320,
          height: 200,
          borderStyle: 'dashed',
          fillOpacity: 0.08,
          color: DEFAULT_SCOPE_COLOR,
          order: annotations.length,
        });
        setAnnotations((list) => [...list, created]);
      } catch (err) {
        showError(err, 'スコープ囲みの作成に失敗しました');
      }
    },
    [projectId, annotations.length, showError],
  );

  // スコープ囲みの位置/サイズのデバウンス保存（オブジェクト位置と同じパターン）。
  // 確定後、その囲みに領域(subProjectId)があれば applyScopeLinks→グラフ再取得で内側を自動紐付け。
  const pendingScopeGeom = useRef(
    new Map<string, { positionX: number; positionY: number; width: number; height: number }>(),
  );
  const scopeGeomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (scopeGeomTimer.current) clearTimeout(scopeGeomTimer.current);
    };
  }, []);

  const handleScopeGeometryChanged = useCallback(
    (
      id: string,
      geom: { positionX: number; positionY: number; width: number; height: number },
    ) => {
      // 楽観更新（再取得しないので fitView も飛ばない）
      setAnnotations((list) =>
        list.map((a) =>
          a.id === id
            ? {
                ...a,
                positionX: geom.positionX,
                positionY: geom.positionY,
                width: geom.width,
                height: geom.height,
              }
            : a,
        ),
      );
      pendingScopeGeom.current.set(id, geom);
      if (scopeGeomTimer.current) clearTimeout(scopeGeomTimer.current);
      scopeGeomTimer.current = setTimeout(() => {
        const entries = Array.from(pendingScopeGeom.current.entries());
        pendingScopeGeom.current.clear();
        if (entries.length === 0) return;
        void (async () => {
          try {
            // まず位置/サイズを保存
            await Promise.all(
              entries.map(([scopeId, g]) =>
                dataObjectAnnotationApi.update(scopeId, {
                  positionX: g.positionX,
                  positionY: g.positionY,
                  width: g.width,
                  height: g.height,
                }),
              ),
            );
            // 領域が設定済みの囲みは内側オブジェクトを自動紐付け。
            // 結果(objectIds/subProjectId)で**ローカル楽観更新**し、全体 refresh はしない（即反映）。
            const withArea = entries.filter(([scopeId]) => {
              const sc = annotations.find((a) => a.id === scopeId);
              return sc?.subProjectId;
            });
            if (withArea.length > 0) {
              const results = await Promise.all(
                withArea.map(([scopeId]) => dataObjectAnnotationApi.applyScopeLinks(scopeId)),
              );
              const linked = new Map<string, string>(); // objectId -> subProjectId
              for (const r of results) {
                for (const oid of r.objectIds) linked.set(oid, r.subProjectId);
              }
              if (linked.size > 0) {
                setGraph((g) =>
                  g
                    ? {
                        ...g,
                        objects: g.objects.map((o) =>
                          linked.has(o.id)
                            ? { ...o, subProjectId: linked.get(o.id)! }
                            : o,
                        ),
                      }
                    : g,
                );
              }
            }
          } catch (err) {
            showError(err, 'スコープ囲みの保存に失敗しました');
          }
        })();
      }, 600);
    },
    [annotations, refresh, showError],
  );

  // スコープ囲みのプロパティ更新（領域/色/枠線/表示）。
  // 領域(subProjectId)を変更したときは、保存後に applyScopeLinks→グラフ再取得で内側を自動紐付け。
  const handleUpdateScope = useCallback(
    async (
      id: string,
      patch: {
        subProjectId?: string | null;
        color?: string | null;
        borderStyle?: 'dashed' | 'solid' | null;
        fillOpacity?: number | null;
        visible?: boolean | null;
      },
    ) => {
      // 楽観更新（色・枠線・表示・領域の即時反映でちらつき抑制）
      setAnnotations((list) => list.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      try {
        await dataObjectAnnotationApi.update(id, patch);
        // 領域を「設定」したときだけ囲み内オブジェクトを自動紐付け。
        // クリア（subProjectId=null/空）時は applyScopeLinks が 400 を返すためスキップする
        // （既存オブジェクトの紐付けは別途解除しない現仕様に合致）。
        if (patch.subProjectId) {
          // 結果(objectIds)でローカル楽観更新し、全体 refresh はしない（即反映）。
          const r = await dataObjectAnnotationApi.applyScopeLinks(id);
          if (r.objectIds.length > 0) {
            const ids = new Set(r.objectIds);
            setGraph((g) =>
              g
                ? {
                    ...g,
                    objects: g.objects.map((o) =>
                      ids.has(o.id) ? { ...o, subProjectId: r.subProjectId } : o,
                    ),
                  }
                : g,
            );
          }
        }
      } catch (err) {
        showError(err, 'スコープ囲みの更新に失敗しました');
        await refresh();
      }
    },
    [refresh, showError],
  );

  const handleDeleteScope = useCallback(
    async (id: string) => {
      // 楽観: 即除去（保存は裏で）
      setAnnotations((list) => list.filter((a) => a.id !== id));
      try {
        await dataObjectAnnotationApi.remove(id);
      } catch (err) {
        showError(err, 'スコープ囲みの削除に失敗しました');
        await refresh(); // 失敗時のみ巻き戻し
      }
    },
    [refresh, showError],
  );

  // ===== Mermaidから生成（バックグラウンドジョブ経由） =====
  // AI_MERMAID_OBJECTMAP を起票し、jobId を state へ → useBackgroundJob が監視する。
  // 返す Promise はジョブの終端状態で解決/棄却する（下の effect で settle）。
  //   SUCCEEDED: result.graph をマップへ反映し再取得して resolve（ダイアログが閉じる）。
  //   FAILED:    error で reject（キャンバス側ダイアログがエラー表示する）。
  const handleImportMermaid = useCallback(
    (mermaid: string): Promise<void> => {
      return new Promise<void>((resolve, reject) => {
        // 直前の未解決ジョブがあれば棄却（多重起票の取りこぼし防止）。
        mermaidSettlers.current?.reject(new Error('別のMermaid生成が開始されました'));
        mermaidSettlers.current = { resolve, reject };
        enqueueAiJob(projectId, 'AI_MERMAID_OBJECTMAP', { mermaid })
          .then(({ jobId }) => {
            jobsPanelRef.current?.refresh();
            setMermaidJobId(jobId);
          })
          .catch((err) => {
            mermaidSettlers.current = null;
            reject(err instanceof Error ? err : new Error('ジョブの起票に失敗しました'));
          });
      });
    },
    [projectId],
  );

  // Mermaid生成ジョブが終端に達したら Promise を settle し、後始末する。
  useEffect(() => {
    if (!mermaidJob) return;
    if (mermaidJob.status !== 'SUCCEEDED' && mermaidJob.status !== 'FAILED') return;
    const settlers = mermaidSettlers.current;
    mermaidSettlers.current = null;
    setMermaidJobId(null); // 監視停止
    jobsPanelRef.current?.refresh();

    if (mermaidJob.status === 'FAILED') {
      settlers?.reject(new Error(mermaidJob.error ?? 'Mermaidからの生成に失敗しました'));
      return;
    }
    // SUCCEEDED: result = { kind: 'OBJECT_GRAPH', graph }
    const result = mermaidJob.result as { kind?: string; graph?: JobObjectGraph } | null;
    if (result?.graph) setGraph(result.graph);
    void refresh().finally(() => settlers?.resolve()); // 再取得後にダイアログを閉じる
  }, [mermaidJob, refresh]);

  // ===== 画像要素（ImageElement）の作成・ジオメトリ変更（デバウンス保存） =====
  const pendingImgGeom = useRef(new Map<string, Partial<DiagramElementDto>>());
  const imgGeomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (imgGeomTimer.current) clearTimeout(imgGeomTimer.current);
    };
  }, []);

  const handleImageCreated = useCallback((el: DiagramElementDto) => {
    setImageElements((prev) => [...prev, el]);
  }, []);

  const handleImageGeometryChanged = useCallback(
    (id: string, patch: { positionX?: number; positionY?: number; width?: number; height?: number }) => {
      // 楽観更新
      setImageElements((prev) =>
        prev.map((el) => (el.id === id ? { ...el, ...patch } : el)),
      );
      pendingImgGeom.current.set(id, { ...(pendingImgGeom.current.get(id) ?? {}), ...patch });
      if (imgGeomTimer.current) clearTimeout(imgGeomTimer.current);
      imgGeomTimer.current = setTimeout(() => {
        const entries = Array.from(pendingImgGeom.current.entries());
        pendingImgGeom.current.clear();
        for (const [eid, p] of entries) {
          void diagramElementApi.patch(eid, p).catch((err) => showError(err, '画像要素の保存に失敗しました'));
        }
      }, 600);
    },
    [showError],
  );

  // ===== オブジェクトの領域紐付け（領域紐付けパネル） =====
  const handleLinkObjectToSubProject = useCallback(
    async (objectId: string, subProjectId: string | null) => {
      setSavingScopeObjectId(objectId);
      // 楽観更新
      setGraph((g) =>
        g
          ? { ...g, objects: g.objects.map((o) => (o.id === objectId ? { ...o, subProjectId } : o)) }
          : g,
      );
      try {
        await dataObjectApi.linkObjectToSubProject(objectId, subProjectId);
      } catch (err) {
        showError(err, '領域の紐付けに失敗しました');
        await refresh();
      } finally {
        setSavingScopeObjectId(null);
      }
    },
    [refresh, showError],
  );

  // ===== 囲い(SCOPE=領域) への編入＋はみ出し追従リサイズ =====
  // オブジェクト移動確定時に、領域付き囲みの中心内に入ったら領域へ編入し、
  // カードが囲みからはみ出したら囲みを拡大して内包する（手動サイズは保持・縮小しない）。
  // 中心が囲みの外に出たオブジェクトは（その囲みの）追従対象外＝暴走拡大を防ぐ。
  const applyScopeMembershipOnMove = useCallback(
    (id: string, x: number, y: number) => {
      const obj = graph?.objects.find((o) => o.id === id);
      const cx = x + CARD_W / 2;
      const cy = y + CARD_H / 2;
      const scope = annotations.find((a) => {
        if (a.kind !== 'SCOPE' || !a.subProjectId) return false;
        const w = a.width ?? 320;
        const h = a.height ?? 200;
        return (
          cx >= a.positionX &&
          cx <= a.positionX + w &&
          cy >= a.positionY &&
          cy <= a.positionY + h
        );
      });
      if (!scope || !scope.subProjectId) return;
      // ① 領域編入（未所属/別領域なら）
      if (obj && obj.subProjectId !== scope.subProjectId) {
        void handleLinkObjectToSubProject(id, scope.subProjectId);
      }
      // ② はみ出し拡大（カード矩形を内包するよう成長。縮小はしない）
      const PAD = 16;
      const w = scope.width ?? 320;
      const h = scope.height ?? 200;
      const minX = Math.min(scope.positionX, x - PAD);
      const minY = Math.min(scope.positionY, y - PAD);
      const maxX = Math.max(scope.positionX + w, x + CARD_W + PAD);
      const maxY = Math.max(scope.positionY + h, y + CARD_H + PAD);
      if (
        minX < scope.positionX ||
        minY < scope.positionY ||
        maxX > scope.positionX + w ||
        maxY > scope.positionY + h
      ) {
        handleScopeGeometryChanged(scope.id, {
          positionX: Math.round(minX),
          positionY: Math.round(minY),
          width: Math.round(maxX - minX),
          height: Math.round(maxY - minY),
        });
      }
    },
    [graph, annotations, handleLinkObjectToSubProject, handleScopeGeometryChanged],
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
            <FeatureSectionIo
              projectId={projectId}
              sectionKey="dataObjects"
              label="データオブジェクト"
              canEdit={canEdit}
              onDone={() => void load(true)}
            />
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

      {/* Mermaid生成ジョブの進捗（useBackgroundJob 監視中のみ表示） */}
      {mermaidJob && (mermaidJob.status === 'QUEUED' || mermaidJob.status === 'RUNNING') && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span>
            Mermaidからオブジェクト関係性マップを生成中…（{mermaidJob.status} {mermaidJob.progress}%）
          </span>
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
            {canEdit && (
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
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ===== 領域一覧パネル＋キャンバス＋右サイドパネル ===== */}
          <div className="flex h-[calc(100vh-340px)] min-h-[420px] gap-3">
            <ScopeMembersPanel
              objects={objects}
              subProjects={subProjects}
              selectedObjectId={selectedObjectId}
              onFocusObject={(id) => {
                setSelectedObjectId(id);
                setFocusNonce((n) => n + 1);
              }}
            />
            <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-gray-200">
              <ObjectMapCanvas
                objects={objects}
                relations={relations}
                annotations={annotations}
                subProjects={subProjects}
                selectedObjectId={selectedObjectId}
                onSelectObject={setSelectedObjectId}
                focusObjectId={selectedObjectId}
                focusNonce={focusNonce}
                onObjectMoved={(id, x, y) => {
                  handleObjectMoved(id, x, y);
                  applyScopeMembershipOnMove(id, x, y);
                }}
                onObjectMovedSilent={handleObjectMoved}
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
                onAddScope={handleAddScope}
                onScopeGeometryChanged={handleScopeGeometryChanged}
                onUpdateScope={handleUpdateScope}
                onDeleteScope={handleDeleteScope}
                onImportMermaid={handleImportMermaid}
                readOnly={!canEdit}
                imageElements={imageElements}
                projectId={projectId}
                onImageCreated={handleImageCreated}
                onImageGeometryChanged={handleImageGeometryChanged}
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

          {/* ===== 一覧ビュー（閲覧専用時は編集系を無効化。行選択は維持） ===== */}
          <EditGate dim={false}>
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
            {/* ===== 領域紐付け（オブジェクト × 領域） ===== */}
            <ObjectScopeLinkPanel
              objects={objects}
              subProjects={subProjects}
              savingObjectId={savingScopeObjectId}
              onLinkChange={handleLinkObjectToSubProject}
            />
          </div>
          </EditGate>
        </>
      )}

      {/* ===== バックグラウンド処理一覧（Mermaid→マップ生成などのAIジョブ） ===== */}
      {!loading && !error && (
        <BackgroundJobsPanel ref={jobsPanelRef} projectId={projectId} />
      )}
    </div>
  );
}
