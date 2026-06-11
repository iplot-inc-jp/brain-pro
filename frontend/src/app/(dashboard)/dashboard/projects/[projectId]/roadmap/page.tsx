'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { ManualButton } from '@/components/ui/manual-dialog';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Loader2,
  // lucide の Map はグローバルの Map コンストラクタと衝突するため alias する
  Map as MapIcon,
  GitCompareArrows,
  Check,
  Save,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Target,
  Milestone,
  FolderTree,
} from 'lucide-react';
import { gapLedgerApi } from '@/lib/gap-ledger';
import {
  roadmapPhaseApi,
  phaseStorageKey,
  resolvePhase,
  type RoadmapPhase,
} from '@/lib/roadmap-phases';
import {
  tobeRoadmapApi,
  tobeVisionApi,
  type TobeRoadmap,
  type TobeVision,
} from '@/lib/asis-tobe';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

type GapItem = {
  id: string;
  businessArea: string;
  gapDescription: string | null;
  asisDescription: string | null;
  tobeDescription: string | null;
  priority: Priority;
  status: string;
  // TOBE打ち手カードとの突き合わせ用（業務フローへの紐づけ）
  asisFlowId: string | null;
  tobeFlowId: string | null;
};

type FlowKind = 'ASIS' | 'TOBE';

// 業務フロー（GET /api/business-flows/project/:projectId/all）。
// TOBEフローの asisFlowId（対応ASIS）で TOBE打ち手 ⇔ GAP の橋渡しをする。
type BusinessFlow = {
  id: string;
  name: string;
  kind: FlowKind;
  subProjectId?: string | null;
  asisFlowId?: string | null;
};

// 1行 = gapId ごとのフェーズ割当。
// phase は GapLedger.phase の生値（フェーズ行の legacyKey ?? name。未分類は 'NONE'）。
type RoadmapRow = {
  gapId: string;
  phase: string;
  target: string;
  order: number;
  note: string;
};

// 表示切替（TOBE打ち手 / GAP / 両方）。localStorage 'roadmap-view:{projectId}' に保持。
type RoadmapView = 'TOBE' | 'GAP' | 'BOTH';
const VIEW_OPTIONS: { value: RoadmapView; label: string }[] = [
  { value: 'TOBE', label: 'TOBE打ち手' },
  { value: 'GAP', label: 'GAP' },
  { value: 'BOTH', label: '両方' },
];
const viewStorageKey = (projectId: string) => `roadmap-view:${projectId}`;

// 領域フィルタの「すべて」センチネル
const AREA_ALL = 'ALL';

// 末尾固定の「未分類」列（編集・削除不可）。
// GapLedger.phase には 'NONE' を保存（旧固定フェーズ時代と同じ）。
// TobeRoadmap.phase は自由文字列なので未分類は null を保存する。
const UNASSIGNED_ID = 'NONE';
const UNASSIGNED_LABEL = '未分類';
const UNASSIGNED_KEY = 'NONE';

// 列ごとの白テーマ配色（フェーズは order 順にパレットを循環）
type ColumnStyle = { head: string; dot: string };
const PHASE_PALETTE: ColumnStyle[] = [
  { head: 'text-blue-700 bg-blue-50 border-blue-200', dot: 'bg-blue-500' },
  { head: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
  { head: 'text-indigo-700 bg-indigo-50 border-indigo-200', dot: 'bg-indigo-500' },
  { head: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-500' },
  { head: 'text-rose-700 bg-rose-50 border-rose-200', dot: 'bg-rose-500' },
  { head: 'text-cyan-700 bg-cyan-50 border-cyan-200', dot: 'bg-cyan-500' },
];
const UNASSIGNED_STYLE: ColumnStyle = {
  head: 'text-gray-600 bg-gray-50 border-gray-200',
  dot: 'bg-gray-400',
};

// カンバン列 = フェーズ行（order 昇順）+ 末尾固定「未分類」
type PhaseColumn = {
  id: string; // phase.id（未分類は 'NONE'）
  name: string;
  storageKey: string; // GapLedger.phase に保存する値（legacyKey ?? name / 'NONE'）
  phase: RoadmapPhase | null; // 未分類は null
  style: ColumnStyle;
};

// 優先度バッジ（高=rose / 中=amber / 低=gray）
const priorityMeta: Record<Priority, { label: string; badge: string; rank: number }> = {
  HIGH: { label: '高', badge: 'text-rose-700 bg-rose-50 border-rose-300', rank: 0 },
  MEDIUM: { label: '中', badge: 'text-amber-700 bg-amber-50 border-amber-300', rank: 1 },
  LOW: { label: '低', badge: 'text-gray-600 bg-gray-50 border-gray-300', rank: 2 },
};

// 列内のカード（TOBE打ち手 / GAP）。draggableId は 'tobe:'/'gap:' プレフィックスで衝突回避。
type GapCard = { kind: 'gap'; gap: GapItem; row: RoadmapRow; areaId: string | null };
type TobeCard = {
  kind: 'tobe';
  tobe: TobeRoadmap;
  vision: TobeVision | null;
  areaId: string | null;
  gaps: GapItem[];
};
type ColumnCard = GapCard | TobeCard;

/**
 * 領域(parentId==null)→サブ領域(parentId 有り) の入れ子を DFS 順（親→その子…）に並べ替え、
 * depth 付きのフラット配列にする。孤児（親が一覧に存在しない）はトップ領域扱い。
 * 循環(parentId ループ)は visited ガードで無限再帰しない。
 */
function flattenSubProjects(
  list: SubProjectMaster[],
): { sub: SubProjectMaster; depth: number }[] {
  const byId = new Map(list.map((s) => [s.id, s]));
  const childrenOf = new Map<string | null, SubProjectMaster[]>();
  for (const s of list) {
    const key = s.parentId && byId.has(s.parentId) ? s.parentId : null;
    const arr = childrenOf.get(key) ?? [];
    arr.push(s);
    childrenOf.set(key, arr);
  }
  const out: { sub: SubProjectMaster; depth: number }[] = [];
  const visited = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    const children = (childrenOf.get(parentId) ?? []).sort(
      (a, b) => a.order - b.order || a.name.localeCompare(b.name),
    );
    for (const sub of children) {
      if (visited.has(sub.id)) continue;
      visited.add(sub.id);
      out.push({ sub, depth });
      walk(sub.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function RoadmapPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [gapItems, setGapItems] = useState<GapItem[]>([]);
  // gapId -> RoadmapRow
  const [assignments, setAssignments] = useState<Record<string, RoadmapRow>>({});
  // RoadmapPhase マスタ（列定義）。list がバックエンドで初期3フェーズをシード。
  const [phases, setPhases] = useState<RoadmapPhase[]>([]);
  // TOBE起点のデータ（段階設計 / あるべき姿・打ち手 / 領域 / 業務フロー）
  const [tobeRows, setTobeRows] = useState<TobeRoadmap[]>([]);
  const [tobeVisions, setTobeVisions] = useState<TobeVision[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [flows, setFlows] = useState<BusinessFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [howToOpen, setHowToOpen] = useState(false);

  // 表示切替（既定 'TOBE'。localStorage に保持）
  const [view, setView] = useState<RoadmapView>('TOBE');
  // 領域フィルタ（TOBE/両方ビューのみ。'ALL' = すべて）
  const [areaFilter, setAreaFilter] = useState<string>(AREA_ALL);
  // 領域ごとにグループ表示（列内に領域見出しを挿入）
  const [groupByArea, setGroupByArea] = useState(false);
  // TOBEカードの「GAP n件」展開状態（tobeRoadmapId の集合）
  const [openGapLists, setOpenGapLists] = useState<Set<string>>(new Set());

  // ＋打ち手を追加 ダイアログ
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addVisionId, setAddVisionId] = useState('');
  const [addMeasure, setAddMeasure] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  // フェーズ名のインライン編集
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const cancelEditRef = useRef(false);

  // 保存済みの表示切替を復元
  useEffect(() => {
    try {
      const raw = localStorage.getItem(viewStorageKey(projectId));
      if (raw === 'TOBE' || raw === 'GAP' || raw === 'BOTH') setView(raw);
    } catch {
      // localStorage 不可の環境では既定 'TOBE' のまま
    }
  }, [projectId]);

  const changeView = useCallback(
    (v: RoadmapView) => {
      setView(v);
      try {
        localStorage.setItem(viewStorageKey(projectId), v);
      } catch {
        // 保持できなくても表示自体は切り替える
      }
    },
    [projectId],
  );

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  // GAP一覧 + GAP台帳（GapLedger.phase）+ フェーズマスタ + TOBE側
  // （段階設計 / あるべき姿 / 領域 / 業務フロー）を同時取得して join
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = getHeaders();
      const [gapRes, ledgers, phaseRows, tobeData, visionData, subData, flowRes] =
        await Promise.all([
          fetch(`${API_URL}/api/projects/${projectId}/gap-items`, { headers }),
          gapLedgerApi.list(projectId).catch(() => []),
          roadmapPhaseApi.list(projectId),
          tobeRoadmapApi.list(projectId).catch(() => [] as TobeRoadmap[]),
          tobeVisionApi.list(projectId).catch(() => [] as TobeVision[]),
          subProjectApi.list(projectId).catch(() => [] as SubProjectMaster[]),
          fetch(`${API_URL}/api/business-flows/project/${projectId}/all`, {
            headers,
          }).catch(() => null),
        ]);

      if (!gapRes.ok) {
        setError('GAP一覧の取得に失敗しました');
        return;
      }
      const gaps: GapItem[] = await gapRes.json();
      setGapItems(gaps);
      setPhases(phaseRows);
      setTobeRows(Array.isArray(tobeData) ? tobeData : []);
      setTobeVisions(Array.isArray(visionData) ? visionData : []);
      setSubProjects(Array.isArray(subData) ? subData : []);
      if (flowRes && flowRes.ok) {
        const flowData = await flowRes.json();
        setFlows(Array.isArray(flowData) ? flowData : []);
      } else {
        setFlows([]);
      }

      // 各 GAP の台帳行から phase（生値）を読み、割当マップを作る
      const map: Record<string, RoadmapRow> = {};
      ledgers.forEach((r) => {
        if (r && typeof r.gapId === 'string') {
          map[r.gapId] = {
            gapId: r.gapId,
            phase: r.phase ?? UNASSIGNED_KEY,
            target: r.target ?? '',
            order: r.order ?? 0,
            note: r.note ?? '',
          };
        }
      });
      setAssignments(map);
    } catch (err) {
      console.error('Failed to fetch roadmap:', err);
      setError('エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // order 昇順のフェーズ列
  const sortedPhases = useMemo(
    () =>
      [...phases].sort(
        (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt),
      ),
    [phases],
  );

  // カンバン列 = フェーズ行（order 昇順）+ 末尾固定「未分類」
  const phaseColumns = useMemo<PhaseColumn[]>(
    () => [
      ...sortedPhases.map((p, i) => ({
        id: p.id,
        name: p.name,
        storageKey: phaseStorageKey(p),
        phase: p,
        style: PHASE_PALETTE[i % PHASE_PALETTE.length],
      })),
      {
        id: UNASSIGNED_ID,
        name: UNASSIGNED_LABEL,
        storageKey: UNASSIGNED_KEY,
        phase: null,
        style: UNASSIGNED_STYLE,
      },
    ],
    [sortedPhases],
  );

  // 領域→サブ領域 を入れ子（DFS・循環ガード付き）で並べた一覧（フィルタ select / グループ見出し用）
  const flatSubProjects = useMemo(() => flattenSubProjects(subProjects), [subProjects]);

  // 領域フィルタ：選択領域 + その子孫の id 集合（null = フィルタなし）。
  // GAP単独表示では領域フィルタを出さない（再設計前と同一の挙動を維持）。
  const filterAreaIds = useMemo<Set<string> | null>(() => {
    if (view === 'GAP' || areaFilter === AREA_ALL) return null;
    if (!subProjects.some((s) => s.id === areaFilter)) return null;
    const set = new Set<string>([areaFilter]);
    // 子孫を固定点まで収集（集合は単調増加なので循環があっても停止する）
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of subProjects) {
        if (s.parentId && set.has(s.parentId) && !set.has(s.id)) {
          set.add(s.id);
          grew = true;
        }
      }
    }
    return set;
  }, [view, areaFilter, subProjects]);

  // 領域パス『親領域 > サブ領域』（循環ガード付きで parentId を遡る）
  const areaPath = useCallback(
    (id: string | null): string | null => {
      if (!id) return null;
      const byId = new Map(subProjects.map((s) => [s.id, s]));
      const names: string[] = [];
      const seen = new Set<string>();
      let cur = byId.get(id);
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        names.unshift(cur.name);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      return names.length ? names.join(' > ') : null;
    },
    [subProjects],
  );

  // GAPカードの領域解決（asisFlowId / tobeFlowId → 業務フローの subProjectId）。
  // 両方表示でのフィルタ・領域グループ用（GAP単独表示では使わない）。
  const gapAreaId = useCallback(
    (g: GapItem): string | null => {
      const flow =
        flows.find((f) => f.id === g.asisFlowId) ??
        flows.find((f) => f.id === g.tobeFlowId);
      return flow?.subProjectId ?? null;
    },
    [flows],
  );

  // 現時点の割当を {gapId, phase, target, note, order} で保存。
  // impact/difficulty/toComplete（ledger タブ所有）は送らないのでマージ更新で保持される。
  const persist = useCallback(
    async (next: Record<string, RoadmapRow>) => {
      setSaving(true);
      try {
        const rows = gapItems.map((g) => {
          const a = next[g.id];
          return {
            gapId: g.id,
            phase: a?.phase ?? UNASSIGNED_KEY,
            target: a?.target ?? '',
            note: a?.note ?? '',
            order: a?.order ?? 0,
          };
        });
        await gapLedgerApi.save(projectId, rows);
        setSavedAt(Date.now());
      } catch (err) {
        console.error('Failed to save roadmap:', err);
        setError('保存に失敗しました');
      } finally {
        setSaving(false);
      }
    },
    [projectId, gapItems],
  );

  // 1件の割当を更新してオートセーブ
  const updateAssignment = useCallback(
    (gapId: string, patch: Partial<RoadmapRow>) => {
      setAssignments((prev) => {
        const current = prev[gapId] ?? {
          gapId,
          phase: UNASSIGNED_KEY,
          target: '',
          order: 0,
          note: '',
        };
        const next = { ...prev, [gapId]: { ...current, ...patch } };
        // オートセーブ（GAP一覧が読めている時のみ）
        void persist(next);
        return next;
      });
    },
    [persist],
  );

  // TOBE打ち手カードのドロップ：TobeRoadmap.phase はTOBE管理ページの
  // 「フェーズ」列にそのまま見えるユーザー可視の自由文字列なので、
  // GapLedger と違い storageKey（legacyKey 'Q' 等の内部キー）ではなく
  // フェーズ名（人間可読）を保存する。未分類は null。
  // 読み込みは resolvePhase が name 一致でも解決するので往復できる。
  const moveTobe = useCallback(
    async (tobeId: string, col: PhaseColumn) => {
      const phase = col.phase ? col.phase.name : null;
      // 失敗時に巻き戻せるよう楽観更新前の値を控える
      const prevPhase = tobeRows.find((r) => r.id === tobeId)?.phase ?? null;
      setTobeRows((prev) => prev.map((r) => (r.id === tobeId ? { ...r, phase } : r)));
      setSaving(true);
      try {
        await tobeRoadmapApi.update(tobeId, { phase });
        setSavedAt(Date.now());
      } catch (err) {
        console.error('Failed to move tobe roadmap row:', err);
        // 楽観更新を巻き戻す（サーバは旧フェーズのまま。TOBE は行単位保存で
        // GAP のように次回 persist で自己修復しないため明示的に戻す）
        setTobeRows((prev) =>
          prev.map((r) => (r.id === tobeId ? { ...r, phase: prevPhase } : r)),
        );
        setError('打ち手の保存に失敗しました');
      } finally {
        setSaving(false);
      }
    },
    [tobeRows],
  );

  // カンバン：カードを別フェーズ列へドロップしたとき、draggableId の
  // 'tobe:'/'gap:' プレフィックスで振り分けて保存（オートセーブ）。
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { destination, source, draggableId } = result;
      if (!destination) return; // 列外へのドロップは無視
      const col = phaseColumns.find((c) => c.id === destination.droppableId);
      if (!col) return;
      // 同一フェーズ列内（並べ替えのみ）は永続化しても意味がないので no-op
      if (destination.droppableId === source.droppableId) return;
      const sep = draggableId.indexOf(':');
      if (sep < 0) return;
      const kind = draggableId.slice(0, sep);
      const id = draggableId.slice(sep + 1);
      if (kind === 'gap') {
        updateAssignment(id, { phase: col.storageKey });
      } else if (kind === 'tobe') {
        void moveTobe(id, col);
      }
    },
    [phaseColumns, updateAssignment, moveTobe],
  );

  // 全件まとめて保存（保存ボタン）
  const handleSaveAll = useCallback(() => {
    void persist(assignments);
  }, [persist, assignments]);

  // フェーズごとにカードを束ねる。
  // - TOBE打ち手カード（TOBE/両方表示）: TobeRoadmap 1行 = 1カード。
  //   フェーズ解決は resolvePhase（旧自由入力 '3ヶ月以内 (Quick Win)' 等は name 一致で解決）。
  // - GAPカード（GAP/両方表示）: 再設計前と同一の組み立て（優先度→order でソート）。
  // - 両方表示では同じ列に TOBE → GAP の順で混在させる。
  const columnCards = useMemo(() => {
    const byCol: Record<string, ColumnCard[]> = {};
    phaseColumns.forEach((c) => (byCol[c.id] = []));

    if (view !== 'GAP') {
      // TOBE打ち手カード（order 昇順）
      const visionById = new Map(tobeVisions.map((v) => [v.id, v]));
      // vision.asisFlowId → 対応TOBEフロー（複数あり得る） → 紐づくGAP
      // （asisFlowId 一致 or tobeFlowId 一致）。
      // ASIS→TOBE は 1:1 とは限らない（案・ドラフト等が同じ asisFlowId を
      // 参照し得る）ので、一致する TOBE フローを全部拾う。
      const gapsFor = (vision: TobeVision | null): GapItem[] => {
        if (!vision?.asisFlowId) return [];
        const tobeFlowIds = new Set(
          flows
            .filter((f) => f.kind === 'TOBE' && f.asisFlowId === vision.asisFlowId)
            .map((f) => f.id),
        );
        return gapItems.filter(
          (g) =>
            g.asisFlowId === vision.asisFlowId ||
            (g.tobeFlowId != null && tobeFlowIds.has(g.tobeFlowId)),
        );
      };
      const sortedTobe = [...tobeRows].sort(
        (a, b) =>
          (a.order ?? 0) - (b.order ?? 0) ||
          (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
      );
      sortedTobe.forEach((t) => {
        const vision = (t.tobeVisionId && visionById.get(t.tobeVisionId)) || null;
        const areaId = t.subProjectId ?? vision?.subProjectId ?? null;
        if (filterAreaIds && !(areaId && filterAreaIds.has(areaId))) return;
        const colId = resolvePhase(t.phase, sortedPhases)?.id ?? UNASSIGNED_ID;
        byCol[colId].push({ kind: 'tobe', tobe: t, vision, areaId, gaps: gapsFor(vision) });
      });
    }

    if (view !== 'TOBE') {
      // GAPカード（優先度→order）。GAP単独表示では領域フィルタを適用しない（従来どおり）。
      const gapByCol: Record<string, GapCard[]> = {};
      phaseColumns.forEach((c) => (gapByCol[c.id] = []));
      gapItems.forEach((g, i) => {
        const row: RoadmapRow = assignments[g.id] ?? {
          gapId: g.id,
          phase: UNASSIGNED_KEY,
          target: '',
          order: i,
          note: '',
        };
        const areaId = gapAreaId(g);
        if (view === 'BOTH' && filterAreaIds && !(areaId && filterAreaIds.has(areaId))) {
          return;
        }
        const colId = resolvePhase(row.phase, sortedPhases)?.id ?? UNASSIGNED_ID;
        gapByCol[colId].push({ kind: 'gap', gap: g, row, areaId });
      });
      phaseColumns.forEach((c) => {
        gapByCol[c.id].sort((a, b) => {
          const pa = priorityMeta[a.gap.priority]?.rank ?? 1;
          const pb = priorityMeta[b.gap.priority]?.rank ?? 1;
          if (pa !== pb) return pa - pb;
          return (a.row.order ?? 0) - (b.row.order ?? 0);
        });
        byCol[c.id].push(...gapByCol[c.id]);
      });
    }

    return byCol;
  }, [
    view,
    tobeRows,
    tobeVisions,
    flows,
    gapItems,
    assignments,
    phaseColumns,
    sortedPhases,
    filterAreaIds,
    gapAreaId,
  ]);

  // ---------------------------------------------------------------------------
  // フェーズ（列）の編集
  // ---------------------------------------------------------------------------

  const startEditing = useCallback((phase: RoadmapPhase) => {
    cancelEditRef.current = false;
    setEditingPhaseId(phase.id);
    setEditingName(phase.name);
  }, []);

  // インライン改名の確定（PATCH）。
  // custom フェーズ（legacyKey null）は phase 値が name 保存のため、
  // その列の既存カードの assignments を新 name で再保存する。
  // legacyKey 行（Q/P2/P3）は保存値が legacyKey のままなので表示が変わるだけ。
  // TOBE打ち手（TobeRoadmap.phase 自由文字列・TOBE管理でユーザー可視）は
  // この列に解決されていた行を新しいフェーズ名（人間可読）へ正規化して保存する
  // （旧 storageKey 保存値 'Q'/'P2'/'P3' や旧自由入力もここで吸収される）。
  const commitRename = useCallback(async () => {
    const phase = phases.find((p) => p.id === editingPhaseId);
    setEditingPhaseId(null);
    if (!phase) return;
    const newName = editingName.trim();
    if (!newName || newName === phase.name) return;
    try {
      const updated = await roadmapPhaseApi.update(phase.id, { name: newName });
      setPhases((prev) => prev.map((p) => (p.id === phase.id ? updated : p)));
      if (!phase.legacyKey) {
        const next: Record<string, RoadmapRow> = {};
        let changed = false;
        Object.entries(assignments).forEach(([gapId, row]) => {
          if (row.phase === phase.name) {
            next[gapId] = { ...row, phase: newName };
            changed = true;
          } else {
            next[gapId] = row;
          }
        });
        if (changed) {
          setAssignments(next);
          await persist(next);
        }
      }
      // TOBE側: 改名前にこの列へ解決されていた行を新フェーズ名へ揃える
      // （ユーザー可視カラムなので storageKey ではなく name を保存する）
      const updatedKey = updated.name;
      const affectedTobe = tobeRows.filter(
        (r) => resolvePhase(r.phase, phases)?.id === phase.id && r.phase !== updatedKey,
      );
      if (affectedTobe.length > 0) {
        const ids = new Set(affectedTobe.map((r) => r.id));
        setTobeRows((prev) =>
          prev.map((r) => (ids.has(r.id) ? { ...r, phase: updatedKey } : r)),
        );
        await Promise.all(
          affectedTobe.map((r) => tobeRoadmapApi.update(r.id, { phase: updatedKey })),
        );
      }
    } catch (err) {
      console.error('Failed to rename phase:', err);
      setError('フェーズの改名に失敗しました');
    }
  }, [phases, editingPhaseId, editingName, assignments, persist, tobeRows]);

  // 「＋フェーズ追加」: 末尾（未分類の前）に挿入し、すぐ改名モードへ
  const handleAddPhase = useCallback(async () => {
    try {
      const maxOrder = phases.reduce((m, p) => Math.max(m, p.order), -1);
      const created = await roadmapPhaseApi.create(projectId, {
        name: '新フェーズ',
        order: maxOrder + 1,
      });
      setPhases((prev) => [...prev, created]);
      startEditing(created);
    } catch (err) {
      console.error('Failed to add phase:', err);
      setError('フェーズの追加に失敗しました');
    }
  }, [phases, projectId, startEditing]);

  // ←/→ で隣のフェーズと order を入替（PATCH×2）
  const handleMovePhase = useCallback(
    async (phaseId: string, dir: -1 | 1) => {
      const idx = sortedPhases.findIndex((p) => p.id === phaseId);
      const target = sortedPhases[idx];
      const neighbor = sortedPhases[idx + dir];
      if (!target || !neighbor) return;
      // order が同値だと入替が no-op になるため index ベースで振り直す
      let orderA = neighbor.order;
      let orderB = target.order;
      if (orderA === orderB) {
        orderA = idx + dir;
        orderB = idx;
      }
      setPhases((prev) =>
        prev.map((p) =>
          p.id === target.id
            ? { ...p, order: orderA }
            : p.id === neighbor.id
              ? { ...p, order: orderB }
              : p,
        ),
      );
      try {
        await Promise.all([
          roadmapPhaseApi.update(target.id, { order: orderA }),
          roadmapPhaseApi.update(neighbor.id, { order: orderB }),
        ]);
      } catch (err) {
        console.error('Failed to reorder phases:', err);
        setError('フェーズの並べ替えに失敗しました');
      }
    },
    [sortedPhases],
  );

  // フェーズ削除（confirm）。削除前にその列のカード（GAP/TOBE双方）を未分類へ移してから DELETE。
  const handleDeletePhase = useCallback(
    async (phase: RoadmapPhase) => {
      if (
        !window.confirm(
          `フェーズ「${phase.name}」を削除しますか？\nこの列のカードは「${UNASSIGNED_LABEL}」へ移動します。`,
        )
      ) {
        return;
      }
      try {
        const next: Record<string, RoadmapRow> = {};
        let moved = false;
        Object.entries(assignments).forEach(([gapId, row]) => {
          if (resolvePhase(row.phase, sortedPhases)?.id === phase.id) {
            next[gapId] = { ...row, phase: UNASSIGNED_KEY };
            moved = true;
          } else {
            next[gapId] = row;
          }
        });
        if (moved) {
          setAssignments(next);
          await persist(next);
        }
        // TOBE側: この列に解決されていた打ち手を未分類（null）へ
        const affectedTobe = tobeRows.filter(
          (r) => resolvePhase(r.phase, sortedPhases)?.id === phase.id,
        );
        if (affectedTobe.length > 0) {
          const ids = new Set(affectedTobe.map((r) => r.id));
          setTobeRows((prev) =>
            prev.map((r) => (ids.has(r.id) ? { ...r, phase: null } : r)),
          );
          await Promise.all(
            affectedTobe.map((r) => tobeRoadmapApi.update(r.id, { phase: null })),
          );
        }
        await roadmapPhaseApi.delete(phase.id);
        setPhases((prev) => prev.filter((p) => p.id !== phase.id));
      } catch (err) {
        console.error('Failed to delete phase:', err);
        setError('フェーズの削除に失敗しました');
      }
    },
    [assignments, sortedPhases, persist, tobeRows],
  );

  // ---------------------------------------------------------------------------
  // ＋打ち手を追加（未分類列に TobeRoadmap.create。任意で TobeVision を紐づけ）
  // ---------------------------------------------------------------------------

  const handleAddTobe = useCallback(async () => {
    const vision = tobeVisions.find((v) => v.id === addVisionId) ?? null;
    const measure = addMeasure.trim();
    if (!vision && !measure) return;
    setAddSaving(true);
    try {
      const maxOrder = tobeRows.reduce((m, r) => Math.max(m, r.order ?? 0), -1);
      const created = await tobeRoadmapApi.create(projectId, {
        tobeVisionId: vision?.id ?? null,
        measure: measure || null,
        subProjectId: vision?.subProjectId ?? null,
        phase: null, // 未分類列へ
        order: maxOrder + 1,
      });
      setTobeRows((prev) => [...prev, created]);
      // 領域フィルタで新カードが即座に隠れる場合はフィルタを解除する
      // （「未分類」列に入ると案内した直後に見えないと追加失敗に見えるため）
      if (
        filterAreaIds &&
        !(created.subProjectId && filterAreaIds.has(created.subProjectId))
      ) {
        setAreaFilter(AREA_ALL);
      }
      setIsAddOpen(false);
      setAddVisionId('');
      setAddMeasure('');
    } catch (err) {
      console.error('Failed to add tobe roadmap row:', err);
      setError('打ち手の追加に失敗しました');
    } finally {
      setAddSaving(false);
    }
  }, [projectId, tobeVisions, tobeRows, addVisionId, addMeasure, filterAreaIds]);

  const toggleGapList = useCallback((tobeId: string) => {
    setOpenGapLists((prev) => {
      const next = new Set(prev);
      if (next.has(tobeId)) next.delete(tobeId);
      else next.add(tobeId);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // 描画
  // ---------------------------------------------------------------------------

  // GAPカード（再設計前と同一。両方表示のときだけ種別バッジ「GAP」を追加）
  const renderGapCard = (card: GapCard, index: number) => {
    const { gap, row } = card;
    const pm = priorityMeta[gap.priority] ?? priorityMeta.MEDIUM;
    return (
      <Draggable key={`gap:${gap.id}`} draggableId={`gap:${gap.id}`} index={index}>
        {(dragProvided, dragSnapshot) => (
          <Card
            ref={dragProvided.innerRef}
            {...dragProvided.draggableProps}
            // カード全体をドラッグハンドルにする。input/textarea 等の
            // interactive 要素からはドラッグが始まらない（dnd の既定動作）
            // ので target/note の編集はそのまま使える。
            {...dragProvided.dragHandleProps}
            style={dragProvided.draggableProps.style as React.CSSProperties}
            className={`cursor-grab bg-white shadow-sm transition-shadow active:cursor-grabbing ${
              dragSnapshot.isDragging
                ? 'border-blue-300 shadow-md ring-1 ring-blue-200'
                : 'border-gray-200'
            }`}
          >
            <CardContent className="p-3 space-y-2">
              {/* タイトル + ドラッグヒント + （両方表示のみ）種別バッジ + 優先度バッジ */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 min-w-0">
                  <span
                    className="mt-0.5 -ml-1 shrink-0 text-gray-300"
                    title="ドラッグして別フェーズへ移動"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-medium text-gray-900 leading-snug">
                    {gap.businessArea}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {view === 'BOTH' && (
                    <span className="rounded border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">
                      GAP
                    </span>
                  )}
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${pm.badge}`}
                  >
                    {pm.label}
                  </span>
                </span>
              </div>
              {gap.gapDescription && (
                <p className="text-xs text-gray-500 leading-snug line-clamp-3">
                  {gap.gapDescription}
                </p>
              )}

              {/* 期日/目標（target） */}
              <input
                defaultValue={row.target}
                placeholder="期日/目標（例: 9月末までに自動化）"
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (row.target ?? '')) {
                    updateAssignment(gap.id, { target: v });
                  }
                }}
                className="w-full rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-blue-300 placeholder:text-gray-300"
              />

              {/* メモ */}
              <textarea
                defaultValue={row.note}
                placeholder="メモ"
                rows={2}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (row.note ?? '')) {
                    updateAssignment(gap.id, { note: v });
                  }
                }}
                className="w-full resize-none rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:ring-1 focus:ring-blue-300 placeholder:text-gray-300"
              />
            </CardContent>
          </Card>
        )}
      </Draggable>
    );
  };

  // TOBE打ち手カード（TobeRoadmap 1行）。
  // 上段: あるべき姿（小）⊃ 打ち手（主）の階層表示 / 中段: 補足・ROI・コスト・回収のバッジ /
  // 下段: 領域パス + 紐づくGAPバッジ（クリックで展開）。
  const renderTobeCard = (card: TobeCard, index: number) => {
    const { tobe, vision, gaps } = card;
    const counterTitle = vision?.countermeasure?.trim() || '';
    const title = counterTitle || tobe.measure?.trim() || '（打ち手未設定）';
    // measure は vision の打ち手があるときは「補足」としてバッジ表示
    const measureNote =
      counterTitle && tobe.measure?.trim() && tobe.measure.trim() !== counterTitle
        ? tobe.measure.trim()
        : null;
    const path = areaPath(card.areaId);
    const gapsOpen = openGapLists.has(tobe.id);
    return (
      <Draggable key={`tobe:${tobe.id}`} draggableId={`tobe:${tobe.id}`} index={index}>
        {(dragProvided, dragSnapshot) => (
          <Card
            ref={dragProvided.innerRef}
            {...dragProvided.draggableProps}
            {...dragProvided.dragHandleProps}
            style={dragProvided.draggableProps.style as React.CSSProperties}
            className={`cursor-grab bg-white shadow-sm transition-shadow active:cursor-grabbing ${
              dragSnapshot.isDragging
                ? 'border-emerald-300 shadow-md ring-1 ring-emerald-200'
                : 'border-gray-200'
            }`}
          >
            <CardContent className="p-3 space-y-2">
              {/* 上段: あるべき姿（小・親）と打ち手（主・子）の階層表示 */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-1.5">
                  <span
                    className="mt-0.5 -ml-1 shrink-0 text-gray-300"
                    title="ドラッグして別フェーズへ移動"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    {vision?.vision && (
                      <p className="flex items-start gap-1 text-[11px] leading-snug text-gray-400">
                        <Target className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                        <span className="line-clamp-2">あるべき姿: {vision.vision}</span>
                      </p>
                    )}
                    <p className="text-sm font-medium leading-snug text-gray-900">
                      {vision?.vision ? `└ ${title}` : title}
                    </p>
                  </div>
                </div>
                {view === 'BOTH' && (
                  <span className="flex-shrink-0 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                    打ち手
                  </span>
                )}
              </div>

              {/* 中段: 補足（measure）/ ROI / コスト / 回収期間のバッジ */}
              {(measureNote || tobe.roi || tobe.cost || tobe.payback) && (
                <div className="flex flex-wrap gap-1">
                  {measureNote && (
                    <span className="max-w-full truncate rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600">
                      補足: {measureNote}
                    </span>
                  )}
                  {tobe.roi && (
                    <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">
                      ROI: {tobe.roi}
                    </span>
                  )}
                  {tobe.cost && (
                    <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                      コスト: {tobe.cost}
                    </span>
                  )}
                  {tobe.payback && (
                    <span className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">
                      回収: {tobe.payback}
                    </span>
                  )}
                </div>
              )}

              {/* 下段: 領域パス + 紐づくGAP */}
              {(path || gaps.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {path && (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600">
                      <FolderTree className="h-3 w-3 shrink-0 text-gray-400" />
                      <span className="truncate">{path}</span>
                    </span>
                  )}
                  {gaps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleGapList(tobe.id)}
                      title="この打ち手に紐づくGAPを表示"
                      className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
                    >
                      <GitCompareArrows className="h-3 w-3" />
                      GAP {gaps.length}件
                      {gapsOpen ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* 紐づくGAPの展開（説明＋優先度。GAP一覧への導線つき） */}
              {gapsOpen && gaps.length > 0 && (
                <div className="space-y-1 rounded border border-blue-100 bg-blue-50/40 p-2">
                  {gaps.map((g) => {
                    const pm = priorityMeta[g.priority] ?? priorityMeta.MEDIUM;
                    return (
                      <div key={g.id} className="flex items-start gap-1.5">
                        <span
                          className={`mt-px shrink-0 rounded border px-1 text-[10px] font-semibold ${pm.badge}`}
                        >
                          {pm.label}
                        </span>
                        <span className="min-w-0 text-[11px] leading-snug text-gray-600">
                          {g.gapDescription?.trim() || g.businessArea}
                        </span>
                      </div>
                    );
                  })}
                  <Link
                    href={`/dashboard/projects/${projectId}/gap-items`}
                    className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-600 hover:underline"
                  >
                    GAP一覧へ
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </Draggable>
    );
  };

  const renderCard = (card: ColumnCard, index: number) =>
    card.kind === 'gap' ? renderGapCard(card, index) : renderTobeCard(card, index);

  const renderColumn = (col: PhaseColumn, phaseIndex: number) => {
    const cards = columnCards[col.id] ?? [];
    const isEditing = col.phase !== null && editingPhaseId === col.phase.id;

    // 領域ごとにグループ表示（GAP単独表示では従来どおりフラット表示）。
    // Draggable の index は描画順で通し番号にする（dnd の要件）。
    let body: React.ReactNode;
    if (groupByArea && view !== 'GAP') {
      // flatSubProjects に現れる領域だけが見出しになる（循環で辿れない領域は
      // 「領域未設定」へフォールバックさせ、カードが消えないようにする）。
      const groupableIds = new Set(flatSubProjects.map(({ sub }) => sub.id));
      const groups: { key: string; label: string; cards: ColumnCard[] }[] = [];
      flatSubProjects.forEach(({ sub }) => {
        const inArea = cards.filter((c) => c.areaId === sub.id);
        if (inArea.length > 0) {
          groups.push({ key: sub.id, label: areaPath(sub.id) ?? sub.name, cards: inArea });
        }
      });
      const noArea = cards.filter((c) => !c.areaId || !groupableIds.has(c.areaId));
      if (noArea.length > 0) {
        groups.push({ key: '__noarea__', label: '領域未設定', cards: noArea });
      }
      let runningIndex = 0;
      body = groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <p className="flex items-center gap-1 border-b border-dashed border-gray-200 pb-0.5 text-[11px] font-semibold text-gray-500">
            <FolderTree className="h-3 w-3 shrink-0 text-gray-400" />
            <span className="truncate">{g.label}</span>
          </p>
          {g.cards.map((c) => renderCard(c, runningIndex++))}
        </div>
      ));
    } else {
      body = cards.map((c, i) => renderCard(c, i));
    }

    return (
      <div key={col.id} className="flex min-w-[280px] flex-1 flex-col">
        {/* 列ヘッダー */}
        <div
          className={`flex items-center justify-between gap-1 rounded-t-lg border px-3 py-2 ${col.style.head}`}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
            <span className={`h-2 w-2 shrink-0 rounded-full ${col.style.dot}`} />
            {isEditing && col.phase ? (
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => {
                  if (cancelEditRef.current) {
                    cancelEditRef.current = false;
                    setEditingPhaseId(null);
                    return;
                  }
                  void commitRename();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    cancelEditRef.current = true;
                    e.currentTarget.blur();
                  }
                }}
                className="w-full min-w-0 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-gray-900 outline-none focus:ring-1 focus:ring-blue-300"
              />
            ) : col.phase ? (
              <button
                type="button"
                onClick={() => startEditing(col.phase!)}
                title="クリックして改名"
                className="truncate text-left hover:underline"
              >
                {col.name}
              </button>
            ) : (
              <span className="truncate">{col.name}</span>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {col.phase && !isEditing && (
              <>
                <button
                  type="button"
                  onClick={() => startEditing(col.phase!)}
                  title="改名"
                  className="rounded p-1 opacity-60 hover:bg-white/70 hover:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleMovePhase(col.phase!.id, -1)}
                  disabled={phaseIndex <= 0}
                  title="左へ移動"
                  className="rounded p-1 opacity-60 hover:bg-white/70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleMovePhase(col.phase!.id, 1)}
                  disabled={phaseIndex >= sortedPhases.length - 1}
                  title="右へ移動"
                  className="rounded p-1 opacity-60 hover:bg-white/70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeletePhase(col.phase!)}
                  title="フェーズを削除（カードは未分類へ）"
                  className="rounded p-1 opacity-60 hover:bg-white/70 hover:text-rose-600 hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
            <span className="ml-1 text-xs font-medium opacity-80">{cards.length}件</span>
          </span>
        </div>
        {/* 列ボディ（ドロップ先） */}
        <Droppable droppableId={col.id}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`flex-1 space-y-3 rounded-b-lg border border-t-0 p-3 min-h-[120px] transition-colors ${
                snapshot.isDraggingOver
                  ? 'border-blue-300 bg-blue-50/60'
                  : 'border-gray-200 bg-gray-50/50'
              }`}
            >
              {cards.length === 0 && !snapshot.isDraggingOver && (
                <p className="py-6 text-center text-xs text-gray-400">
                  ここにカードをドラッグ
                </p>
              )}
              {body}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    );
  };

  // 空状態の判定（GAP単独表示は再設計前と同一の条件）
  const showEmptyState =
    view === 'GAP'
      ? gapItems.length === 0
      : view === 'TOBE'
        ? tobeRows.length === 0
        : gapItems.length === 0 && tobeRows.length === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <MapIcon className="h-6 w-6 text-blue-600" />
            ロードマップ
          </span>
        }
        description="TOBEの打ち手（とGAP）をフェーズ別に並べて推進計画を作る（カンバン）"
        help="TOBE設計の打ち手（段階設計）をフェーズに割り当てて段階的なロードマップ化します。表示切替で GAP（課題）起点のカンバンや、打ち手とGAPの混在表示にも切り替えられます。各カードを別のフェーズ列へドラッグすると、その打ち手/課題を各フェーズ（初期値: Quick Win / Phase2 / Phase3）に振り分けて推進計画にできます。フェーズ列は名前の変更・追加・並べ替え・削除ができます。"
        backHref={`/dashboard/projects/${projectId}`}
        actions={
          <>
            <HowToPanel
              open={howToOpen}
              onOpenChange={setHowToOpen}
              steps={[
                'このページは TOBE起点でロードマップを作ります。「表示」で TOBE打ち手 / GAP / 両方 を切り替えられます（選択は保存されます）。',
                'TOBE打ち手カードは TOBE設計（段階設計）の1行。あるべき姿 ⊃ 打ち手の階層、ROI・コスト・回収期間、領域パス、紐づくGAP件数を表示します。',
                '各カードを別の列へドラッグ＆ドロップすると、そのフェーズ（初期値: 3ヶ月以内(Quick Win)／1年以内(Phase2)／3年以内(Phase3)）に振り分けられます。',
                'フェーズ列は自由に編集できます。列名クリック（または鉛筆）で改名、「＋フェーズ追加」で列を増やし、←/→ で並べ替え、ゴミ箱で削除（カードは未分類へ）。',
                '領域フィルタで領域（親子）を絞り込み、「領域ごとにグループ表示」で列内を領域見出しで束ねられます。',
                'GAPカードでは期日/目標（target）とメモを入力できます。GAPカードは各列で 優先度（高→中→低）→ 並び順 でソートされます。',
                '変更は自動保存されます。手動で保存したいときは「保存」を押してください。',
              ]}
            />
            <ManualButton feature="roadmap" />
            <Button
              onClick={handleSaveAll}
              // GAP 0件での無効化は GAP 表示のみ（TOBE表示で常時無効に見えるのを避ける）
              disabled={saving || loading || (view === 'GAP' && gapItems.length === 0)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              保存
            </Button>
          </>
        }
      />

      {/* ツールバー: 表示切替 + 領域フィルタ + 領域グループ + 打ち手追加 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="text-sm text-gray-500">表示:</span>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => changeView(opt.value)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                  view === opt.value
                    ? opt.value === 'GAP'
                      ? 'bg-blue-600 text-white'
                      : opt.value === 'TOBE'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-700 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {view !== 'GAP' && (
          <>
            {/* 領域フィルタ（親子をインデント表示。親を選ぶと子孫も含む） */}
            <label className="inline-flex items-center gap-1.5 text-sm text-gray-500">
              <FolderTree className="h-4 w-4 text-gray-400" />
              <select
                value={areaFilter}
                onChange={(e) => setAreaFilter(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              >
                <option value={AREA_ALL}>領域: すべて</option>
                {flatSubProjects.map(({ sub, depth }) => (
                  <option key={sub.id} value={sub.id}>
                    {'　'.repeat(depth)}
                    {sub.name}
                  </option>
                ))}
              </select>
            </label>

            {/* 領域ごとにグループ表示 */}
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={groupByArea}
                onChange={(e) => setGroupByArea(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 accent-emerald-600"
              />
              領域ごとにグループ表示
            </label>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddOpen(true)}
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <Plus className="mr-1 h-4 w-4" />
              打ち手を追加
            </Button>
            <Link
              href={`/dashboard/projects/${projectId}/tobe`}
              className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
            >
              <Milestone className="h-4 w-4" />
              TOBE管理へ
            </Link>
          </>
        )}
      </div>

      {savedAt && !saving && (
        <div className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
          <Check className="h-3.5 w-3.5" />
          保存しました
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <Button variant="outline" onClick={fetchAll}>
              再読み込み
            </Button>
          </CardContent>
        </Card>
      ) : showEmptyState ? (
        view === 'GAP' ? (
          <Card className="bg-white border-gray-200">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <GitCompareArrows className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-gray-700 font-medium mb-2">GAP（課題）がありません</p>
              <p className="text-sm text-gray-500 mb-4">
                ロードマップは GAP（課題）をフェーズ別に並べて作ります。まずは GAP を洗い出しましょう。
              </p>
              <Link href={`/dashboard/projects/${projectId}/gap-items`}>
                <Button className="bg-blue-600 hover:bg-blue-700">
                  <GitCompareArrows className="h-4 w-4 mr-2" />
                  GAP（課題）を作成する
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-white border-gray-200">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                <Milestone className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-gray-700 font-medium mb-2">打ち手がまだありません</p>
              <p className="text-sm text-gray-500 mb-4">
                ロードマップは TOBE設計の打ち手（段階設計）をフェーズ別に並べて作ります。
                まずは打ち手を追加するか、TOBE管理で段階設計を作りましょう。
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={() => setIsAddOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  打ち手を追加
                </Button>
                <Link href={`/dashboard/projects/${projectId}/tobe`}>
                  <Button variant="outline">
                    <Milestone className="h-4 w-4 mr-2" />
                    TOBE管理へ
                  </Button>
                </Link>
                {view === 'BOTH' && (
                  <Link href={`/dashboard/projects/${projectId}/gap-items`}>
                    <Button variant="outline">
                      <GitCompareArrows className="h-4 w-4 mr-2" />
                      GAP（課題）を作成する
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="flex items-stretch gap-4 overflow-x-auto pb-2">
            {/* フェーズ列（order 昇順） */}
            {phaseColumns
              .filter((c) => c.phase !== null)
              .map((col, i) => renderColumn(col, i))}
            {/* ＋フェーズ追加（末尾・未分類の前） */}
            <button
              type="button"
              onClick={() => void handleAddPhase()}
              className="flex h-10 w-32 shrink-0 items-center justify-center gap-1 self-start rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 transition-colors hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-600"
            >
              <Plus className="h-4 w-4" />
              フェーズ追加
            </button>
            {/* 末尾固定: 未分類（編集・削除不可） */}
            {phaseColumns
              .filter((c) => c.phase === null)
              .map((col) => renderColumn(col, -1))}
          </div>
        </DragDropContext>
      )}

      {/* ＋打ち手を追加（未分類列に TobeRoadmap を作成。任意で TobeVision を紐づけ） */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="bg-white">
          <DialogHeader>
            <DialogTitle>打ち手を追加</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="add-vision">あるべき姿・打ち手（TOBE管理）から選ぶ（任意）</Label>
              <select
                id="add-vision"
                value={addVisionId}
                onChange={(e) => setAddVisionId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-400"
              >
                <option value="">（選択しない）</option>
                {tobeVisions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.countermeasure?.trim() || v.vision?.trim() || '（無題）'}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                打ち手が見つからない場合は{' '}
                <Link
                  href={`/dashboard/projects/${projectId}/tobe`}
                  className="font-medium text-emerald-700 hover:underline"
                >
                  TOBE管理
                </Link>{' '}
                で「あるべき姿・打ち手」を作成できます。
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-measure">打ち手（自由入力・補足）</Label>
              <Input
                id="add-measure"
                value={addMeasure}
                onChange={(e) => setAddMeasure(e.target.value)}
                placeholder="例: 受注入力のRPA化"
              />
            </div>
            <p className="text-xs text-gray-500">
              追加した打ち手は「{UNASSIGNED_LABEL}」列に入ります。ドラッグでフェーズへ振り分けてください。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={() => void handleAddTobe()}
              disabled={addSaving || (!addVisionId && !addMeasure.trim())}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {addSaving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
