'use client';

/**
 * 会議体マスタ（Meeting）管理ページ。
 *
 * 会議体のマスタ。ステークホルダーマップ・報告カレンダーと連動する。
 * - 一覧テーブル：会議名・目的/ゴール・頻度・曜日時間・所要時間・形式・主催・
 *   ステータス（開催中/休止 トグル）・対象ステークホルダー（チップ）・対象領域（チップ）。
 * - 行クリック → 全項目の編集モーダル。新規作成・削除（confirm）。
 * - 主催・対象は Stakeholder マスタ（GET /api/projects/:projectId/stakeholders）から選択。
 * - 対象領域は SubProject マスタ（領域→サブ領域の入れ子チェックボックス）から複数選択。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  Plus,
  Trash2,
  X,
  Save,
  Users,
  Crown,
  CalendarClock,
  Pause,
  Play,
  ExternalLink,
  ShieldAlert,
  FolderTree,
  CornerDownRight,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Card, CardContent } from '@/components/ui/card';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';
import {
  type Meeting,
  type MeetingInput,
  type Stakeholder,
  listMeetings,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  setMeetingStakeholders,
  setMeetingSubProjects,
  listStakeholders,
  orderDomainTree,
} from '@/lib/stakeholders';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';
import {
  listRisks,
  riskScore,
  scoreBand,
  scoreBandBadgeClasses,
  lifecycleMeta,
  type Risk,
} from '@/lib/risks';

// 形式の選択肢（schema 上は自由文字列だが UI では3択 + 未設定）。
const FORMAT_OPTIONS = ['対面', 'オンライン', 'ハイブリッド'] as const;

/** ステータス表示（ACTIVE=開催中 / SUSPENDED=休止。null は開催中扱い）。 */
function isActive(status: string | null): boolean {
  return status !== 'SUSPENDED';
}

/** リスクの表示名（事象内容 → code → 無題 の順）。 */
function riskName(r: Risk): string {
  return (r.event ?? '').trim() || (r.code ?? '').trim() || '（無題のリスク）';
}

function truncateText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 形式→バッジ色。 */
function formatBadgeClasses(format: string | null): string {
  switch (format) {
    case '対面':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'オンライン':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'ハイブリッド':
      return 'bg-violet-50 text-violet-700 border-violet-200';
    default:
      return 'bg-gray-50 text-gray-500 border-gray-200';
  }
}

// ---------------------------------------------------------------------------
// 編集モーダル用ドラフト
// ---------------------------------------------------------------------------

interface Draft {
  name: string;
  purpose: string;
  goal: string;
  frequency: string;
  dayTime: string;
  durationMinutes: string; // 入力中は文字列で保持
  format: string;
  locationUrl: string;
  ownerStakeholderId: string;
  minutesOwner: string;
  decisionMaker: string;
  status: string; // 'ACTIVE' | 'SUSPENDED'
  agendaTemplate: string;
  preMaterials: string;
  note: string;
  stakeholderIds: string[];
  subProjectIds: string[];
}

function meetingToDraft(m: Meeting | null): Draft {
  return {
    name: m?.name ?? '',
    purpose: m?.purpose ?? '',
    goal: m?.goal ?? '',
    frequency: m?.frequency ?? '',
    dayTime: m?.dayTime ?? '',
    durationMinutes:
      m?.durationMinutes != null ? String(m.durationMinutes) : '',
    format: m?.format ?? '',
    locationUrl: m?.locationUrl ?? '',
    ownerStakeholderId: m?.ownerStakeholderId ?? '',
    minutesOwner: m?.minutesOwner ?? '',
    decisionMaker: m?.decisionMaker ?? '',
    status: m && !isActive(m.status) ? 'SUSPENDED' : 'ACTIVE',
    agendaTemplate: m?.agendaTemplate ?? '',
    preMaterials: m?.preMaterials ?? '',
    note: m?.note ?? '',
    stakeholderIds: m?.stakeholderIds ? [...m.stakeholderIds] : [],
    subProjectIds: m?.subProjectIds ? [...m.subProjectIds] : [],
  };
}

function draftToInput(d: Draft): MeetingInput {
  const t = (v: string) => {
    const s = v.trim();
    return s === '' ? null : s;
  };
  const minutes = d.durationMinutes.trim();
  const parsed = minutes === '' ? null : Number.parseInt(minutes, 10);
  return {
    name: d.name.trim(),
    purpose: t(d.purpose),
    goal: t(d.goal),
    frequency: t(d.frequency),
    dayTime: t(d.dayTime),
    durationMinutes:
      parsed != null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null,
    format: t(d.format),
    locationUrl: t(d.locationUrl),
    ownerStakeholderId: t(d.ownerStakeholderId),
    minutesOwner: t(d.minutesOwner),
    decisionMaker: t(d.decisionMaker),
    status: d.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
    agendaTemplate: t(d.agendaTemplate),
    preMaterials: t(d.preMaterials),
    note: t(d.note),
  };
}

// ---------------------------------------------------------------------------
// ページ本体
// ---------------------------------------------------------------------------

export default function MeetingsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [subProjects, setSubProjects] = useState<SubProjectMaster[]>([]);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編集モーダル（editId=null かつ open=true で新規）。
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(meetingToDraft(null));
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [mt, sh, rs, sp] = await Promise.all([
        listMeetings(projectId),
        listStakeholders(projectId),
        listRisks(projectId),
        // 領域は補助情報なので、取得失敗しても会議一覧は壊さない
        subProjectApi.list(projectId).catch(() => [] as SubProjectMaster[]),
      ]);
      setMeetings(mt);
      setStakeholders(sh);
      setRisks(rs);
      setSubProjects(sp);
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

  const stakeholderById = useMemo(
    () => new Map(stakeholders.map((s) => [s.id, s])),
    [stakeholders],
  );

  const subProjectById = useMemo(
    () => new Map(subProjects.map((s) => [s.id, s])),
    [subProjects],
  );

  // 領域→サブ領域の入れ子順（親→子、循環は orderDomainTree がガード）。
  const subProjectTree = useMemo(
    () => orderDomainTree(subProjects),
    [subProjects],
  );

  /** 領域チップの title 用：「親領域 > サブ領域」のパス表記。 */
  const subProjectPath = useCallback(
    (sp: SubProjectMaster): string => {
      const parent = sp.parentId ? subProjectById.get(sp.parentId) : undefined;
      return parent ? `${parent.name} > ${sp.name}` : sp.name;
    },
    [subProjectById],
  );

  // 会議 → レビュー対象リスク（Risk.reviewMeetingId による逆引き）。
  const risksByMeeting = useMemo(() => {
    const m = new Map<string, Risk[]>();
    for (const r of risks) {
      if (!r.reviewMeetingId) continue;
      const arr = m.get(r.reviewMeetingId) ?? [];
      arr.push(r);
      m.set(r.reviewMeetingId, arr);
    }
    return m;
  }, [risks]);

  // ヘッダークリックソート用 accessor（表示用の派生値で比較）。
  // 対象ステークホルダー・対象領域・レビュー対象リスクはチップの複数値列のため非ソート。
  // ソート解除時（sortKey=null）は従来の並び（meetings の取得順）に戻る。
  const sortAccessors = useMemo(
    () => ({
      name: (m: Meeting) => m.name,
      purposeGoal: (m: Meeting) => m.purpose || m.goal,
      frequency: (m: Meeting) => m.frequency,
      dayTime: (m: Meeting) => m.dayTime,
      duration: (m: Meeting) => m.durationMinutes,
      format: (m: Meeting) => m.format,
      owner: (m: Meeting) =>
        m.ownerStakeholderId
          ? (stakeholderById.get(m.ownerStakeholderId)?.name ?? '')
          : '',
      status: (m: Meeting) => (isActive(m.status) ? '開催中' : '休止'),
    }),
    [stakeholderById],
  );

  const {
    sorted: sortedMeetings,
    sortKey,
    sortDir,
    toggleSort,
  } = useTableSort(meetings, sortAccessors);

  const openCreate = () => {
    setEditId(null);
    setDraft(meetingToDraft(null));
    setModalError(null);
    setModalOpen(true);
  };

  const openEdit = (m: Meeting) => {
    setEditId(m.id);
    setDraft(meetingToDraft(m));
    setModalError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditId(null);
  };

  const handleSave = async () => {
    const input = draftToInput(draft);
    if (!input.name) {
      setModalError('会議名は必須です');
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      if (editId) {
        await updateMeeting(editId, input);
        await setMeetingStakeholders(editId, draft.stakeholderIds);
        await setMeetingSubProjects(editId, draft.subProjectIds);
      } else {
        const created = await createMeeting(projectId, input);
        // 作成直後に編集モードへ切り替える。これで後続の
        // setMeetingStakeholders / setMeetingSubProjects が失敗しても、
        // 再度「保存」を押したときに同じ会議体の更新になり、重複作成を防げる。
        setEditId(created.id);
        if (draft.stakeholderIds.length > 0) {
          await setMeetingStakeholders(created.id, draft.stakeholderIds);
        }
        if (draft.subProjectIds.length > 0) {
          await setMeetingSubProjects(created.id, draft.subProjectIds);
        }
      }
      await reload();
      closeModal();
    } catch (e) {
      setModalError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (m: Meeting) => {
    if (!confirm(`会議体「${m.name || '（無題）'}」を削除しますか？`)) return;
    setError(null);
    try {
      await deleteMeeting(m.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  // ステータス（開催中/休止）トグル：行内で即時 PATCH（楽観更新）。
  const toggleStatus = async (m: Meeting) => {
    const next = isActive(m.status) ? 'SUSPENDED' : 'ACTIVE';
    setMeetings((prev) =>
      prev.map((x) => (x.id === m.id ? { ...x, status: next } : x)),
    );
    try {
      await updateMeeting(m.id, { status: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ステータスの更新に失敗しました');
      await reload();
    }
  };

  const setDraftField = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const toggleDraftStakeholder = (id: string) =>
    setDraft((prev) => ({
      ...prev,
      stakeholderIds: prev.stakeholderIds.includes(id)
        ? prev.stakeholderIds.filter((x) => x !== id)
        : [...prev.stakeholderIds, id],
    }));

  const toggleDraftSubProject = (id: string) =>
    setDraft((prev) => ({
      ...prev,
      subProjectIds: prev.subProjectIds.includes(id)
        ? prev.subProjectIds.filter((x) => x !== id)
        : [...prev.subProjectIds, id],
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="会議マスタ"
        description="会議体のマスタ。ステークホルダーマップ・報告カレンダーと連動します。"
        help="プロジェクトの会議体（定例・ステアリング等）をマスタとして管理します。主催・対象ステークホルダーはステークホルダーマスタから選択でき、ステークホルダーマネジメントの会議・報告タブや報告カレンダーと同じデータを参照します。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <HowToPanel
            steps={[
              '「会議体を追加」から新しい会議体を作成します。',
              '行をクリックすると全項目（目的・頻度・形式・主催・対象ステークホルダー等）を編集できます。',
              'ステータス列のトグルで開催中／休止を切り替えられます。',
              '主催・対象ステークホルダーはステークホルダーマスタから選択します（ステークホルダーマネジメントと連動）。',
              'ゴミ箱アイコンで削除できます。',
            ]}
          />
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/dashboard/projects/${projectId}/stakeholder-management`}
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 hover:underline"
        >
          <Users className="h-4 w-4" />
          ステークホルダーマネジメントを開く
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          会議体を追加
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                      #
                    </th>
                    <SortableTh
                      label="会議名"
                      sortKey="name"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[150px] text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="目的・ゴール"
                      sortKey="purposeGoal"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[180px] text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="頻度"
                      sortKey="frequency"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[90px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="曜日・時間"
                      sortKey="dayTime"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[100px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="所要"
                      sortKey="duration"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[70px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="形式"
                      sortKey="format"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[90px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="主催"
                      sortKey="owner"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[120px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                    <SortableTh
                      label="ステータス"
                      sortKey="status"
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[100px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                    <th className="min-w-[200px] bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                      対象ステークホルダー
                    </th>
                    <th className="min-w-[160px] bg-indigo-50 px-3 py-2 text-left text-xs font-semibold text-indigo-700">
                      対象領域
                    </th>
                    <th className="min-w-[180px] bg-rose-50 px-3 py-2 text-left text-xs font-semibold text-rose-700">
                      レビュー対象リスク
                    </th>
                    <th className="w-12 px-2 py-2" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {sortedMeetings.map((m, i) => {
                    const owner = m.ownerStakeholderId
                      ? stakeholderById.get(m.ownerStakeholderId)
                      : undefined;
                    const reviewRisks = risksByMeeting.get(m.id) ?? [];
                    const active = isActive(m.status);
                    return (
                      <tr
                        key={m.id}
                        onClick={() => openEdit(m)}
                        className={`cursor-pointer border-b border-gray-100 align-top hover:bg-blue-50/40 ${
                          active ? '' : 'opacity-60'
                        }`}
                        title="クリックして編集"
                      >
                        <td className="px-2 py-2.5 align-middle text-xs text-gray-400">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          <span className="font-medium text-[#050f3e]">
                            {m.name || '（無題）'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-gray-700">
                          <div className="line-clamp-2 max-w-[260px] text-xs">
                            {m.purpose || m.goal || (
                              <span className="text-gray-300">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 align-middle text-gray-700">
                          {m.frequency || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-gray-700">
                          {m.dayTime || <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5 align-middle text-gray-700">
                          {m.durationMinutes != null ? (
                            `${m.durationMinutes}分`
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          {m.format ? (
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[11px] ${formatBadgeClasses(
                                m.format,
                              )}`}
                            >
                              {m.format}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 align-middle">
                          {owner ? (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-800">
                              <Crown className="h-3.5 w-3.5 text-amber-500" />
                              {owner.name}
                            </span>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>

                        {/* ステータス（開催中/休止 トグル、行クリックとは独立） */}
                        <td
                          className="px-3 py-2.5 align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => toggleStatus(m)}
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                              active
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'border-gray-300 bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                            title={
                              active
                                ? 'クリックで休止にする'
                                : 'クリックで開催中にする'
                            }
                          >
                            {active ? (
                              <Play className="h-3 w-3" />
                            ) : (
                              <Pause className="h-3 w-3" />
                            )}
                            {active ? '開催中' : '休止'}
                          </button>
                        </td>

                        {/* 対象ステークホルダー（チップ） */}
                        <td className="bg-blue-50/40 px-3 py-2.5 align-middle">
                          <div className="flex max-w-[300px] flex-wrap gap-1">
                            {m.stakeholderIds.length === 0 && (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                            {m.stakeholderIds.map((sid) => {
                              const s = stakeholderById.get(sid);
                              return (
                                <span
                                  key={sid}
                                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
                                  title={s?.affiliation ?? undefined}
                                >
                                  {s?.name ?? '（不明）'}
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        {/* 対象領域（SubProject チップ。サブ領域は「親 > 子」を title に） */}
                        <td className="bg-indigo-50/40 px-3 py-2.5 align-middle">
                          <div className="flex max-w-[240px] flex-wrap gap-1">
                            {(m.subProjectIds ?? []).length === 0 && (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                            {(m.subProjectIds ?? []).map((spid) => {
                              const sp = subProjectById.get(spid);
                              return (
                                <span
                                  key={spid}
                                  className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-800"
                                  title={sp ? subProjectPath(sp) : undefined}
                                >
                                  <FolderTree className="h-3 w-3 shrink-0" />
                                  {sp?.name ?? '（不明）'}
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        {/* レビュー対象リスク（Risk.reviewMeetingId の逆引き） */}
                        <td
                          className="bg-rose-50/40 px-3 py-2.5 align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {reviewRisks.length === 0 && (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                            {reviewRisks.map((r) => {
                              const score = riskScore(
                                r.probabilityScore,
                                r.impactScore,
                              );
                              return (
                                <Link
                                  key={r.id}
                                  href={`/dashboard/projects/${projectId}/risk-management`}
                                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] text-rose-800 hover:bg-rose-200"
                                  title={`${riskName(r)}（リスクマネジメントで開く）`}
                                >
                                  <ShieldAlert className="h-3 w-3 shrink-0" />
                                  <span className="truncate">
                                    {truncateText(riskName(r), 16)}
                                  </span>
                                  {score != null && (
                                    <span
                                      className={`inline-flex shrink-0 rounded-full border px-1 text-[10px] font-bold tabular-nums ${scoreBandBadgeClasses[scoreBand(score)]}`}
                                    >
                                      {score}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                          </div>
                        </td>

                        <td
                          className="px-2 py-2.5 text-center align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => handleDelete(m)}
                            className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            title="この会議体を削除"
                            aria-label="この会議体を削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {meetings.length === 0 && (
                    <tr>
                      <td
                        colSpan={13}
                        className="px-4 py-10 text-center text-sm text-gray-400"
                      >
                        まだ会議体がありません。「会議体を追加」から始めましょう。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {!loading && (
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
              <p className="text-xs text-gray-400">{meetings.length} 会議体</p>
              <button
                type="button"
                onClick={openCreate}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                会議体を追加
              </button>
            </div>
          )}
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
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
                <CalendarClock className="h-4 w-4 text-blue-600" />
                {editId ? `${draft.name || '（無題）'} を編集` : '会議体を追加'}
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

            <div className="max-h-[66vh] space-y-3 overflow-auto px-5 py-4">
              {/* 会議名 */}
              <Field label="会議名" required>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraftField('name', e.target.value)}
                  placeholder="例：定例ステアリングコミッティ"
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="目的">
                  <textarea
                    value={draft.purpose}
                    onChange={(e) => setDraftField('purpose', e.target.value)}
                    rows={2}
                    placeholder="何のための会議か"
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="ゴール・アウトプット">
                  <textarea
                    value={draft.goal}
                    onChange={(e) => setDraftField('goal', e.target.value)}
                    rows={2}
                    placeholder="会議の終わりに何が決まっている状態か"
                    className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="頻度">
                  <input
                    type="text"
                    value={draft.frequency}
                    onChange={(e) => setDraftField('frequency', e.target.value)}
                    placeholder="例：週次／隔週／月次"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="曜日・時間">
                  <input
                    type="text"
                    value={draft.dayTime}
                    onChange={(e) => setDraftField('dayTime', e.target.value)}
                    placeholder="例：毎週月曜 10:00"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="所要時間（分）">
                  <input
                    type="number"
                    min={0}
                    value={draft.durationMinutes}
                    onChange={(e) =>
                      setDraftField('durationMinutes', e.target.value)
                    }
                    placeholder="例：60"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="形式">
                  <select
                    value={draft.format}
                    onChange={(e) => setDraftField('format', e.target.value)}
                    className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">（未設定）</option>
                    {FORMAT_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="場所 / 会議URL">
                    <input
                      type="text"
                      value={draft.locationUrl}
                      onChange={(e) =>
                        setDraftField('locationUrl', e.target.value)
                      }
                      placeholder="例：本社3F会議室A / https://meet.example.com/..."
                      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </Field>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="主催（ファシリテーター）">
                  <select
                    value={draft.ownerStakeholderId}
                    onChange={(e) =>
                      setDraftField('ownerStakeholderId', e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">
                      {stakeholders.length > 0
                        ? '（未設定）'
                        : '（ステークホルダー未登録）'}
                    </option>
                    {stakeholders.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.affiliation ? `（${s.affiliation}）` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="議事録担当">
                  <input
                    type="text"
                    value={draft.minutesOwner}
                    onChange={(e) =>
                      setDraftField('minutesOwner', e.target.value)
                    }
                    placeholder="議事録担当"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
                <Field label="意思決定者">
                  <input
                    type="text"
                    value={draft.decisionMaker}
                    onChange={(e) =>
                      setDraftField('decisionMaker', e.target.value)
                    }
                    placeholder="意思決定者"
                    className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </Field>
              </div>

              {/* ステータス */}
              <Field label="ステータス">
                <div className="flex gap-2">
                  {(
                    [
                      { value: 'ACTIVE', label: '開催中' },
                      { value: 'SUSPENDED', label: '休止' },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => setDraftField('status', o.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        draft.status === o.value
                          ? o.value === 'ACTIVE'
                            ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                            : 'border-gray-400 bg-gray-100 text-gray-700'
                          : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </Field>

              {/* 対象ステークホルダー（複数選択） */}
              <Field label="対象ステークホルダー">
                {stakeholders.length === 0 ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                    ステークホルダーが未登録です。
                    <Link
                      href={`/dashboard/projects/${projectId}/stakeholder-management`}
                      className="ml-1 font-medium underline"
                    >
                      ステークホルダーマネジメント
                    </Link>
                    で関係者を登録すると選択できます。
                  </p>
                ) : (
                  <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 p-1.5">
                    {stakeholders.map((s) => {
                      const checked = draft.stakeholderIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDraftStakeholder(s.id)}
                            className="h-3.5 w-3.5"
                          />
                          <span className="flex-1 text-gray-800">{s.name}</span>
                          {s.affiliation && (
                            <span className="text-[10px] text-gray-400">
                              {s.affiliation}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                {draft.stakeholderIds.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {draft.stakeholderIds.map((sid) => (
                      <span
                        key={sid}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800"
                      >
                        {stakeholderById.get(sid)?.name ?? '（不明）'}
                        <button
                          type="button"
                          onClick={() => toggleDraftStakeholder(sid)}
                          className="text-blue-500 hover:text-blue-800"
                          aria-label="外す"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Field>

              {/* 対象領域（領域→サブ領域の入れ子チェックボックスで複数選択） */}
              <Field label="対象領域">
                {subProjects.length === 0 ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
                    領域が未登録です。
                    <Link
                      href={`/dashboard/projects/${projectId}/domains`}
                      className="ml-1 font-medium underline"
                    >
                      領域
                    </Link>
                    で領域・サブ領域を登録すると選択できます。
                  </p>
                ) : (
                  <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border border-gray-200 p-1.5">
                    {subProjectTree.map(({ row: sp, depth }) => {
                      const checked = draft.subProjectIds.includes(sp.id);
                      return (
                        <label
                          key={sp.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50"
                          style={{ paddingLeft: `${8 + depth * 20}px` }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDraftSubProject(sp.id)}
                            className="h-3.5 w-3.5"
                          />
                          {depth > 0 ? (
                            <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          ) : (
                            <FolderTree className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                          )}
                          <span
                            className={`flex-1 ${
                              depth > 0
                                ? 'text-gray-700'
                                : 'font-medium text-gray-800'
                            }`}
                          >
                            {sp.name}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {draft.subProjectIds.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {draft.subProjectIds.map((spid) => {
                      const sp = subProjectById.get(spid);
                      return (
                        <span
                          key={spid}
                          className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-800"
                          title={sp ? subProjectPath(sp) : undefined}
                        >
                          {sp?.name ?? '（不明）'}
                          <button
                            type="button"
                            onClick={() => toggleDraftSubProject(spid)}
                            className="text-indigo-500 hover:text-indigo-800"
                            aria-label="外す"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </Field>

              {/* レビュー対象リスク（Risk.reviewMeetingId の逆引き、読み取り専用） */}
              {editId && (
                <Field label="レビュー対象リスク">
                  {(() => {
                    const reviewRisks = risksByMeeting.get(editId) ?? [];
                    if (reviewRisks.length === 0) {
                      return (
                        <p className="text-xs text-gray-400">
                          この会議をレビュー会議に設定しているリスクはありません。
                          紐付けは
                          <Link
                            href={`/dashboard/projects/${projectId}/risk-management`}
                            className="mx-1 font-medium text-blue-600 hover:underline"
                          >
                            リスクマネジメント
                          </Link>
                          の各リスク編集（レビュー会議）から行います。
                        </p>
                      );
                    }
                    return (
                      <ul className="space-y-1 rounded-md border border-gray-200 p-2">
                        {reviewRisks.map((r) => {
                          const score = riskScore(
                            r.probabilityScore,
                            r.impactScore,
                          );
                          const lc = lifecycleMeta(r.lifecycle ?? 'IDENTIFIED');
                          return (
                            <li
                              key={r.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              {score != null ? (
                                <span
                                  className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${scoreBandBadgeClasses[scoreBand(score)]}`}
                                  title="スコア（確率×影響）"
                                >
                                  {score}
                                </span>
                              ) : (
                                <span className="inline-flex shrink-0 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-400">
                                  未評価
                                </span>
                              )}
                              <span
                                className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${lc.chip}`}
                              >
                                {lc.label}
                              </span>
                              <Link
                                href={`/dashboard/projects/${projectId}/risk-management`}
                                className="inline-flex min-w-0 items-center gap-1 text-blue-600 hover:underline"
                                title="リスクマネジメントで開く"
                              >
                                <ShieldAlert className="h-3 w-3 shrink-0" />
                                <span className="truncate">{riskName(r)}</span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </Field>
              )}

              <Field label="アジェンダ雛形">
                <textarea
                  value={draft.agendaTemplate}
                  onChange={(e) =>
                    setDraftField('agendaTemplate', e.target.value)
                  }
                  rows={3}
                  placeholder={'1. 前回からの進捗\n2. 課題・リスク\n3. 次アクション'}
                  className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>
              <Field label="事前資料">
                <textarea
                  value={draft.preMaterials}
                  onChange={(e) => setDraftField('preMaterials', e.target.value)}
                  rows={2}
                  placeholder="事前に共有しておく資料・準備"
                  className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>
              <Field label="備考">
                <textarea
                  value={draft.note}
                  onChange={(e) => setDraftField('note', e.target.value)}
                  rows={2}
                  placeholder="備考"
                  className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </Field>

              {modalError && (
                <p className="text-xs text-rose-600">{modalError}</p>
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
                onClick={handleSave}
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

/** モーダルのラベル付きフィールド。 */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-gray-500">
        {label}
        {required && <span className="ml-1 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}
