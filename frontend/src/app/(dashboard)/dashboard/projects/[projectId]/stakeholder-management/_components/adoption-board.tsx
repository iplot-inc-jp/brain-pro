'use client';

// 導入状況タブ（AdoptionStatus テーブル：ステークホルダー × システム の定着度）。
//
// - 上部: 6段階ファネル集計（カードクリックでその段階に絞り込み）
//   ＋対象システム select（TARGET 優先表示。「全体」= systemId null）
// - 表: 行=ステークホルダー全員（記録が無い人は未着手扱いで表示）。
//   段階（色付き select）/最終接触日/阻害要因/次アクション を
//   onBlur・変更で即 upsert（楽観更新、失敗時は reload）。
// - フィルタ: 段階（ファネルカード）・側（内部/外部）。
// - ソート: ヘッダクリックで 昇順 → 降順 → 解除（解除で元の並びに戻る）。
//   段階はファネル順、最終接触日は日付文字列、テキストは表示値で比較。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Rocket, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SortableTh } from '@/components/ui/sortable-th';
import { useTableSort } from '@/lib/use-table-sort';
import {
  ADOPTION_STAGES,
  adoptionApi,
  adoptionStageMeta,
  normalizeAdoptionStage,
  normalizeSide,
  sideMeta,
  listStakeholders,
  listAssignments,
  type AdoptionStage,
  type AdoptionStatus,
  type AdoptionStatusInput,
  type DomainAssignment,
  type Side,
  type Stakeholder,
} from '@/lib/stakeholders';
import {
  systemApi,
  subProjectApi,
  type SystemMaster,
  type SubProjectMaster,
} from '@/lib/masters';

/** (stakeholderId, systemId) の検索キー。systemId null（全体）は ''。 */
function adoptionKey(stakeholderId: string, systemId: string | null): string {
  return `${stakeholderId}__${systemId ?? ''}`;
}

/** ISO 日時 → date input 用 'YYYY-MM-DD'（未設定は ''）。 */
function toDateInput(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

/** 段階 → ファネル順の序数（段階列のソートはこの順で比較する）。 */
const stageOrder = new Map<AdoptionStage, number>(
  ADOPTION_STAGES.map((s, i) => [s.key, i]),
);

/** 行ごとの upsert パッチ（stakeholderId / systemId は親が付与）。 */
type RowPatch = Omit<AdoptionStatusInput, 'stakeholderId' | 'systemId'>;

export function AdoptionBoard({ projectId }: { projectId: string }) {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [systems, setSystems] = useState<SystemMaster[]>([]);
  const [adoptions, setAdoptions] = useState<AdoptionStatus[]>([]);
  const [domains, setDomains] = useState<SubProjectMaster[]>([]);
  const [assignments, setAssignments] = useState<DomainAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // フィルタ: 対象システム（'' = 全体 = systemId null）/ 段階 / 側
  const [systemId, setSystemId] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<AdoptionStage | null>(null);
  const [sideFilter, setSideFilter] = useState<Side | ''>('');

  const reload = useCallback(async () => {
    setError(null);
    try {
      // システム・領域・割当は補助表示用（失敗しても本体は出す）
      const [sh, ad, sys, dm, asg] = await Promise.all([
        listStakeholders(projectId),
        adoptionApi.list(projectId),
        systemApi.list(projectId).catch(() => [] as SystemMaster[]),
        subProjectApi.list(projectId).catch(() => [] as SubProjectMaster[]),
        listAssignments(projectId).catch(() => [] as DomainAssignment[]),
      ]);
      setStakeholders(sh);
      setAdoptions(ad);
      setSystems(sys);
      setDomains(dm);
      setAssignments(asg);
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

  // システム select（TARGET=対象システムを優先表示）
  const targetSystems = useMemo(
    () => systems.filter((s) => s.kind === 'TARGET'),
    [systems],
  );
  const peripheralSystems = useMemo(
    () => systems.filter((s) => s.kind !== 'TARGET'),
    [systems],
  );

  const currentSystemId = systemId === '' ? null : systemId;

  // (stakeholderId, systemId) → AdoptionStatus
  const adoptionByKey = useMemo(() => {
    const map = new Map<string, AdoptionStatus>();
    for (const a of adoptions)
      map.set(adoptionKey(a.stakeholderId, a.systemId), a);
    return map;
  }, [adoptions]);

  // 名前列に出す担当領域名（stakeholderId → 領域名リスト）
  const domainNamesByStakeholder = useMemo(() => {
    const domainById = new Map(domains.map((d) => [d.id, d.name]));
    const map = new Map<string, string[]>();
    for (const a of assignments) {
      const name = domainById.get(a.subProjectId);
      if (!name) continue;
      const arr = map.get(a.stakeholderId) ?? [];
      if (!arr.includes(name)) arr.push(name);
      map.set(a.stakeholderId, arr);
    }
    return map;
  }, [assignments, domains]);

  // 側フィルタのみ適用した母集団（ファネル集計はこの母数で出す）
  const sideFiltered = useMemo(
    () =>
      stakeholders.filter(
        (s) => !sideFilter || normalizeSide(s.side) === sideFilter,
      ),
    [stakeholders, sideFilter],
  );

  // その人の現在の段階（記録が無ければ未着手）
  const stageOf = useCallback(
    (stakeholderId: string): AdoptionStage =>
      normalizeAdoptionStage(
        adoptionByKey.get(adoptionKey(stakeholderId, currentSystemId))?.stage,
      ),
    [adoptionByKey, currentSystemId],
  );

  // ファネル集計（6段階の件数）
  const stageCounts = useMemo(() => {
    const counts = new Map<AdoptionStage, number>(
      ADOPTION_STAGES.map((s) => [s.key, 0]),
    );
    for (const s of sideFiltered) {
      const st = stageOf(s.id);
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    return counts;
  }, [sideFiltered, stageOf]);

  // 表に出す行（段階フィルタも適用）
  const rows = useMemo(
    () => sideFiltered.filter((s) => !stageFilter || stageOf(s.id) === stageFilter),
    [sideFiltered, stageFilter, stageOf],
  );

  // ヘッダクリックソート（表示値で比較。解除時は元の並びに戻る）
  const sortAccessors = useMemo(() => {
    const adoptionOf = (stakeholderId: string) =>
      adoptionByKey.get(adoptionKey(stakeholderId, currentSystemId));
    return {
      name: (s: Stakeholder) => s.name,
      stage: (s: Stakeholder) => stageOrder.get(stageOf(s.id)) ?? 0,
      lastContactAt: (s: Stakeholder) =>
        toDateInput(adoptionOf(s.id)?.lastContactAt),
      blockers: (s: Stakeholder) => adoptionOf(s.id)?.blockers ?? '',
      nextAction: (s: Stakeholder) => adoptionOf(s.id)?.nextAction ?? '',
    };
  }, [adoptionByKey, currentSystemId, stageOf]);
  const { sorted: sortedRows, sortKey, sortDir, toggleSort } = useTableSort(
    rows,
    sortAccessors,
  );

  // upsert 保存（楽観更新・失敗時は reload）
  const save = useCallback(
    async (stakeholderId: string, patch: RowPatch) => {
      const key = adoptionKey(stakeholderId, currentSystemId);
      setAdoptions((prev) => {
        const existing = prev.find(
          (a) => adoptionKey(a.stakeholderId, a.systemId) === key,
        );
        if (existing) {
          return prev.map((a) => (a === existing ? { ...a, ...patch } : a));
        }
        // 記録が無い人（未着手扱い）への初回入力は仮レコードで楽観表示
        const temp: AdoptionStatus = {
          id: `temp-${key}`,
          projectId,
          stakeholderId,
          systemId: currentSystemId,
          stage: 'NOT_STARTED',
          blockers: null,
          nextAction: null,
          note: null,
          lastContactAt: null,
          order: 0,
          ...patch,
        };
        return [...prev, temp];
      });
      setError(null);
      try {
        const saved = await adoptionApi.upsert(projectId, {
          stakeholderId,
          systemId: currentSystemId,
          ...patch,
        });
        setAdoptions((prev) =>
          prev.map((a) =>
            adoptionKey(a.stakeholderId, a.systemId) === key ? saved : a,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : '導入状況の保存に失敗しました');
        await reload();
      }
    },
    [projectId, currentSystemId, reload],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[240px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const total = sideFiltered.length;

  return (
    <div className="space-y-4">
      {/* 説明 + フィルタ（対象システム / 側） */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm text-gray-500">
          <Rocket className="h-4 w-4 text-emerald-600" />
          システムごとに、誰がどこまで使えているか（定着度）を追跡します。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* 側フィルタ */}
          <div className="flex gap-1">
            {([['', '全員'], ['EXTERNAL', sideMeta.EXTERNAL.short], ['INTERNAL', sideMeta.INTERNAL.short]] as [Side | '', string][]).map(
              ([value, label]) => (
                <button
                  key={value || 'all'}
                  type="button"
                  onClick={() => setSideFilter(value)}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                    sideFilter === value
                      ? value === ''
                        ? 'border-gray-400 bg-gray-100 text-gray-800'
                        : sideMeta[value as Side].chip
                      : 'border-gray-200 bg-white text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          {/* 対象システム select（'' = 全体 = systemId null） */}
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
            対象システム
            <select
              value={systemId}
              onChange={(e) => setSystemId(e.target.value)}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-700 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">全体（プロジェクト共通）</option>
              {targetSystems.length > 0 && (
                <optgroup label="対象システム">
                  {targetSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {peripheralSystems.length > 0 && (
                <optgroup label="周辺システム">
                  {peripheralSystems.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* 段階ファネル集計（クリックで絞り込み） */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ADOPTION_STAGES.map((st) => {
          const count = stageCounts.get(st.key) ?? 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const active = stageFilter === st.key;
          return (
            <button
              key={st.key}
              type="button"
              onClick={() => setStageFilter(active ? null : st.key)}
              className={`rounded-lg border p-2.5 text-left transition-colors ${
                active
                  ? 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-300'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
              title={`${st.label}: ${count} 名（クリックでこの段階に絞り込み）`}
            >
              <span
                className={`inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${st.badge}`}
              >
                {st.label}
              </span>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-lg font-bold text-[#050f3e]">{count}</span>
                <span className="text-[10px] text-gray-400">名 / {pct}%</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                <div className={`h-full ${st.bar}`} style={{ width: `${pct}%` }} />
              </div>
            </button>
          );
        })}
      </div>

      {/* 段階フィルタ中の表示 */}
      {stageFilter && (
        <button
          type="button"
          onClick={() => setStageFilter(null)}
          className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
        >
          絞り込み中: {adoptionStageMeta[stageFilter].label}
          <X className="h-3 w-3" />
        </button>
      )}

      {/* 一覧表（行 = ステークホルダー全員。記録が無い人は未着手扱い） */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <SortableTh
                    label="名前"
                    sortKey="name"
                    current={sortKey}
                    dir={sortDir}
                    onToggle={toggleSort}
                    className="min-w-[160px] text-left text-xs font-semibold text-gray-600"
                  />
                  <SortableTh
                    label="段階"
                    sortKey="stage"
                    current={sortKey}
                    dir={sortDir}
                    onToggle={toggleSort}
                    className="min-w-[140px] text-left text-xs font-semibold text-gray-600"
                  />
                  <SortableTh
                    label="最終接触日"
                    sortKey="lastContactAt"
                    current={sortKey}
                    dir={sortDir}
                    onToggle={toggleSort}
                    className="min-w-[130px] text-left text-xs font-semibold text-gray-600"
                  />
                  <SortableTh
                    label="阻害要因"
                    sortKey="blockers"
                    current={sortKey}
                    dir={sortDir}
                    onToggle={toggleSort}
                    className="min-w-[180px] text-left text-xs font-semibold text-gray-600"
                  />
                  <SortableTh
                    label="次アクション"
                    sortKey="nextAction"
                    current={sortKey}
                    dir={sortDir}
                    onToggle={toggleSort}
                    className="min-w-[180px] text-left text-xs font-semibold text-gray-600"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((s) => (
                  <AdoptionRow
                    // システム切替でドラフトをリセットするため key に含める
                    key={adoptionKey(s.id, currentSystemId)}
                    stakeholder={s}
                    domainNames={domainNamesByStakeholder.get(s.id) ?? []}
                    adoption={adoptionByKey.get(
                      adoptionKey(s.id, currentSystemId),
                    )}
                    onSave={(patch) => void save(s.id, patch)}
                  />
                ))}
                {sortedRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-10 text-center text-sm text-gray-400"
                    >
                      {stakeholders.length === 0
                        ? 'ステークホルダーがいません。「ステークホルダー」タブから追加してください。'
                        : '条件に一致するステークホルダーがいません（フィルタを解除してください）。'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** 1 行。段階・最終接触日は変更で即 upsert、テキストは onBlur で upsert。 */
function AdoptionRow({
  stakeholder,
  domainNames,
  adoption,
  onSave,
}: {
  stakeholder: Stakeholder;
  domainNames: string[];
  adoption: AdoptionStatus | undefined;
  onSave: (patch: RowPatch) => void;
}) {
  const side = normalizeSide(stakeholder.side);
  const stage = normalizeAdoptionStage(adoption?.stage);

  const serverBlockers = adoption?.blockers ?? '';
  const serverNextAction = adoption?.nextAction ?? '';
  const serverLastContact = toDateInput(adoption?.lastContactAt);

  const [blockers, setBlockers] = useState(serverBlockers);
  const [nextAction, setNextAction] = useState(serverNextAction);
  const [lastContact, setLastContact] = useState(serverLastContact);

  // サーバ値の変化にフィールド単位でドラフトを追従させる。
  // 編集中（フォーカス中）のフィールドだけは触らない:
  // - 初回保存で temp→実 ID に差し替わっても、入力中の別フィールドが消えない
  // - 保存失敗 → reload 時は、編集中でないドラフトがサーバ値どおりに戻る
  //   （stage select の revert 挙動と一貫させる）
  const [focusedField, setFocusedField] = useState<
    'blockers' | 'nextAction' | null
  >(null);
  useEffect(() => {
    if (focusedField !== 'blockers') setBlockers(serverBlockers);
  }, [serverBlockers, focusedField]);
  useEffect(() => {
    if (focusedField !== 'nextAction') setNextAction(serverNextAction);
  }, [serverNextAction, focusedField]);
  useEffect(() => {
    setLastContact(serverLastContact);
  }, [serverLastContact]);

  const saveBlockers = () => {
    const v = blockers.trim();
    if (v === serverBlockers) return;
    onSave({ blockers: v === '' ? null : v });
  };

  const saveNextAction = () => {
    const v = nextAction.trim();
    if (v === serverNextAction) return;
    onSave({ nextAction: v === '' ? null : v });
  };

  return (
    <tr className="border-b border-gray-100 align-top hover:bg-gray-50/40">
      {/* 名前（側バッジ・領域） */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-[#050f3e]">
            {stakeholder.name || '（無名）'}
          </span>
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${sideMeta[side].badge}`}
          >
            {sideMeta[side].short}
          </span>
        </div>
        {stakeholder.affiliation && (
          <p className="mt-0.5 text-[11px] text-gray-400">
            {stakeholder.affiliation}
          </p>
        )}
        {domainNames.length > 0 && (
          <div className="mt-1 flex max-w-[220px] flex-wrap gap-1">
            {domainNames.map((name) => (
              <span
                key={name}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </td>

      {/* 段階（色付き select。変更で即 upsert） */}
      <td className="px-3 py-2">
        <select
          value={stage}
          onChange={(e) =>
            onSave({ stage: e.target.value as AdoptionStage })
          }
          className={`w-full rounded-md border px-2 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-400 ${adoptionStageMeta[stage].badge}`}
          aria-label={`${stakeholder.name || '（無名）'} の段階`}
        >
          {ADOPTION_STAGES.map((st) => (
            <option key={st.key} value={st.key}>
              {st.label}
            </option>
          ))}
        </select>
      </td>

      {/* 最終接触日（変更で即 upsert） */}
      <td className="px-3 py-2">
        <input
          type="date"
          value={lastContact}
          onChange={(e) => {
            setLastContact(e.target.value);
            onSave({ lastContactAt: e.target.value || null });
          }}
          className="w-full rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label={`${stakeholder.name || '（無名）'} の最終接触日`}
        />
      </td>

      {/* 阻害要因（onBlur で upsert） */}
      <td className="px-3 py-2">
        <textarea
          value={blockers}
          onChange={(e) => setBlockers(e.target.value)}
          onFocus={() => setFocusedField('blockers')}
          onBlur={() => {
            saveBlockers();
            setFocusedField(null);
          }}
          rows={2}
          placeholder="阻害要因"
          className="w-full resize-y rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label={`${stakeholder.name || '（無名）'} の阻害要因`}
        />
      </td>

      {/* 次アクション（onBlur で upsert） */}
      <td className="px-3 py-2">
        <textarea
          value={nextAction}
          onChange={(e) => setNextAction(e.target.value)}
          onFocus={() => setFocusedField('nextAction')}
          onBlur={() => {
            saveNextAction();
            setFocusedField(null);
          }}
          rows={2}
          placeholder="次アクション"
          className="w-full resize-y rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          aria-label={`${stakeholder.name || '（無名）'} の次アクション`}
        />
      </td>
    </tr>
  );
}
