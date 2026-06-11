'use client';

/**
 * リスクマネジメント ボード（PMBOK準拠）。
 *
 * - 上部: 確率×影響 5×5 ヒートマップ（脅威のみ集計・セルクリックで絞り込み）。
 * - 一覧: 種別(RBS)/領域/オーナー/脅威・好機/スコア(P×I)/戦略/ライフサイクル ＋
 *   従来列（区分・原因区分・対応策・期限など）をそのまま残した拡張テーブル。
 * - 行クリック → 全項目編集モーダル（RiskCategory/SubProject/Stakeholder/Meeting の
 *   各 select、確率・影響 1-5、脅威/好機トグルで戦略選択肢切替、対応タスク作成）。
 * - 下部: 種別管理（RBSカテゴリの追加・改名・削除。RoadmapPhase 編集UIの作法）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  Trash2,
  Plus,
  X,
  Save,
  Wand2,
  Tags,
  ClipboardList,
  ExternalLink,
  FilterX,
} from 'lucide-react';
import {
  LEVELS,
  RISK_TYPES,
  CAUSE_CATEGORIES,
  NEEDS_MTG_OPTIONS,
  STATUS_OPTIONS,
  pickLevel,
  countByPriority,
  suggestPriority,
  listRisks,
  createRisk,
  updateRisk,
  deleteRisk,
  riskCategoryApi,
  RISK_TYPE_OPTIONS,
  normalizeRiskType,
  riskTypeLabel,
  strategiesForRiskType,
  RISK_LIFECYCLES,
  riskLifecycleMeta,
  lifecycleMeta,
  pickScore,
  riskScore,
  scoreBand,
  scoreBandBadgeClasses,
  scoreBandCellClasses,
  heatmapCellKey,
  countHeatmapCells,
  type Risk,
  type RiskInput,
  type RiskCategory,
  type RiskType,
} from '@/lib/risks';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';
import {
  listStakeholders,
  listMeetings,
  type Stakeholder,
  type Meeting,
} from '@/lib/stakeholders';
import { tasksApi, taskStatusLabels, type Task } from '@/lib/tasks';

// Select は空文字を「すべて」に使うため、「未分類」はプレースホルダで表す。
const NONE = '__none__';

// 確率・影響 1-5 の選択肢ラベル。
const SCORE_OPTIONS = [
  { value: '1', label: '1（極低）' },
  { value: '2', label: '2（低）' },
  { value: '3', label: '3（中）' },
  { value: '4', label: '4（高）' },
  { value: '5', label: '5（極高）' },
];

// ---------------------------------------------------------------------------
// 編集ドラフト（全フィールドを文字列で保持し、保存時に正規化する）
// ---------------------------------------------------------------------------

interface Draft {
  // 従来項目
  type: string;
  event: string;
  causeCategory: string;
  probability: string;
  impact: string;
  priority: string;
  countermeasure: string;
  needsMtg: string;
  mtgDate: string;
  deadline: string;
  owner: string;
  status: string;
  note: string;
  // PMBOK 追加項目
  categoryId: string;
  subProjectId: string;
  ownerStakeholderId: string;
  reviewMeetingId: string;
  probabilityScore: string; // '' or '1'..'5'
  impactScore: string; // '' or '1'..'5'
  riskType: string; // 'THREAT' | 'OPPORTUNITY'
  strategy: string;
  responsePlan: string;
  contingencyPlan: string;
  trigger: string;
  lifecycle: string;
}

function riskToDraft(r: Risk | null): Draft {
  return {
    type: r?.type ?? '',
    event: r?.event ?? '',
    causeCategory: r?.causeCategory ?? '',
    probability: r?.probability ?? '',
    impact: r?.impact ?? '',
    priority: r?.priority ?? '',
    countermeasure: r?.countermeasure ?? '',
    needsMtg: r?.needsMtg ?? '',
    mtgDate: r?.mtgDate ?? '',
    deadline: r?.deadline ?? '',
    owner: r?.owner ?? '',
    status: r?.status ?? '',
    note: r?.note ?? '',
    categoryId: r?.categoryId ?? '',
    subProjectId: r?.subProjectId ?? '',
    ownerStakeholderId: r?.ownerStakeholderId ?? '',
    reviewMeetingId: r?.reviewMeetingId ?? '',
    probabilityScore:
      r?.probabilityScore != null ? String(r.probabilityScore) : '',
    impactScore: r?.impactScore != null ? String(r.impactScore) : '',
    riskType: normalizeRiskType(r?.riskType),
    strategy: r?.strategy ?? '',
    responsePlan: r?.responsePlan ?? '',
    contingencyPlan: r?.contingencyPlan ?? '',
    trigger: r?.trigger ?? '',
    lifecycle: r?.lifecycle ?? 'IDENTIFIED',
  };
}

function draftToInput(d: Draft): RiskInput {
  const t = (v: string) => {
    const s = v.trim();
    return s === '' ? null : s;
  };
  const score = (v: string) => {
    const s = v.trim();
    if (!s) return null;
    const n = Number.parseInt(s, 10);
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  };
  return {
    type: t(d.type),
    event: t(d.event),
    causeCategory: t(d.causeCategory),
    probability: t(d.probability),
    impact: t(d.impact),
    priority: t(d.priority),
    countermeasure: t(d.countermeasure),
    needsMtg: t(d.needsMtg),
    mtgDate: t(d.mtgDate),
    deadline: t(d.deadline),
    owner: t(d.owner),
    status: t(d.status),
    note: t(d.note),
    categoryId: t(d.categoryId),
    subProjectId: t(d.subProjectId),
    ownerStakeholderId: t(d.ownerStakeholderId),
    reviewMeetingId: t(d.reviewMeetingId),
    probabilityScore: score(d.probabilityScore),
    impactScore: score(d.impactScore),
    riskType: normalizeRiskType(d.riskType),
    strategy: t(d.strategy),
    responsePlan: t(d.responsePlan),
    contingencyPlan: t(d.contingencyPlan),
    trigger: t(d.trigger),
    lifecycle: t(d.lifecycle) ?? 'IDENTIFIED',
  };
}

// 従来項目（編集モーダルの折りたたみセクションに表示する）。
type FieldKind = 'text' | 'multiline' | 'type' | 'cause' | 'level' | 'mtg' | 'status';
const LEGACY_FIELDS: { key: keyof Draft; label: string; kind: FieldKind }[] = [
  { key: 'type', label: '区分（リスク/ボトルネック）', kind: 'type' },
  { key: 'causeCategory', label: '原因区分', kind: 'cause' },
  { key: 'probability', label: '発生確率（旧・高/中/低）', kind: 'level' },
  { key: 'impact', label: '影響度（旧・高/中/低）', kind: 'level' },
  { key: 'priority', label: '優先度', kind: 'level' },
  { key: 'countermeasure', label: '対応策（予防・軽減）', kind: 'multiline' },
  { key: 'needsMtg', label: '対応MTG', kind: 'mtg' },
  { key: 'mtgDate', label: 'MTG設定日', kind: 'text' },
  { key: 'deadline', label: '期限', kind: 'text' },
  { key: 'owner', label: '担当（自由記入）', kind: 'text' },
  { key: 'status', label: 'ステータス', kind: 'status' },
  { key: 'note', label: '備考', kind: 'multiline' },
];

// 一覧テーブルの列数（空状態行の colSpan 用）。
// # + PMBOK列（事象内容/種別/領域/オーナー/脅威・好機/スコア/戦略/ライフサイクル）
// + 従来列（LEGACY_FIELDS と同数）+ 操作列。PMBOK列を増減したらここも更新する。
const PMBOK_COLUMN_COUNT = 8;
const TABLE_COLUMN_COUNT = 1 + PMBOK_COLUMN_COUNT + LEGACY_FIELDS.length + 1;

/** 高/中/低 → セルの色（従来列）。 */
function levelClasses(level: string | null): string {
  switch (pickLevel(level)) {
    case '高':
      return 'border-red-200 bg-red-50 text-red-700';
    case '中':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    case '低':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    default:
      return 'border-gray-200 bg-gray-50 text-gray-500';
  }
}

/** 脅威/好機バッジの色。 */
function riskTypeBadgeClasses(raw: string | null | undefined): string {
  return normalizeRiskType(raw) === 'OPPORTUNITY'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : 'border-rose-200 bg-rose-50 text-rose-700';
}

/** 領域（SubProject）の入れ子 select 用の選択肢（親→子をインデント）。 */
function subProjectOptions(
  subs: SubProjectMaster[],
): { id: string; label: string }[] {
  const ids = new Set(subs.map((s) => s.id));
  const byParent = new Map<string | null, SubProjectMaster[]>();
  for (const s of subs) {
    const key = s.parentId && ids.has(s.parentId) ? s.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(s);
    byParent.set(key, arr);
  }
  const out: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    for (const c of children) {
      if (seen.has(c.id)) continue; // データ側の循環に備える
      seen.add(c.id);
      out.push({
        id: c.id,
        label: depth > 0 ? `${'　'.repeat(depth - 1)}　└ ${c.name}` : c.name,
      });
      visit(c.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** リスクの表示名（事象内容 → code → 無題 の順）。 */
function riskDisplayName(d: { event?: string | null; code?: string | null }): string {
  return (d.event ?? '').trim() || (d.code ?? '').trim() || 'リスク';
}

// ---------------------------------------------------------------------------
// ボード本体
// ---------------------------------------------------------------------------

export function RiskTableBoard({ projectId }: { projectId: string }) {
  const {
    risks,
    categories,
    subProjects,
    stakeholders,
    meetings,
    tasks,
    loading,
    error,
    reload,
    setRisks,
    setCategories,
    setTasks,
  } = useRiskBoardData(projectId);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // フィルタ（種別・領域・オーナー・ライフサイクル・脅威/好機）。
  const [filterRiskType, setFilterRiskType] = useState<'' | RiskType>('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterSubProject, setFilterSubProject] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterLifecycle, setFilterLifecycle] = useState('');
  // ヒートマップのセル絞り込み（確率 p × 影響 i）。
  const [cellFilter, setCellFilter] = useState<{ p: number; i: number } | null>(
    null,
  );

  // 編集モーダル（編集 or 新規追加）。editId=null かつ open=true で新規。
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(riskToDraft(null));

  // 対応タスク作成。
  const [creatingTask, setCreatingTask] = useState(false);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);

  // 種別管理。
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(risks.map((r) => [r.id, r])), [risks]);
  const counts = useMemo(() => countByPriority(risks), [risks]);
  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );
  const subProjectById = useMemo(
    () => new Map(subProjects.map((s) => [s.id, s])),
    [subProjects],
  );
  const stakeholderById = useMemo(
    () => new Map(stakeholders.map((s) => [s.id, s])),
    [stakeholders],
  );
  const subOptions = useMemo(() => subProjectOptions(subProjects), [subProjects]);

  // select フィルタ適用後の集合（ヒートマップはこの集合から集計する）。
  const filtered = useMemo(() => {
    return risks.filter((r) => {
      if (filterRiskType && normalizeRiskType(r.riskType) !== filterRiskType) {
        return false;
      }
      if (filterCategory) {
        if (filterCategory === NONE ? r.categoryId != null : r.categoryId !== filterCategory) {
          return false;
        }
      }
      if (filterSubProject) {
        if (filterSubProject === NONE ? r.subProjectId != null : r.subProjectId !== filterSubProject) {
          return false;
        }
      }
      if (filterOwner) {
        if (filterOwner === NONE ? r.ownerStakeholderId != null : r.ownerStakeholderId !== filterOwner) {
          return false;
        }
      }
      if (filterLifecycle && (r.lifecycle ?? 'IDENTIFIED') !== filterLifecycle) {
        return false;
      }
      return true;
    });
  }, [risks, filterRiskType, filterCategory, filterSubProject, filterOwner, filterLifecycle]);

  const heatCounts = useMemo(() => countHeatmapCells(filtered), [filtered]);

  // セル絞り込みも適用した、テーブルに出す集合。
  const visibleRisks = useMemo(() => {
    if (!cellFilter) return filtered;
    return filtered.filter(
      (r) =>
        normalizeRiskType(r.riskType) === 'THREAT' &&
        pickScore(r.probabilityScore) === cellFilter.p &&
        pickScore(r.impactScore) === cellFilter.i,
    );
  }, [filtered, cellFilter]);

  const hasFilter =
    !!filterRiskType ||
    !!filterCategory ||
    !!filterSubProject ||
    !!filterOwner ||
    !!filterLifecycle ||
    !!cellFilter;

  const clearFilters = () => {
    setFilterRiskType('');
    setFilterCategory('');
    setFilterSubProject('');
    setFilterOwner('');
    setFilterLifecycle('');
    setCellFilter(null);
  };

  // -------------------------------------------------------------------------
  // モーダル開閉・保存・削除
  // -------------------------------------------------------------------------

  const openEdit = (id: string) => {
    setEditId(id);
    setDraft(riskToDraft(byId.get(id) ?? null));
    setActionError(null);
    setCreatedTaskId(null);
    setModalOpen(true);
  };

  const openCreate = () => {
    setEditId(null);
    setDraft(riskToDraft(null));
    setActionError(null);
    setCreatedTaskId(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditId(null);
  };

  const setDraftField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  // 脅威/好機の切替。戦略が新しい選択肢に無ければクリアする（受容は両方にある）。
  const setRiskType = (value: RiskType) =>
    setDraft((prev) => {
      const next = { ...prev, riskType: value };
      if (prev.strategy && !strategiesForRiskType(value).includes(prev.strategy)) {
        next.strategy = '';
      }
      return next;
    });

  // 発生確率（旧・高/中/低）×影響度から優先度を自動入力する（従来機能）。
  const applySuggestedPriority = () => {
    const suggestion = suggestPriority(draft.probability, draft.impact);
    if (suggestion) setDraftField('priority', suggestion);
  };

  // 参照マスタ（種別・領域・オーナー・会議）が並行して削除されていた場合、
  // ドラフトに残った古いIDをそのまま送ると FK エラー（500）が
  // 「保存に失敗しました」に化ける。読み込み済みの選択肢に無い参照IDは
  // null（未設定）に落としてから送る。
  const sanitizeRefs = (input: RiskInput): RiskInput => ({
    ...input,
    categoryId:
      input.categoryId && categoryById.has(input.categoryId)
        ? input.categoryId
        : null,
    subProjectId:
      input.subProjectId && subProjectById.has(input.subProjectId)
        ? input.subProjectId
        : null,
    ownerStakeholderId:
      input.ownerStakeholderId && stakeholderById.has(input.ownerStakeholderId)
        ? input.ownerStakeholderId
        : null,
    reviewMeetingId:
      input.reviewMeetingId &&
      meetings.some((m) => m.id === input.reviewMeetingId)
        ? input.reviewMeetingId
        : null,
  });

  const handleSaveModal = async () => {
    const input = sanitizeRefs(draftToInput(draft));
    setSaving(true);
    setActionError(null);
    try {
      if (editId) {
        await updateRisk(editId, input);
      } else {
        await createRisk(projectId, { ...input, order: risks.length });
      }
      await reload();
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このリスクを削除しますか？')) return;
    setActionError(null);
    // 楽観削除（失敗時はreload）。
    setRisks((prev) => prev.filter((r) => r.id !== id));
    try {
      await deleteRisk(id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '削除に失敗しました');
      await reload();
    }
  };

  // -------------------------------------------------------------------------
  // 対応タスク作成・紐づくタスク一覧
  // -------------------------------------------------------------------------

  const linkedTasks = useMemo(
    () => (editId ? tasks.filter((t) => t.riskId === editId) : []),
    [tasks, editId],
  );

  const handleCreateTask = async () => {
    if (!editId) return;
    setCreatingTask(true);
    setActionError(null);
    try {
      // 未保存ドラフトからタスクを起票するとリスク本体と内容が乖離しうる
      // （モーダルをキャンセルするとタスクだけが残る）ため、先にリスクを
      // 保存し、保存済みの値からタスクのタイトル・説明を組み立てる。
      const saved = await updateRisk(editId, sanitizeRefs(draftToInput(draft)));
      setRisks((prev) => prev.map((r) => (r.id === editId ? saved : r)));
      setDraft(riskToDraft(saved));
      const name = riskDisplayName(saved);
      const created = await tasksApi.create(projectId, {
        title: `[リスク対応] ${truncate(name, 60)}`,
        riskId: editId,
        description: saved.responsePlan?.trim() || null,
      });
      setTasks((prev) => [...prev, created]);
      setCreatedTaskId(created.id);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : '対応タスクの作成に失敗しました',
      );
    } finally {
      setCreatingTask(false);
    }
  };

  // -------------------------------------------------------------------------
  // 種別管理（RBSカテゴリ）— RoadmapPhase 編集UIの作法（インライン改名・confirm削除）
  // -------------------------------------------------------------------------

  const handleAddCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    setCategoryBusy(true);
    setCategoryError(null);
    try {
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.order), -1);
      const created = await riskCategoryApi.create(projectId, {
        name,
        order: maxOrder + 1,
      });
      setCategories((prev) => [...prev, created]);
      setNewCategoryName('');
    } catch (e) {
      setCategoryError(
        e instanceof Error ? e.message : '種別の追加に失敗しました',
      );
    } finally {
      setCategoryBusy(false);
    }
  };

  const commitCategoryRename = async (cat: RiskCategory, raw: string) => {
    const name = raw.trim();
    if (!name || name === cat.name) return;
    setCategoryError(null);
    try {
      const updated = await riskCategoryApi.update(cat.id, { name });
      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? updated : c)),
      );
    } catch (e) {
      setCategoryError(
        e instanceof Error ? e.message : '種別の改名に失敗しました',
      );
    }
  };

  const handleDeleteCategory = async (cat: RiskCategory) => {
    if (
      !confirm(
        `種別「${cat.name}」を削除しますか？\nこの種別が付いたリスクは未分類に戻ります。`,
      )
    ) {
      return;
    }
    setCategoryError(null);
    try {
      await riskCategoryApi.delete(cat.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      if (filterCategory === cat.id) setFilterCategory('');
      await reload(); // 紐付いていたリスクの categoryId が null に戻るため再取得
    } catch (e) {
      setCategoryError(
        e instanceof Error ? e.message : '種別の削除に失敗しました',
      );
    }
  };

  // モーダル内の「種別を管理」リンク：モーダルを閉じて種別管理セクションへ。
  const jumpToCategoryManager = () => {
    closeModal();
    setTimeout(() => {
      document
        .getElementById('risk-category-manager')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  };

  // -------------------------------------------------------------------------
  // 描画
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const draftScore = riskScore(
    draft.probabilityScore ? Number.parseInt(draft.probabilityScore, 10) : null,
    draft.impactScore ? Number.parseInt(draft.impactScore, 10) : null,
  );
  const suggested = suggestPriority(draft.probability, draft.impact);
  const strategyOptions = (() => {
    const base = [...strategiesForRiskType(draft.riskType)];
    if (draft.strategy && !base.includes(draft.strategy)) {
      base.unshift(draft.strategy);
    }
    return base;
  })();

  return (
    <div className="space-y-4">
      {/* 優先度別件数サマリ（従来） */}
      <div className="flex flex-wrap items-center gap-2">
        <SummaryChip
          label="合計"
          value={counts.high + counts.mid + counts.low + counts.other}
          tone="neutral"
        />
        <SummaryChip label="優先度 高" value={counts.high} tone="high" />
        <SummaryChip label="優先度 中" value={counts.mid} tone="mid" />
        <SummaryChip label="優先度 低" value={counts.low} tone="low" />
        {counts.other > 0 && (
          <SummaryChip label="未設定" value={counts.other} tone="neutral" />
        )}
      </div>

      {/* 確率×影響 5×5 ヒートマップ */}
      <RiskHeatmap
        counts={heatCounts}
        selected={cellFilter}
        onSelect={(p, i) =>
          setCellFilter((prev) =>
            prev && prev.p === p && prev.i === i ? null : { p, i },
          )
        }
      />

      {/* フィルタ */}
      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect
          label="脅威/好機"
          value={filterRiskType}
          onChange={(v) => setFilterRiskType(v as '' | RiskType)}
          options={RISK_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        <FilterSelect
          label="種別"
          value={filterCategory}
          onChange={setFilterCategory}
          options={[
            { value: NONE, label: '（未分類）' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <FilterSelect
          label="領域"
          value={filterSubProject}
          onChange={setFilterSubProject}
          options={[
            { value: NONE, label: '（未設定）' },
            ...subOptions.map((o) => ({ value: o.id, label: o.label })),
          ]}
        />
        <FilterSelect
          label="オーナー"
          value={filterOwner}
          onChange={setFilterOwner}
          options={[
            { value: NONE, label: '（未設定）' },
            ...stakeholders.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <FilterSelect
          label="ライフサイクル"
          value={filterLifecycle}
          onChange={setFilterLifecycle}
          options={RISK_LIFECYCLES.map((lc) => ({
            value: lc,
            label: riskLifecycleMeta[lc].label,
          }))}
        />
        {cellFilter && (
          <button
            type="button"
            onClick={() => setCellFilter(null)}
            className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
            title="ヒートマップの絞り込みを解除"
          >
            確率{cellFilter.p}×影響{cellFilter.i} で絞り込み中
            <X className="h-3 w-3" />
          </button>
        )}
        {hasFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
          >
            <FilterX className="h-3.5 w-3.5" />
            すべて解除
          </button>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            行を追加
          </button>
        </div>
      </div>

      {(error || actionError) && !modalOpen && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error || actionError}
        </div>
      )}

      {/* 一覧テーブル */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                    #
                  </th>
                  <Th className="min-w-[220px]">事象内容</Th>
                  <Th>種別</Th>
                  <Th>領域</Th>
                  <Th>オーナー</Th>
                  <Th>脅威/好機</Th>
                  <Th>スコア(P×I)</Th>
                  <Th>戦略</Th>
                  <Th>ライフサイクル</Th>
                  <Th>区分</Th>
                  <Th>原因区分</Th>
                  <Th>発生確率(旧)</Th>
                  <Th>影響度(旧)</Th>
                  <Th>優先度</Th>
                  <Th className="min-w-[150px]">対応策</Th>
                  <Th>対応MTG</Th>
                  <Th>MTG設定日</Th>
                  <Th>期限</Th>
                  <Th>担当</Th>
                  <Th>ステータス</Th>
                  <Th className="min-w-[120px]">備考</Th>
                  <th className="w-12 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {visibleRisks.map((r, idx) => {
                  const cat = r.categoryId ? categoryById.get(r.categoryId) : undefined;
                  const sub = r.subProjectId ? subProjectById.get(r.subProjectId) : undefined;
                  const ownerSh = r.ownerStakeholderId
                    ? stakeholderById.get(r.ownerStakeholderId)
                    : undefined;
                  const score = riskScore(r.probabilityScore, r.impactScore);
                  const lc = lifecycleMeta(r.lifecycle ?? 'IDENTIFIED');
                  return (
                    <tr
                      key={r.id}
                      onClick={() => openEdit(r.id)}
                      className="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
                      title="クリックして編集"
                    >
                      <td className="px-2 py-2 align-middle text-xs text-gray-400">
                        {idx + 1}
                      </td>
                      {/* 事象内容 */}
                      <td className="max-w-[280px] px-3 py-2 align-middle text-gray-900">
                        {r.event ? (
                          <span className="line-clamp-2 whitespace-pre-wrap break-words font-medium">
                            {r.event}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      {/* 種別（RBSカテゴリ） */}
                      <td className="px-3 py-2 align-middle">
                        {cat ? (
                          <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
                            {cat.name}
                          </span>
                        ) : (
                          <Dash />
                        )}
                      </td>
                      {/* 領域 */}
                      <td className="px-3 py-2 align-middle text-gray-700">
                        {sub?.name ?? <Dash />}
                      </td>
                      {/* オーナー */}
                      <td className="px-3 py-2 align-middle text-gray-700">
                        {ownerSh?.name ?? <Dash />}
                      </td>
                      {/* 脅威/好機 */}
                      <td className="px-3 py-2 align-middle">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${riskTypeBadgeClasses(r.riskType)}`}
                        >
                          {riskTypeLabel(r.riskType)}
                        </span>
                      </td>
                      {/* スコア（P×I 自動計算バッジ） */}
                      <td className="px-3 py-2 align-middle">
                        {score != null ? (
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${scoreBandBadgeClasses[scoreBand(score)]}`}
                            title={`確率${pickScore(r.probabilityScore)} × 影響${pickScore(r.impactScore)}`}
                          >
                            {pickScore(r.probabilityScore)}×{pickScore(r.impactScore)}={score}
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-400">
                            未評価
                          </span>
                        )}
                      </td>
                      {/* 戦略 */}
                      <td className="px-3 py-2 align-middle text-gray-700">
                        {r.strategy ?? <Dash />}
                      </td>
                      {/* ライフサイクル */}
                      <td className="px-3 py-2 align-middle">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${lc.chip}`}
                        >
                          {lc.label}
                        </span>
                      </td>
                      {/* 従来列 */}
                      <LegacyCell value={r.type} />
                      <LegacyCell value={r.causeCategory} />
                      <LevelCell value={r.probability} />
                      <LevelCell value={r.impact} />
                      <LevelCell value={r.priority} />
                      <LegacyCell value={r.countermeasure} clamp />
                      <LegacyCell value={r.needsMtg} />
                      <LegacyCell value={r.mtgDate} />
                      <LegacyCell value={r.deadline} />
                      <LegacyCell value={r.owner} />
                      <LegacyCell value={r.status} />
                      <LegacyCell value={r.note} clamp />
                      <td
                        className="px-2 py-2 text-center align-middle"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => handleDelete(r.id)}
                          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          title="このリスクを削除"
                          aria-label="このリスクを削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {visibleRisks.length === 0 && (
                  <tr>
                    <td
                      colSpan={TABLE_COLUMN_COUNT}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      {risks.length === 0
                        ? 'まだリスクがありません。「行を追加」から登録を始めましょう。'
                        : '条件に一致するリスクがありません。フィルタを解除してください。'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 種別管理（RBSカテゴリ） */}
      <Card id="risk-category-manager" className="bg-white border-gray-200">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <Tags className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-[#050f3e]">
              種別管理（RBSカテゴリ）
            </h3>
          </div>
          <p className="text-xs text-gray-500">
            リスクの種別（リスク・ブレークダウン・ストラクチャーのカテゴリ）を追加・改名・削除します。
            削除すると、その種別が付いたリスクは未分類に戻ります。
          </p>
          {categoryError && (
            <p className="text-xs text-rose-600">{categoryError}</p>
          )}
          <div className="space-y-1.5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <input
                  type="text"
                  defaultValue={c.name}
                  onBlur={(e) => commitCategoryRename(c, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  className="w-full max-w-xs rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  title="名前を変更して Enter / フォーカスアウトで保存"
                />
                <button
                  type="button"
                  onClick={() => handleDeleteCategory(c)}
                  className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                  title="この種別を削除"
                  aria-label="この種別を削除"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {categories.length === 0 && (
              <p className="text-xs text-gray-400">まだ種別がありません。</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddCategory();
              }}
              placeholder="新しい種別名（例：技術 / 外部 / 組織）"
              className="w-full max-w-xs rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleAddCategory}
              disabled={categoryBusy || !newCategoryName.trim()}
              className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
            >
              {categoryBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              追加
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 編集／追加モーダル（全項目） */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeModal}
        >
          <div
            className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-[#050f3e]">
                {editId ? 'リスクを編集' : 'リスクを追加'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded p-1 text-gray-500 hover:bg-gray-100"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[68vh] space-y-3 overflow-auto px-5 py-4">
              {/* 事象内容 */}
              <Field label="事象内容">
                <textarea
                  value={draft.event}
                  onChange={(e) => setDraftField('event', e.target.value)}
                  rows={2}
                  placeholder="どんなリスク（脅威/好機）か"
                  className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* 種別（RiskCategory） */}
                <Field
                  label="種別（RBSカテゴリ）"
                  action={
                    <button
                      type="button"
                      onClick={jumpToCategoryManager}
                      className="flex items-center gap-0.5 text-[10px] font-medium text-blue-600 hover:underline"
                      title="種別の追加・改名・削除"
                    >
                      <Tags className="h-3 w-3" />
                      種別を管理
                    </button>
                  }
                >
                  <ModalSelect
                    value={draft.categoryId}
                    onChange={(v) => setDraftField('categoryId', v)}
                    placeholder="（未分類）"
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  />
                </Field>
                {/* 領域（SubProject 入れ子） */}
                <Field label="領域（サブプロジェクト）">
                  <ModalSelect
                    value={draft.subProjectId}
                    onChange={(v) => setDraftField('subProjectId', v)}
                    placeholder="（未設定）"
                    options={subOptions.map((o) => ({ value: o.id, label: o.label }))}
                  />
                </Field>
                {/* オーナー（Stakeholder） */}
                <Field label="リスクオーナー">
                  <ModalSelect
                    value={draft.ownerStakeholderId}
                    onChange={(v) => setDraftField('ownerStakeholderId', v)}
                    placeholder={
                      stakeholders.length > 0
                        ? '（未設定）'
                        : '（ステークホルダー未登録）'
                    }
                    options={stakeholders.map((s) => ({
                      value: s.id,
                      label: s.affiliation ? `${s.name}（${s.affiliation}）` : s.name,
                    }))}
                  />
                </Field>
                {/* レビュー会議（Meeting） */}
                <Field label="レビュー会議">
                  <ModalSelect
                    value={draft.reviewMeetingId}
                    onChange={(v) => setDraftField('reviewMeetingId', v)}
                    placeholder={
                      meetings.length > 0 ? '（未設定）' : '（会議体未登録）'
                    }
                    options={meetings.map((m) => ({
                      value: m.id,
                      label: m.name || '（無題）',
                    }))}
                  />
                </Field>
              </div>

              {/* 評価（PMBOK）：脅威/好機・確率×影響・戦略・ライフサイクル */}
              <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                <p className="text-[11px] font-semibold text-gray-500">
                  評価・対応戦略（PMBOK）
                </p>
                <Field label="リスク種別">
                  <div className="flex gap-2">
                    {RISK_TYPE_OPTIONS.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setRiskType(o.value)}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          normalizeRiskType(draft.riskType) === o.value
                            ? o.value === 'THREAT'
                              ? 'border-rose-400 bg-rose-50 text-rose-700'
                              : 'border-emerald-400 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="発生確率（1-5）">
                    <ModalSelect
                      value={draft.probabilityScore}
                      onChange={(v) => setDraftField('probabilityScore', v)}
                      placeholder="（未評価）"
                      options={SCORE_OPTIONS}
                    />
                  </Field>
                  <Field label="影響度（1-5）">
                    <ModalSelect
                      value={draft.impactScore}
                      onChange={(v) => setDraftField('impactScore', v)}
                      placeholder="（未評価）"
                      options={SCORE_OPTIONS}
                    />
                  </Field>
                  <Field label="スコア（P×I 自動計算）">
                    {draftScore != null ? (
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums ${scoreBandBadgeClasses[scoreBand(draftScore)]}`}
                      >
                        {draft.probabilityScore}×{draft.impactScore}={draftScore}
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-400">
                        未評価
                      </span>
                    )}
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={`対応戦略（${riskTypeLabel(draft.riskType)}）`}
                  >
                    <ModalSelect
                      value={draft.strategy}
                      onChange={(v) => setDraftField('strategy', v)}
                      placeholder="（未設定）"
                      options={strategyOptions.map((s) => ({ value: s, label: s }))}
                    />
                  </Field>
                  <Field label="ライフサイクル">
                    <ModalSelect
                      value={draft.lifecycle}
                      onChange={(v) => setDraftField('lifecycle', v)}
                      placeholder="（未設定）"
                      options={RISK_LIFECYCLES.map((lc) => ({
                        value: lc,
                        label: riskLifecycleMeta[lc].label,
                      }))}
                    />
                  </Field>
                </div>
                <Field label="対応計画">
                  <textarea
                    value={draft.responsePlan}
                    onChange={(e) => setDraftField('responsePlan', e.target.value)}
                    rows={2}
                    placeholder="戦略を具体化した対応計画"
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="コンティンジェンシー計画">
                    <textarea
                      value={draft.contingencyPlan}
                      onChange={(e) =>
                        setDraftField('contingencyPlan', e.target.value)
                      }
                      rows={2}
                      placeholder="顕在化したときの代替計画"
                      className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                  <Field label="トリガー条件">
                    <textarea
                      value={draft.trigger}
                      onChange={(e) => setDraftField('trigger', e.target.value)}
                      rows={2}
                      placeholder="発動を判断する兆候・条件"
                      className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                </div>
              </div>

              {/* 対応タスク */}
              <div className="space-y-2 rounded-lg border border-gray-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                    <ClipboardList className="h-3.5 w-3.5 text-blue-600" />
                    対応タスク
                  </p>
                  {editId && (
                    <button
                      type="button"
                      onClick={handleCreateTask}
                      disabled={creatingTask}
                      className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      {creatingTask ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      対応タスク作成
                    </button>
                  )}
                </div>
                {!editId ? (
                  <p className="text-xs text-gray-400">
                    保存するとリスク対応タスクを作成できます。
                  </p>
                ) : linkedTasks.length === 0 ? (
                  <p className="text-xs text-gray-400">
                    紐づくタスクはまだありません。「対応タスク作成」で
                    [リスク対応] タスクを起票できます。
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {linkedTasks.map((t) => {
                      const st = taskStatusLabels[t.status] ?? taskStatusLabels.OPEN;
                      return (
                        <li key={t.id} className="flex items-center gap-2 text-xs">
                          <span
                            className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${st.color}`}
                          >
                            {st.label}
                          </span>
                          <Link
                            href={`/dashboard/projects/${projectId}/tasks/${t.id}`}
                            className="inline-flex min-w-0 items-center gap-1 text-blue-600 hover:underline"
                          >
                            <span className="truncate">{t.title}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </Link>
                          {createdTaskId === t.id && (
                            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                              作成しました
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* 従来項目（折りたたみ） */}
              <details className="rounded-lg border border-gray-200 p-3">
                <summary className="cursor-pointer text-[11px] font-semibold text-gray-500">
                  従来項目（区分・原因区分・対応策・期限・担当など）
                </summary>
                <div className="mt-3 space-y-3">
                  {LEGACY_FIELDS.map((f) => {
                    const value = draft[f.key];
                    const options =
                      f.kind === 'type'
                        ? RISK_TYPES
                        : f.kind === 'cause'
                          ? CAUSE_CATEGORIES
                          : f.kind === 'level'
                            ? LEVELS
                            : f.kind === 'mtg'
                              ? NEEDS_MTG_OPTIONS
                              : f.kind === 'status'
                                ? STATUS_OPTIONS
                                : null;

                    return (
                      <Field
                        key={f.key}
                        label={f.label}
                        action={
                          f.key === 'priority' && suggested ? (
                            <button
                              type="button"
                              onClick={applySuggestedPriority}
                              className="flex items-center gap-1 rounded text-[10px] font-medium text-blue-600 hover:underline"
                              title="発生確率×影響度から優先度を提案"
                            >
                              <Wand2 className="h-3 w-3" />
                              提案: {suggested}
                            </button>
                          ) : undefined
                        }
                      >
                        {options ? (
                          <select
                            value={value}
                            onChange={(e) => setDraftField(f.key, e.target.value)}
                            className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">（未設定）</option>
                            {options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        ) : f.kind === 'multiline' ? (
                          <textarea
                            value={value}
                            onChange={(e) => setDraftField(f.key, e.target.value)}
                            rows={2}
                            placeholder={f.label}
                            className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        ) : (
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => setDraftField(f.key, e.target.value)}
                            placeholder={f.label}
                            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}
                      </Field>
                    );
                  })}
                </div>
              </details>

              {actionError && (
                <p className="text-xs text-rose-600">{actionError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handleSaveModal}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-[#050f3e] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 確率×影響 5×5 ヒートマップ
// ---------------------------------------------------------------------------

function RiskHeatmap({
  counts,
  selected,
  onSelect,
}: {
  counts: Map<string, number>;
  selected: { p: number; i: number } | null;
  onSelect: (p: number, i: number) => void;
}) {
  const impacts = [5, 4, 3, 2, 1];
  const probabilities = [1, 2, 3, 4, 5];
  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-gray-600">
            確率×影響マトリクス（脅威のみ・未評価は対象外）
          </p>
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            <LegendChip className="bg-emerald-50 border-emerald-200" label="低 (1-4)" />
            <LegendChip className="bg-amber-50 border-amber-200" label="中 (5-12)" />
            <LegendChip className="bg-red-50 border-red-200" label="高 (15-25)" />
            <span className="text-gray-400">セルクリックで絞り込み</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[420px] gap-1"
            style={{ gridTemplateColumns: 'auto repeat(5, minmax(56px, 1fr))' }}
          >
            {/* 左上コーナー */}
            <div className="flex items-end justify-end pb-1 pr-1 text-[10px] leading-tight text-gray-400">
              影響＼確率
            </div>
            {probabilities.map((p) => (
              <div
                key={`head-${p}`}
                className="pb-1 text-center text-[11px] font-medium text-gray-500"
              >
                {p}
              </div>
            ))}
            {impacts.map((i) => (
              <HeatmapRow
                key={`row-${i}`}
                impact={i}
                probabilities={probabilities}
                counts={counts}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HeatmapRow({
  impact,
  probabilities,
  counts,
  selected,
  onSelect,
}: {
  impact: number;
  probabilities: number[];
  counts: Map<string, number>;
  selected: { p: number; i: number } | null;
  onSelect: (p: number, i: number) => void;
}) {
  return (
    <>
      <div className="flex items-center justify-end pr-1.5 text-[11px] font-medium text-gray-500">
        {impact}
      </div>
      {probabilities.map((p) => {
        const count = counts.get(heatmapCellKey(p, impact)) ?? 0;
        const band = scoreBand(p * impact);
        const isSelected = selected?.p === p && selected?.i === impact;
        return (
          <button
            key={`cell-${p}-${impact}`}
            type="button"
            onClick={() => onSelect(p, impact)}
            className={`flex h-10 items-center justify-center rounded border text-sm font-bold tabular-nums transition-colors ${scoreBandCellClasses[band]} ${
              isSelected
                ? 'border-blue-500 ring-2 ring-blue-400'
                : 'border-transparent'
            }`}
            title={`確率${p} × 影響${impact}（スコア ${p * impact}）: ${count} 件`}
          >
            {count > 0 ? count : <span className="opacity-30">·</span>}
          </button>
        );
      })}
    </>
  );
}

function LegendChip({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-3 w-3 rounded border ${className}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 小物コンポーネント
// ---------------------------------------------------------------------------

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`min-w-[100px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-600 ${className}`}
    >
      {children}
    </th>
  );
}

function Dash() {
  return <span className="text-gray-300">—</span>;
}

function LegacyCell({
  value,
  clamp = false,
}: {
  value: string | null;
  clamp?: boolean;
}) {
  return (
    <td className="max-w-[220px] px-3 py-2 align-middle text-gray-700">
      {value ? (
        clamp ? (
          <span className="line-clamp-2 whitespace-pre-wrap break-words">
            {value}
          </span>
        ) : (
          <span className="whitespace-nowrap">{value}</span>
        )
      ) : (
        <Dash />
      )}
    </td>
  );
}

function LevelCell({ value }: { value: string | null }) {
  return (
    <td className="px-3 py-2 align-middle">
      {value ? (
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${levelClasses(value)}`}
        >
          {value}
        </span>
      ) : (
        <Dash />
      )}
    </td>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-gray-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border px-2 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary ${
          value
            ? 'border-blue-300 bg-blue-50 text-blue-800'
            : 'border-gray-300 bg-white text-gray-700'
        }`}
      >
        <option value="">すべて</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** モーダルのラベル付きフィールド（右端に補助アクションを置ける）。 */
function Field({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between text-[11px] font-medium text-gray-500">
        <span>{label}</span>
        {action}
      </label>
      {children}
    </div>
  );
}

function ModalSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function SummaryChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'high' | 'mid' | 'low' | 'neutral';
}) {
  const toneClass =
    tone === 'high'
      ? 'border-red-200 bg-red-50 text-red-700'
      : tone === 'mid'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : tone === 'low'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-gray-200 bg-gray-50 text-gray-600';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${toneClass}`}
    >
      {label}
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// データ読み込みフック（リスク＋参照マスタ＋タスク）
// ---------------------------------------------------------------------------

function useRiskBoardData(projectId: string) {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [rs, cats, subs, shs, mts, taskRes] = await Promise.all([
        listRisks(projectId),
        riskCategoryApi.list(projectId),
        subProjectApi.list(projectId),
        listStakeholders(projectId),
        listMeetings(projectId),
        tasksApi.list(projectId),
      ]);
      setRisks(rs);
      setCategories(cats);
      setSubProjects(subs);
      setStakeholders(shs);
      setMeetings(mts);
      setTasks(taskRes.tasks ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    }
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return {
    risks,
    categories,
    subProjects,
    stakeholders,
    meetings,
    tasks,
    loading,
    error,
    reload,
    setRisks,
    setCategories,
    setTasks,
  };
}
