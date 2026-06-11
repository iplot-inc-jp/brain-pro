'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import {
  INFLUENCE_LEVELS,
  SUPPORT_LEVELS,
  pickLevel,
  buildInfluenceSupportGrid,
  type Influence,
  type Support,
  type Stakeholder,
  type StakeholderInput,
  type Role,
  type Meeting,
  listStakeholders,
  createStakeholder,
  updateStakeholder,
  deleteStakeholder,
  listRoles,
  updateRole,
  listMeetings,
} from '@/lib/stakeholders';

// 編集モーダルに出す全フィールド（表示順とラベル・複数行可否）。
const STAKEHOLDER_FIELDS: {
  key: keyof StakeholderInput;
  label: string;
  multiline?: boolean;
  kind?: 'influence' | 'support' | 'role' | 'text';
}[] = [
  { key: 'name', label: '氏名' },
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

const ROLE_DETAIL_FIELDS: {
  key: 'responsibility' | 'decisionScope' | 'kpi';
  label: string;
}[] = [
  { key: 'responsibility', label: '主な責任' },
  { key: 'decisionScope', label: '主な意思決定範囲' },
  { key: 'kpi', label: '関心のあるKPI' },
];

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
    loading,
    error,
    reload,
    setStakeholders,
    setRoles,
  } = useStakeholderData(projectId);

  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // 編集モーダル（編集 or 新規追加）。editId=null かつ open=true で新規。
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});

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

  const openEdit = (id: string) => {
    setEditId(id);
    setDraft(stakeholderToDraft(byId.get(id) ?? null));
    setActionError(null);
    setModalOpen(true);
  };

  const openCreate = (inf?: Influence, sup?: Support) => {
    setEditId(null);
    const d = stakeholderToDraft(null);
    if (inf) d.influence = inf;
    if (sup) d.support = sup;
    setDraft(d);
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
      if (editId) {
        await updateStakeholder(editId, input);
      } else {
        await createStakeholder(projectId, input);
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
                    <th
                      key={col.key as string}
                      className="min-w-[120px] whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-gray-600"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="min-w-[160px] whitespace-nowrap bg-blue-50 px-3 py-2 text-left text-xs font-semibold text-blue-700">
                    参加会議
                  </th>
                  <th className="w-12 px-2 py-2" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {stakeholders.map((s, i) => (
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
                          <span className="font-medium text-[#050f3e]">
                            {s.name || '（無名）'}
                          </span>
                        ) : (
                          ((s[col.key] as string | null) ?? '') || (
                            <span className="text-gray-300">—</span>
                          )
                        )}
                      </td>
                    ))}

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
                          0 && <span className="text-xs text-gray-300">—</span>}
                      </div>
                    </td>

                    <td
                      className="px-2 py-2 text-center align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleDelete(s.id)}
                        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="このステークホルダーを削除"
                        aria-label="このステークホルダーを削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {stakeholders.length === 0 && (
                  <tr>
                    <td
                      colSpan={TABLE_COLS.length + 3}
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

      {/* 役割と責任（Role テーブル） */}
      <div className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
          <UserCog className="h-4 w-4 text-blue-600" />
          役割と責任
        </h3>
        <p className="text-xs text-gray-500">
          ロールごとに責任・意思決定範囲・関心KPIを定義します。各ロールには、ステークホルダーの「役割」がそのロール名と一致する関係者がまとまります。
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
              return (
                <Card key={role.id} className="bg-white border-gray-200">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-[#050f3e]">
                        {role.name}
                      </h4>
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
// データ読み込みフック（このタブ内のローカル状態）
// ---------------------------------------------------------------------------

function useStakeholderData(projectId: string) {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      // 会議は「参加会議」チップの逆引き用。失敗しても本体は出す。
      const [sh, rl, mt] = await Promise.all([
        listStakeholders(projectId),
        listRoles(projectId),
        listMeetings(projectId).catch(() => [] as Meeting[]),
      ]);
      setStakeholders(sh);
      setRoles(rl);
      setMeetings(mt);
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
    loading,
    error,
    reload,
    setStakeholders,
    setRoles,
  };
}
