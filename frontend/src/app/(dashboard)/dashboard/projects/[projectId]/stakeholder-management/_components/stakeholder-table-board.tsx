'use client';

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  Loader2,
  Trash2,
  Plus,
  UserPlus,
  Pencil,
  X,
  Save,
  UserCog,
  Users,
  Crown,
  Eye,
  Grid3x3,
} from 'lucide-react';
import {
  INFLUENCE_LEVELS,
  SUPPORT_LEVELS,
  pickLevel,
  buildInfluenceSupportGrid,
  normalizeSide,
  sideMeta,
  raciMeta,
  pickRaci,
  orderDomainTree,
  type Influence,
  type Support,
  type Side,
  type Raci,
  type Stakeholder,
  type StakeholderInput,
  type Role,
  type Meeting,
  type DomainAssignment,
  type DomainAssignmentItem,
  listStakeholders,
  createStakeholder,
  updateStakeholder,
  deleteStakeholder,
  listRoles,
  updateRole,
  listMeetings,
  listAssignments,
  setDomainAssignments,
} from '@/lib/stakeholders';
import { subProjectApi, type SubProjectMaster } from '@/lib/masters';
import { listRisks, type Risk } from '@/lib/risks';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';
import { RaciMatrix } from './raci-matrix';
import { StakeholderDetailPanel } from './stakeholder-detail-panel';

// 編集モーダルに出す全フィールド（表示順とラベル・複数行可否）。
const STAKEHOLDER_FIELDS: {
  key: keyof StakeholderInput;
  label: string;
  multiline?: boolean;
  kind?: 'influence' | 'support' | 'role' | 'side' | 'text';
}[] = [
  { key: 'name', label: '氏名' },
  { key: 'side', label: '側（内部/外部）', kind: 'side' },
  { key: 'affiliation', label: '所属・役職' },
  { key: 'role', label: '役割', kind: 'role' },
  { key: 'interest', label: '関心事（成功と感じるもの）', multiline: true },
  { key: 'concern', label: '不安・懸念', multiline: true },
  { key: 'influence', label: '影響度', kind: 'influence' },
  { key: 'support', label: '支持度', kind: 'support' },
  { key: 'asisHearing', label: 'ASISヒアリング状況', multiline: true },
  { key: 'tobeSparring', label: 'TOBE壁打ち状況', multiline: true },
  { key: 'engagement', label: '巻き込み方', multiline: true },
  { key: 'reportFrequency', label: '報告頻度' },
  { key: 'contactMethod', label: '連絡手段' },
  { key: 'owner', label: '主担当' },
  { key: 'reportLine', label: '上司（報告ライン）' },
  { key: 'note', label: '備考', multiline: true },
];

// テーブルに出す列（一覧の見やすさ優先で主要列のみ）。
const TABLE_COLS: { key: keyof Stakeholder; label: string }[] = [
  { key: 'name', label: '氏名' },
  { key: 'affiliation', label: '所属・役職' },
  { key: 'role', label: '役割' },
  { key: 'influence', label: '影響度' },
  { key: 'support', label: '支持度' },
  { key: 'owner', label: '主担当' },
  { key: 'reportFrequency', label: '報告頻度' },
];

// 一覧ヘッダークリックソート用 accessor（キーは TABLE_COLS の key と一致）。
// 影響度・支持度はレベル定義順（高→中→低 / 支持→中立→反対）で数値比較し、
// 未設定・区分外は null（useTableSort の仕様で方向に関わらず末尾）。
// 他の列は表示と同じ文字列で localeCompare('ja') 比較。
const SORT_ACCESSORS: Record<
  string,
  (s: Stakeholder) => string | number | null
> = {
  name: (s) => (s.name ?? '').trim(),
  affiliation: (s) => (s.affiliation ?? '').trim(),
  role: (s) => (s.role ?? '').trim(),
  influence: (s) => {
    const lv = pickLevel(s.influence, INFLUENCE_LEVELS);
    return lv === '' ? null : INFLUENCE_LEVELS.indexOf(lv);
  },
  support: (s) => {
    const lv = pickLevel(s.support, SUPPORT_LEVELS);
    return lv === '' ? null : SUPPORT_LEVELS.indexOf(lv);
  },
  owner: (s) => (s.owner ?? '').trim(),
  reportFrequency: (s) => (s.reportFrequency ?? '').trim(),
};

const ROLE_DETAIL_FIELDS: {
  key: 'responsibility' | 'decisionScope' | 'kpi';
  label: string;
}[] = [
  { key: 'responsibility', label: '主な責任' },
  { key: 'decisionScope', label: '主な意思決定範囲' },
  { key: 'kpi', label: '関心のあるKPI' },
];

// 「未割当」を表すセンチネル（select の value に空文字を使わない作法）。
const NONE = '__none__';

/** 支持度→カードの色。 */
function supportClasses(support: Support | ''): string {
  switch (support) {
    case '支持':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900';
    case '反対':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case '中立':
      return 'border-gray-300 bg-gray-50 text-gray-800';
    default:
      return 'border-gray-200 bg-white text-gray-700';
  }
}

/** 編集ドラフト（モーダル用、null許容を空文字に正規化して扱う）。 */
type Draft = Record<string, string>;

function stakeholderToDraft(s: Stakeholder | null): Draft {
  const d: Draft = {};
  for (const f of STAKEHOLDER_FIELDS) {
    const v = s ? (s[f.key as keyof Stakeholder] as unknown) : '';
    d[f.key as string] = v == null ? '' : String(v);
  }
  return d;
}

function draftToInput(d: Draft): StakeholderInput {
  const input: Record<string, string | null> = {};
  for (const f of STAKEHOLDER_FIELDS) {
    const v = (d[f.key as string] ?? '').trim();
    input[f.key as string] = f.key === 'name' ? v : v === '' ? null : v;
  }
  return input as unknown as StakeholderInput;
}

export function StakeholderTableBoard({ projectId }: { projectId: string }) {
  const {
    stakeholders,
    roles,
    meetings,
    domains,
    assignments,
    assignmentsReady,
    risks,
    loading,
    error,
    reload,
    setStakeholders,
    setRoles,
    setAssignments,
  } = useStakeholderData(projectId);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 編集モーダル（編集 or 新規追加）。editId=null かつ open=true で新規。
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  // 編集モーダル内の担当領域（subProjectId → RACI、'' は割当なし）
  const [assignDraft, setAssignDraft] = useState<Record<string, Raci | ''>>({});
  // 開いた時点の割当（変更がなければ保存時に PUT しない）
  const [assignInitialJson, setAssignInitialJson] = useState('');

  // 人単位ビュー（詳細サイドパネル）
  const [detailId, setDetailId] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(stakeholders.map((s) => [s.id, s])),
    [stakeholders],
  );

  const roleNames = useMemo(
    () =>
      Array.from(
        new Set(roles.map((r) => r.name.trim()).filter((n) => n.length > 0)),
      ),
    [roles],
  );

  const grid = useMemo(
    () => buildInfluenceSupportGrid(stakeholders),
    [stakeholders],
  );

  // 参加会議の逆引き（Meeting.stakeholderIds + 主催 ownerStakeholderId）。
  // stakeholderId → その人が参加/主催する会議のリスト。
  const meetingsByStakeholder = useMemo(() => {
    const map = new Map<string, { meeting: Meeting; isOwner: boolean }[]>();
    for (const m of meetings) {
      const memberIds =
        m.ownerStakeholderId && !m.stakeholderIds.includes(m.ownerStakeholderId)
          ? [...m.stakeholderIds, m.ownerStakeholderId]
          : m.stakeholderIds;
      for (const sid of memberIds) {
        const arr = map.get(sid) ?? [];
        arr.push({ meeting: m, isOwner: m.ownerStakeholderId === sid });
        map.set(sid, arr);
      }
    }
    return map;
  }, [meetings]);

  const unplaced = useMemo(
    () =>
      stakeholders.filter(
        (s) =>
          !pickLevel(s.influence, INFLUENCE_LEVELS) ||
          !pickLevel(s.support, SUPPORT_LEVELS),
      ),
    [stakeholders],
  );

  // 担当領域（RACI）の逆引き: stakeholderId → 割当リスト（行チップ・モーダル初期値）
  const assignmentsByStakeholder = useMemo(() => {
    const map = new Map<string, DomainAssignment[]>();
    for (const a of assignments) {
      const arr = map.get(a.stakeholderId) ?? [];
      arr.push(a);
      map.set(a.stakeholderId, arr);
    }
    return map;
  }, [assignments]);

  const domainById = useMemo(
    () => new Map(domains.map((d) => [d.id, d])),
    [domains],
  );

  // 領域の入れ子表示（循環ガード付きツリー順）
  const domainTreeRows = useMemo(() => orderDomainTree(domains), [domains]);

  // ロールの「領域」select 用の選択肢（親→子をインデント。循環は orderDomainTree が防ぐ）
  const domainOptions = useMemo(
    () =>
      domainTreeRows.map(({ row, depth }) => ({
        id: row.id,
        label: depth > 0 ? `${'　'.repeat(depth - 1)}　└ ${row.name}` : row.name,
      })),
    [domainTreeRows],
  );

  // ヘッダークリックソート（昇順→降順→解除。解除時は従来の手動順＝API の並びに戻る）。
  // 全体を安定ソートしてから外部/内部に分けるため、並び替えは各セクション内に閉じる
  // （セクション見出し行をまたいで行が混ざることはない）。
  const {
    sorted: sortedStakeholders,
    sortKey,
    sortDir,
    toggleSort,
  } = useTableSort(stakeholders, SORT_ACCESSORS);

  // 一覧テーブルの2セクション（外部 → 内部）
  const sections = useMemo(
    () =>
      (['EXTERNAL', 'INTERNAL'] as Side[]).map((side) => ({
        side,
        members: sortedStakeholders.filter(
          (s) => normalizeSide(s.side) === side,
        ),
      })),
    [sortedStakeholders],
  );

  const draftFromAssignments = (
    id: string | null,
  ): Record<string, Raci | ''> => {
    const d: Record<string, Raci | ''> = {};
    if (!id) return d;
    for (const a of assignmentsByStakeholder.get(id) ?? []) {
      const r = pickRaci(a.raci);
      if (r) d[a.subProjectId] = r;
    }
    return d;
  };

  // 比較用（割当なしを除き、subProjectId 昇順で安定化）
  const serializeAssignDraft = (d: Record<string, Raci | ''>): string =>
    JSON.stringify(
      Object.entries(d)
        .filter(([, v]) => v !== '')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );

  const openEdit = (id: string) => {
    setEditId(id);
    setDraft(stakeholderToDraft(byId.get(id) ?? null));
    const ad = draftFromAssignments(id);
    setAssignDraft(ad);
    setAssignInitialJson(serializeAssignDraft(ad));
    setActionError(null);
    setModalOpen(true);
  };

  const openCreate = (inf?: Influence, sup?: Support) => {
    setEditId(null);
    const d = stakeholderToDraft(null);
    if (inf) d.influence = inf;
    if (sup) d.support = sup;
    setDraft(d);
    setAssignDraft({});
    setAssignInitialJson(serializeAssignDraft({}));
    setActionError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditId(null);
  };

  const setDraftField = (key: string, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const handleSaveModal = async () => {
    const input = draftToInput(draft);
    if (!input.name) {
      setActionError('氏名は必須です');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const saved = editId
        ? await updateStakeholder(editId, input)
        : await createStakeholder(projectId, input);
      // 担当領域（RACI）: 変更があるときだけ replace-all 保存
      if (
        assignmentsReady &&
        serializeAssignDraft(assignDraft) !== assignInitialJson
      ) {
        const items: DomainAssignmentItem[] = Object.entries(assignDraft)
          .filter((e): e is [string, Raci] => e[1] !== '')
          .map(([subProjectId, raci]) => ({ subProjectId, raci }));
        await setDomainAssignments(saved.id, items);
      }
      await reload();
      closeModal();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  // 最新の assignments を同期参照する ref。
  // 再レンダー前の連打（クロージャの古い assignments）対策として、
  // handleRaciCell では state ではなくこの ref から次状態を導出する。
  const assignmentsRef = useRef<DomainAssignment[]>(assignments);
  useEffect(() => {
    assignmentsRef.current = assignments;
  }, [assignments]);

  // ステークホルダー単位の保存直列化キュー。
  // PUT は replace-all 仕様のため、先発 PUT が後発より遅く完了すると
  // 先の割当が消える。前の PUT 完了を待ってから送信時点の最新状態を送る
  // （last-write-wins）ことで UI と DB の乖離を防ぐ。
  const raciSaveChain = useRef<Map<string, Promise<void>>>(new Map());

  // RACI マトリクスのセル編集（楽観更新 + その人の割当を replace-all 保存）
  const handleRaciCell = (
    stakeholderId: string,
    subProjectId: string,
    raci: Raci | null,
  ) => {
    if (!assignmentsReady) return;
    const next = assignmentsRef.current.filter(
      (a) =>
        !(a.stakeholderId === stakeholderId && a.subProjectId === subProjectId),
    );
    if (raci) next.push({ stakeholderId, subProjectId, raci });
    assignmentsRef.current = next;
    setAssignments(next);

    const prev = raciSaveChain.current.get(stakeholderId) ?? Promise.resolve();
    const run = prev
      .then(async () => {
        // 送信時点の最新状態からその人のペイロードを導出
        const items: DomainAssignmentItem[] = [];
        for (const a of assignmentsRef.current) {
          if (a.stakeholderId !== stakeholderId) continue;
          const r = pickRaci(a.raci);
          if (r) items.push({ subProjectId: a.subProjectId, raci: r });
        }
        await setDomainAssignments(stakeholderId, items);
      })
      .catch(async (e: unknown) => {
        setActionError(
          e instanceof Error ? e.message : '担当領域の更新に失敗しました',
        );
        await reload();
      });
    raciSaveChain.current.set(stakeholderId, run);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('このステークホルダーを削除しますか？')) return;
    setActionError(null);
    try {
      await deleteStakeholder(id);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '削除に失敗しました');
    }
  };

  // マトリクスのセル選択でその場で影響度/支持度を更新（楽観更新 + PATCH）。
  const moveTo = async (id: string, inf: Influence, sup: Support) => {
    setStakeholders((prev) =>
      prev.map((s) => (s.id === id ? { ...s, influence: inf, support: sup } : s)),
    );
    try {
      await updateStakeholder(id, { influence: inf, support: sup });
    } catch {
      await reload();
    }
  };

  const setLevel = async (
    id: string,
    key: 'influence' | 'support',
    value: string,
  ) => {
    setStakeholders((prev) =>
      prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)),
    );
    try {
      await updateStakeholder(id, { [key]: value || null });
    } catch {
      await reload();
    }
  };

  // ── 役割と責任（Role テーブル）インライン編集 ──
  const setRoleField = (
    id: string,
    key: 'responsibility' | 'decisionScope' | 'kpi',
    value: string,
  ) =>
    setRoles((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [key]: value } : r)),
    );

  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const handleSaveRole = async (role: Role) => {
    setSavingRoleId(role.id);
    setActionError(null);
    try {
      await updateRole(role.id, {
        responsibility: role.responsibility ?? null,
        decisionScope: role.decisionScope ?? null,
        kpi: role.kpi ?? null,
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'ロールの保存に失敗しました');
      await reload();
    } finally {
      setSavingRoleId(null);
    }
  };

  // ロールの領域（SubProject）変更。select 変更で即 PATCH（楽観更新・失敗時は reload）。
  const handleRoleDomainChange = async (id: string, value: string) => {
    const subProjectId = value === NONE ? null : value;
    setRoles((prev) =>
      prev.map((r) => (r.id === id ? { ...r, subProjectId } : r)),
    );
    setActionError(null);
    try {
      await updateRole(id, { subProjectId });
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : 'ロールの領域の更新に失敗しました',
      );
      await reload();
    }
  };

  const stakeholdersForRole = (roleName: string) =>
    stakeholders.filter((s) => (s.role ?? '').trim() === roleName.trim());

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          関係者を一覧から管理します。行をクリックすると全項目を編集できます。
        </p>
        <button
          type="button"
          onClick={() => openCreate()}
          className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <UserPlus className="h-4 w-4" />
          ステークホルダーを追加
        </button>
      </div>

      {(error || actionError) && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error || actionError}
        </div>
      )}

      {/* 一覧テーブル（主） */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-2 py-2 text-left text-xs font-medium text-gray-400">
                    #
                  </th>
                  {TABLE_COLS.map((col) => (
                    <SortableTh
                      key={col.key as string}
                      label={col.label}
                      sortKey={col.key as string}
                      current={sortKey}
                      dir={sortDir}
                      onToggle={toggleSort}
                      className="min-w-[120px] whitespace-nowrap text-left text-xs font-semibold text-gray-600"
                    />
                  ))}
                  <th className="min-w-[160px] whitespace-nowrap bg-indigo-50 px-3 py-2 text-left text-xs font-semibold text-indigo-700">
                    担当領域（RACI）
                  </th>
                  <th className="min-w-[160px] whitespace-nowrap bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                    参加会議
                  </th>
                  <th className="w-20 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {sections.map(({ side, members }) => (
                  <Fragment key={side}>
                    {/* セクション見出し（外部 / 内部） */}
                    {stakeholders.length > 0 && (
                      <tr
                        className={`border-b ${
                          side === 'EXTERNAL'
                            ? 'border-blue-100 bg-blue-50/60'
                            : 'border-emerald-100 bg-emerald-50/60'
                        }`}
                      >
                        <td
                          colSpan={TABLE_COLS.length + 4}
                          className={`px-3 py-1.5 text-xs font-semibold ${
                            side === 'EXTERNAL'
                              ? 'text-blue-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {sideMeta[side].label} {members.length} 名
                        </td>
                      </tr>
                    )}
                    {members.map((s, i) => (
                      <tr
                        key={s.id}
                        onClick={() => openEdit(s.id)}
                        className="cursor-pointer border-b border-gray-100 hover:bg-blue-50/40"
                        title="クリックして編集"
                      >
                        <td className="px-2 py-2 align-middle text-xs text-gray-400">
                          {i + 1}
                        </td>
                        {TABLE_COLS.map((col) => (
                          <td
                            key={col.key as string}
                            className="px-3 py-2 align-middle text-gray-900"
                          >
                            {col.key === 'name' ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="font-medium text-[#050f3e]">
                                  {s.name || '（無名）'}
                                </span>
                                <span
                                  className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${sideMeta[normalizeSide(s.side)].badge}`}
                                >
                                  {sideMeta[normalizeSide(s.side)].short}
                                </span>
                              </span>
                            ) : (
                              ((s[col.key] as string | null) ?? '') || (
                                <span className="text-gray-300">—</span>
                              )
                            )}
                          </td>
                        ))}

                        {/* 担当領域（領域×RACI の逆引きチップ。A は★で強調） */}
                        <td
                          className="bg-indigo-50/40 px-3 py-2 align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {(assignmentsByStakeholder.get(s.id) ?? []).flatMap(
                              (a) => {
                                const domain = domainById.get(a.subProjectId);
                                const raci = pickRaci(a.raci);
                                if (!domain || !raci) return [];
                                return [
                                  <button
                                    key={a.subProjectId}
                                    type="button"
                                    onClick={() => setDetailId(s.id)}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${raciMeta[raci].chip}`}
                                    title={`${domain.name}: ${raci}（${raciMeta[raci].label}）— クリックで詳細`}
                                  >
                                    <span className="font-bold">
                                      {raci === 'A' ? '★A' : raci}
                                    </span>
                                    {domain.name}
                                  </button>,
                                ];
                              },
                            )}
                            {(assignmentsByStakeholder.get(s.id) ?? []).filter(
                              (a) =>
                                domainById.has(a.subProjectId) &&
                                pickRaci(a.raci),
                            ).length === 0 && (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </div>
                        </td>

                        {/* 参加会議（会議マスタの逆引き。主催は王冠アイコン付き） */}
                        <td
                          className="bg-blue-50/40 px-3 py-2 align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {(meetingsByStakeholder.get(s.id) ?? []).map(
                              ({ meeting, isOwner }) => (
                                <Link
                                  key={meeting.id}
                                  href={`/dashboard/projects/${projectId}/meetings`}
                                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800 transition-colors hover:bg-blue-200"
                                  title={
                                    isOwner
                                      ? `${meeting.name}（主催）— 会議マスタで管理`
                                      : `${meeting.name} — 会議マスタで管理`
                                  }
                                >
                                  {isOwner && (
                                    <Crown className="h-3 w-3 text-amber-500" />
                                  )}
                                  {meeting.name || '（無題）'}
                                </Link>
                              ),
                            )}
                            {(meetingsByStakeholder.get(s.id) ?? []).length ===
                              0 && (
                              <span className="text-xs text-gray-300">—</span>
                            )}
                          </div>
                        </td>

                        <td
                          className="px-2 py-2 text-center align-middle"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => setDetailId(s.id)}
                              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                              title="この人の詳細（担当領域・リスク・会議）を見る"
                              aria-label="この人の詳細を見る"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(s.id)}
                              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                              title="このステークホルダーを削除"
                              aria-label="このステークホルダーを削除"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {stakeholders.length > 0 && members.length === 0 && (
                      <tr className="border-b border-gray-100">
                        <td
                          colSpan={TABLE_COLS.length + 4}
                          className="px-4 py-3 text-xs text-gray-400"
                        >
                          {sideMeta[side].label}のステークホルダーはいません。
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {stakeholders.length === 0 && (
                  <tr>
                    <td
                      colSpan={TABLE_COLS.length + 4}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      まだステークホルダーがいません。「ステークホルダーを追加」から始めましょう。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 影響度 × 支持度 マトリクス（同じデータを別ビューで） */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-[#050f3e]">
          影響度 × 支持度 マトリクス
        </h3>
        <Card className="bg-white border-gray-200">
          <CardContent className="overflow-x-auto p-4">
            <div className="min-w-[680px]">
              {/* 列ヘッダー（支持度） */}
              <div className="grid grid-cols-[80px_repeat(3,1fr)] gap-2">
                <div className="flex items-end justify-center pb-1 text-[11px] font-semibold text-gray-400">
                  影響度 \ 支持度
                </div>
                {SUPPORT_LEVELS.map((sup) => (
                  <div
                    key={sup}
                    className="pb-1 text-center text-xs font-semibold text-gray-600"
                  >
                    {sup}
                  </div>
                ))}
              </div>

              {/* 行（影響度） */}
              {INFLUENCE_LEVELS.map((inf) => {
                const isHigh = inf === '高';
                return (
                  <div
                    key={inf}
                    className="grid grid-cols-[80px_repeat(3,1fr)] gap-2 mt-2"
                  >
                    <div
                      className={`flex items-center justify-center rounded-md text-sm font-semibold ${
                        isHigh
                          ? 'bg-[#050f3e] text-white'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {inf}
                    </div>
                    {SUPPORT_LEVELS.map((sup) => {
                      const ids = grid.get(`${inf}__${sup}`) ?? [];
                      return (
                        <div
                          key={sup}
                          className={`min-h-[110px] rounded-md border p-2 space-y-1.5 ${
                            isHigh
                              ? 'border-blue-200 bg-blue-50/40'
                              : 'border-gray-200 bg-gray-50/40'
                          }`}
                        >
                          {ids.map((id) => {
                            const s = byId.get(id);
                            if (!s) return null;
                            return (
                              <div
                                key={id}
                                className={`group rounded-md border px-2 py-1.5 text-xs shadow-sm ${supportClasses(
                                  sup,
                                )}`}
                              >
                                <div className="flex items-start justify-between gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEdit(id)}
                                    className="text-left font-semibold leading-tight hover:underline"
                                    title="クリックして編集"
                                  >
                                    {s.name || '（無名）'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEdit(id)}
                                    className="shrink-0 rounded p-0.5 text-gray-400 opacity-0 transition-opacity hover:bg-white/60 hover:text-blue-600 group-hover:opacity-100"
                                    title="編集"
                                    aria-label="編集"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                </div>
                                {s.affiliation && (
                                  <div className="mt-0.5 text-[11px] text-gray-500">
                                    {s.affiliation}
                                  </div>
                                )}
                                <div className="mt-1 flex gap-1">
                                  <select
                                    value={inf}
                                    onChange={(e) =>
                                      moveTo(
                                        id,
                                        e.target.value as Influence,
                                        sup,
                                      )
                                    }
                                    className="w-full rounded border border-gray-200 bg-white/80 px-1 py-0.5 text-[10px] text-gray-700"
                                    aria-label="影響度"
                                  >
                                    {INFLUENCE_LEVELS.map((lv) => (
                                      <option key={lv} value={lv}>
                                        影響{lv}
                                      </option>
                                    ))}
                                  </select>
                                  <select
                                    value={sup}
                                    onChange={(e) =>
                                      moveTo(id, inf, e.target.value as Support)
                                    }
                                    className="w-full rounded border border-gray-200 bg-white/80 px-1 py-0.5 text-[10px] text-gray-700"
                                    aria-label="支持度"
                                  >
                                    {SUPPORT_LEVELS.map((lv) => (
                                      <option key={lv} value={lv}>
                                        {lv}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => openCreate(inf, sup)}
                            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-gray-300 py-1 text-[11px] text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-600"
                          >
                            <Plus className="h-3 w-3" />
                            追加
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* 未配置（影響度・支持度が未設定） */}
            {unplaced.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="mb-2 text-xs font-semibold text-amber-700">
                  未配置（影響度・支持度が未設定）{unplaced.length} 件
                </p>
                <div className="flex flex-wrap gap-2">
                  {unplaced.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => openEdit(s.id)}
                        className="font-medium text-gray-800 hover:underline"
                        title="クリックして編集"
                      >
                        {s.name || '（無名）'}
                      </button>
                      <select
                        value={pickLevel(s.influence, INFLUENCE_LEVELS)}
                        onChange={(e) =>
                          setLevel(s.id, 'influence', e.target.value)
                        }
                        className="rounded border border-gray-200 px-1 py-0.5 text-[10px]"
                        aria-label="影響度"
                      >
                        <option value="">影響度</option>
                        {INFLUENCE_LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            影響{lv}
                          </option>
                        ))}
                      </select>
                      <select
                        value={pickLevel(s.support, SUPPORT_LEVELS)}
                        onChange={(e) =>
                          setLevel(s.id, 'support', e.target.value)
                        }
                        className="rounded border border-gray-200 px-1 py-0.5 text-[10px]"
                        aria-label="支持度"
                      >
                        <option value="">支持度</option>
                        {SUPPORT_LEVELS.map((lv) => (
                          <option key={lv} value={lv}>
                            {lv}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* RACI マトリクス（領域 × 人） */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
          <Grid3x3 className="h-4 w-4 text-indigo-600" />
          RACI マトリクス（領域 × 人）
        </h3>
        <p className="text-xs text-gray-500">
          領域（サブプロジェクト）ごとに誰が
          R(実行)/A(説明責任)/C(相談)/I(報告) かを割り当てます。セルをクリックすると
          R→A→C→I→なし の順に切り替わり、そのまま保存されます。
        </p>
        {assignmentsReady ? (
          <RaciMatrix
            domains={domains}
            stakeholders={stakeholders}
            assignments={assignments}
            onCellChange={handleRaciCell}
          />
        ) : (
          <Card className="bg-white border-gray-200">
            <CardContent className="py-8 text-center text-sm text-gray-400">
              領域・担当割当の読み込みに失敗したため、RACI マトリクスは編集できません。再読み込みしてください。
            </CardContent>
          </Card>
        )}
      </div>

      {/* 役割と責任（Role テーブル） */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
          <UserCog className="h-4 w-4 text-blue-600" />
          役割と責任
        </h3>
        <p className="text-xs text-gray-500">
          ロールごとに領域（サブプロジェクト）・責任・意思決定範囲・関心KPIを定義します。領域は変更するとすぐ保存されます。各ロールには、ステークホルダーの「役割」がそのロール名と一致する関係者がまとまります。
        </p>

        {roles.length === 0 ? (
          <Card className="bg-white border-gray-200">
            <CardContent className="py-8 text-center text-sm text-gray-400">
              ロールがありません。「ロール」ページでロールを作成すると、ここで責任・意思決定範囲・KPIを定義できます。
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {roles.map((role) => {
              const members = stakeholdersForRole(role.name);
              const roleDomain = role.subProjectId
                ? domainById.get(role.subProjectId)
                : undefined;
              return (
                <Card key={role.id} className="bg-white border-gray-200">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <h4 className="text-sm font-semibold text-[#050f3e]">
                          {role.name}
                        </h4>
                        {/* 領域バッジ（割当があるときだけ） */}
                        {roleDomain && (
                          <span
                            className="inline-flex max-w-[200px] items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                            title={`領域: ${roleDomain.name}`}
                          >
                            <span className="truncate">{roleDomain.name}</span>
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* 領域（SubProject）。変更で即保存（PATCH /api/roles/:id） */}
                        <label className="flex items-center gap-1 text-[11px] font-medium text-gray-500">
                          領域
                          <select
                            value={
                              role.subProjectId &&
                              domainById.has(role.subProjectId)
                                ? role.subProjectId
                                : NONE
                            }
                            onChange={(e) =>
                              handleRoleDomainChange(role.id, e.target.value)
                            }
                            className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                            aria-label={`${role.name} の領域`}
                          >
                            <option value={NONE}>（未設定）</option>
                            {domainOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => handleSaveRole(role)}
                          disabled={savingRoleId === role.id}
                          className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {savingRoleId === role.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          保存
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      {ROLE_DETAIL_FIELDS.map((f) => (
                        <div key={f.key} className="space-y-1">
                          <label className="block text-[11px] font-medium text-gray-500">
                            {f.label}
                          </label>
                          <textarea
                            value={role[f.key] ?? ''}
                            onChange={(e) =>
                              setRoleField(role.id, f.key, e.target.value)
                            }
                            rows={2}
                            placeholder={f.label}
                            className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="rounded-md border border-gray-100 bg-gray-50/60 p-2.5">
                      <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold text-gray-500">
                        <Users className="h-3.5 w-3.5" />
                        この役割の関係者 {members.length} 名
                      </p>
                      {members.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {members.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => openEdit(s.id)}
                              className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 transition-colors hover:border-blue-300 hover:text-blue-700"
                              title="クリックして編集"
                            >
                              {s.name || '（無名）'}
                              {s.affiliation ? (
                                <span className="ml-1 text-[10px] text-gray-400">
                                  {s.affiliation}
                                </span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-gray-400">
                          このロールに割り当てられた関係者はいません（ステークホルダーの「役割」をこのロール名にすると、ここに表示されます）。
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 編集／追加モーダル（全項目） */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeModal}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-[#050f3e]">
                {editId
                  ? `${draft.name || '（無名）'} を編集`
                  : 'ステークホルダーを追加'}
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

            <div className="max-h-[60vh] space-y-3 overflow-auto px-5 py-4">
              <datalist id="sm-role-options">
                {roleNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              {STAKEHOLDER_FIELDS.map((f) => {
                const value = draft[f.key as string] ?? '';
                if (f.kind === 'influence' || f.kind === 'support') {
                  const levels =
                    f.kind === 'influence' ? INFLUENCE_LEVELS : SUPPORT_LEVELS;
                  return (
                    <div key={f.key as string} className="space-y-1">
                      <label className="block text-[11px] font-medium text-gray-500">
                        {f.label}
                      </label>
                      <select
                        value={pickLevel(value, levels)}
                        onChange={(e) =>
                          setDraftField(f.key as string, e.target.value)
                        }
                        className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">（未設定）</option>
                        {levels.map((lv) => (
                          <option key={lv} value={lv}>
                            {lv}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                if (f.kind === 'side') {
                  const current = normalizeSide(value || null);
                  return (
                    <div key={f.key as string} className="space-y-1">
                      <label className="block text-[11px] font-medium text-gray-500">
                        {f.label}
                      </label>
                      <div className="flex gap-1.5">
                        {(['INTERNAL', 'EXTERNAL'] as Side[]).map((sd) => (
                          <button
                            key={sd}
                            type="button"
                            onClick={() => setDraftField(f.key as string, sd)}
                            className={`flex-1 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                              current === sd
                                ? sd === 'INTERNAL'
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                  : 'border-blue-300 bg-blue-50 text-blue-800'
                                : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                            }`}
                          >
                            {sideMeta[sd].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
                if (f.kind === 'role') {
                  return (
                    <div key={f.key as string} className="space-y-1">
                      <label className="block text-[11px] font-medium text-gray-500">
                        {f.label}
                      </label>
                      <input
                        type="text"
                        list="sm-role-options"
                        value={value}
                        onChange={(e) =>
                          setDraftField(f.key as string, e.target.value)
                        }
                        placeholder={f.label}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      {roleNames.length > 0 && (
                        <p className="text-[10px] text-gray-400">
                          ロール名を選ぶと「役割と責任」のそのロールにまとめられます。
                        </p>
                      )}
                    </div>
                  );
                }
                return (
                  <div key={f.key as string} className="space-y-1">
                    <label className="block text-[11px] font-medium text-gray-500">
                      {f.label}
                      {f.key === 'name' && (
                        <span className="ml-1 text-rose-500">*</span>
                      )}
                    </label>
                    {f.multiline ? (
                      <textarea
                        value={value}
                        onChange={(e) =>
                          setDraftField(f.key as string, e.target.value)
                        }
                        rows={2}
                        placeholder={f.label}
                        className="w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <input
                        type="text"
                        value={value}
                        onChange={(e) =>
                          setDraftField(f.key as string, e.target.value)
                        }
                        placeholder={f.label}
                        className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    )}
                  </div>
                );
              })}
              {/* 担当領域（RACI）。保存時に setDomainAssignments で replace-all */}
              {assignmentsReady && domains.length > 0 && (
                <div className="space-y-1.5 border-t border-gray-100 pt-3">
                  <label className="block text-[11px] font-medium text-gray-500">
                    担当領域（RACI）
                  </label>
                  <p className="text-[10px] text-gray-400">
                    領域ごとに R(実行) / A(説明責任) / C(相談) / I(報告)
                    を選びます（PMBOK: A は各領域に1人）。保存ボタンでまとめて反映されます。
                  </p>
                  <div className="space-y-1">
                    {domainTreeRows.map(({ row: d, depth }) => {
                      const cur = assignDraft[d.id] ?? '';
                      return (
                        <div
                          key={d.id}
                          className="flex items-center justify-between gap-2"
                          style={{ paddingLeft: `${depth * 16}px` }}
                        >
                          <span
                            className={`min-w-0 truncate text-xs ${
                              depth > 0
                                ? 'text-gray-600'
                                : 'font-medium text-gray-800'
                            }`}
                            title={d.name}
                          >
                            {d.name}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            {(['', 'R', 'A', 'C', 'I'] as (Raci | '')[]).map(
                              (r) => (
                                <button
                                  key={r || 'none'}
                                  type="button"
                                  onClick={() =>
                                    setAssignDraft((prev) => ({
                                      ...prev,
                                      [d.id]: r,
                                    }))
                                  }
                                  className={`h-6 min-w-[30px] rounded border px-1 text-[10px] font-bold transition-colors ${
                                    cur === r
                                      ? r === ''
                                        ? 'border-gray-400 bg-gray-100 text-gray-600'
                                        : raciMeta[r].chip
                                      : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                                  }`}
                                  title={
                                    r === ''
                                      ? '割当なし'
                                      : `${r}（${raciMeta[r].label}）`
                                  }
                                >
                                  {r === '' ? 'なし' : r === 'A' ? '★A' : r}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
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

      {/* 人単位ビュー（詳細サイドパネル） */}
      {detailId && byId.get(detailId) && (
        <StakeholderDetailPanel
          projectId={projectId}
          stakeholder={byId.get(detailId)!}
          domains={domains}
          assignments={assignments}
          risks={risks}
          meetings={meetingsByStakeholder.get(detailId) ?? []}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            const id = detailId;
            setDetailId(null);
            openEdit(id);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// データ読み込みフック（このタブ内のローカル状態）
// ---------------------------------------------------------------------------

function useStakeholderData(projectId: string) {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [domains, setDomains] = useState<SubProjectMaster[]>([]);
  const [assignments, setAssignments] = useState<DomainAssignment[]>([]);
  // 領域＋割当が読めたときだけ RACI 編集（replace-all 保存）を許す。
  // 読み込み失敗時に空配列で上書き保存して既存割当を消さないためのガード。
  const [assignmentsReady, setAssignmentsReady] = useState(false);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      // 会議・領域・割当・リスクは逆引き表示用。失敗しても本体は出す。
      const [sh, rl, mt, dm, asg, rk] = await Promise.all([
        listStakeholders(projectId),
        listRoles(projectId),
        listMeetings(projectId).catch(() => [] as Meeting[]),
        subProjectApi.list(projectId).catch(() => null),
        listAssignments(projectId).catch(() => null),
        listRisks(projectId).catch(() => [] as Risk[]),
      ]);
      setStakeholders(sh);
      setRoles(rl);
      setMeetings(mt);
      setDomains(dm ?? []);
      setAssignments(asg ?? []);
      setAssignmentsReady(dm != null && asg != null);
      setRisks(rk);
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
    stakeholders,
    roles,
    meetings,
    domains,
    assignments,
    assignmentsReady,
    risks,
    loading,
    error,
    reload,
    setStakeholders,
    setRoles,
    setAssignments,
  };
}
