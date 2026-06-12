'use client';

/**
 * KPI一覧（タブ共通・ページ下部）。
 *
 * カテゴリフィルタ（全部/業務/AI精度）付きのカードリスト。
 * 各カード: 名称・定義・単位・SMART 5軸チップ（ホバーで講評）・
 * baseline→current→target と達成率バー・方向アイコン・頻度・責任者ロール・
 * 対象（フロー/システム）chip・測定対象IO chips・ステータスバッジ。
 * DRAFT は「採用」で ACTIVE 化。アーカイブ・削除・クリックで編集モーダル。
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  GitBranch,
  Loader2,
  Server,
  Target,
  Trash2,
  UserRound,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { InformationType } from '@/lib/dfd';
import type { SystemMaster } from '@/lib/masters';
import {
  kpiApi,
  KPI_FREQUENCY_LABELS,
  type KpiCategory,
  type KpiDto,
} from '@/lib/kpis';
import type { BusinessFlowItem, RoleItem } from './types';
import {
  achievementRate,
  AiGeneratedChip,
  DirectionIcon,
  formatValue,
  IoCategoryBadge,
  KpiCategoryBadge,
  KpiStatusBadge,
  SmartChips,
} from './kpi-format';
import { KpiEditModal } from './kpi-edit-modal';

type CategoryFilter = 'ALL' | KpiCategory;

const FILTERS: ReadonlyArray<{ value: CategoryFilter; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'BUSINESS', label: '業務KPI' },
  { value: 'AI_QUALITY', label: 'AI精度KPI' },
];

export function KpiList({
  kpis,
  loading,
  error,
  highlightIds,
  flows,
  systems,
  roles,
  informationTypes,
  onChanged,
}: {
  kpis: KpiDto[];
  loading: boolean;
  error: string | null;
  /** 直前にAI生成/プリセット追加されたKPI（ハイライト表示） */
  highlightIds: Set<string>;
  flows: BusinessFlowItem[];
  systems: SystemMaster[];
  roles: RoleItem[];
  informationTypes: InformationType[];
  onChanged: () => Promise<void> | void;
}) {
  const [filter, setFilter] = useState<CategoryFilter>('ALL');
  const [editing, setEditing] = useState<KpiDto | null>(null);
  // 採用/アーカイブ/削除の実行中KPI ID
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const filtered = useMemo(
    () => (filter === 'ALL' ? kpis : kpis.filter((k) => k.category === filter)),
    [kpis, filter],
  );

  const counts = useMemo(() => {
    const business = kpis.filter((k) => k.category === 'BUSINESS').length;
    return { ALL: kpis.length, BUSINESS: business, AI_QUALITY: kpis.length - business };
  }, [kpis]);

  const runAction = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setBusyId(id);
      setActionError(null);
      try {
        await action();
        await onChanged();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : '操作に失敗しました');
      } finally {
        setBusyId(null);
      }
    },
    [onChanged],
  );

  const handleAdopt = useCallback(
    (kpi: KpiDto) => runAction(kpi.id, () => kpiApi.update(kpi.id, { status: 'ACTIVE' })),
    [runAction],
  );
  const handleArchive = useCallback(
    (kpi: KpiDto) => runAction(kpi.id, () => kpiApi.update(kpi.id, { status: 'ARCHIVED' })),
    [runAction],
  );
  const handleRestore = useCallback(
    (kpi: KpiDto) => runAction(kpi.id, () => kpiApi.update(kpi.id, { status: 'DRAFT' })),
    [runAction],
  );
  const handleDelete = useCallback(
    (kpi: KpiDto) => {
      if (!confirm(`KPI「${kpi.name}」を削除しますか？`)) return;
      void runAction(kpi.id, () => kpiApi.delete(kpi.id));
    },
    [runAction],
  );

  return (
    <Card className="bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <Target className="h-4 w-4 text-blue-600" />
        <h2 className="text-sm font-semibold text-gray-800">KPI一覧</h2>
        <span className="text-xs text-gray-400">クリックで編集。下書きは「採用」で運用開始。</span>
        {/* カテゴリフィルタ */}
        <div className="ml-auto flex items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                filter === f.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              }`}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[f.value]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2 p-4">
        {actionError && <p className="text-xs text-red-600">{actionError}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          </div>
        ) : error ? (
          <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {kpis.length === 0
              ? 'KPIがまだありません。上のタブからAI生成またはプリセット追加してください。'
              : 'この区分のKPIはありません。'}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((kpi) => (
              <KpiCard
                key={kpi.id}
                kpi={kpi}
                highlighted={highlightIds.has(kpi.id)}
                busy={busyId === kpi.id}
                onClick={() => setEditing(kpi)}
                onAdopt={() => void handleAdopt(kpi)}
                onArchive={() => void handleArchive(kpi)}
                onRestore={() => void handleRestore(kpi)}
                onDelete={() => handleDelete(kpi)}
              />
            ))}
          </ul>
        )}
      </div>

      {editing && (
        <KpiEditModal
          kpi={editing}
          flows={flows}
          systems={systems}
          roles={roles}
          informationTypes={informationTypes}
          onClose={() => setEditing(null)}
          onSaved={onChanged}
        />
      )}
    </Card>
  );
}

function KpiCard({
  kpi,
  highlighted,
  busy,
  onClick,
  onAdopt,
  onArchive,
  onRestore,
  onDelete,
}: {
  kpi: KpiDto;
  highlighted: boolean;
  busy: boolean;
  onClick: () => void;
  onAdopt: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const rate = achievementRate(kpi);

  return (
    <li
      onClick={onClick}
      className={`cursor-pointer rounded border bg-white px-3 py-2.5 transition-shadow hover:shadow-sm ${
        highlighted ? 'border-violet-300 ring-2 ring-violet-200' : 'border-gray-200'
      } ${kpi.status === 'ARCHIVED' ? 'opacity-60' : ''}`}
    >
      {/* 1行目: バッジ・名称・方向・頻度・操作 */}
      <div className="flex items-center gap-2">
        <KpiStatusBadge status={kpi.status} />
        <KpiCategoryBadge category={kpi.category} />
        {kpi.aiGenerated && <AiGeneratedChip />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800" title={kpi.name}>
          {kpi.name}
        </span>
        <span
          className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500"
          title={`測定頻度: ${KPI_FREQUENCY_LABELS[kpi.frequency]}`}
        >
          <DirectionIcon direction={kpi.direction} />
          {KPI_FREQUENCY_LABELS[kpi.frequency]}
        </span>
        {kpi.ownerRoleName && (
          <span
            className="flex shrink-0 items-center gap-0.5 text-[11px] text-gray-500"
            title={`責任者ロール: ${kpi.ownerRoleName}`}
          >
            <UserRound className="h-3 w-3" />
            {kpi.ownerRoleName}
          </span>
        )}
        {/* 操作（カードクリックへ波及させない） */}
        <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
          {kpi.status === 'DRAFT' && (
            <button
              type="button"
              onClick={onAdopt}
              disabled={busy}
              className="inline-flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              title="この下書きを採用して運用中にする"
            >
              <CheckCircle2 className="h-3 w-3" />
              採用
            </button>
          )}
          {kpi.status === 'ARCHIVED' ? (
            <button
              type="button"
              onClick={onRestore}
              disabled={busy}
              className="text-gray-400 hover:text-emerald-600 disabled:opacity-40"
              title="下書きに戻す"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onArchive}
              disabled={busy}
              className="text-gray-400 hover:text-amber-600 disabled:opacity-40"
              title="アーカイブする"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-gray-400 hover:text-red-600 disabled:opacity-40"
            title="削除"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {/* 2行目: 定義・単位 */}
      {(kpi.definition || kpi.description) && (
        <p className="mt-1 truncate text-xs text-gray-500" title={kpi.definition ?? kpi.description ?? ''}>
          {kpi.definition ?? kpi.description}
          {kpi.unit ? `（単位: ${kpi.unit}）` : ''}
        </p>
      )}

      {/* 3行目: SMART・値・達成率バー */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <SmartChips kpi={kpi} />
        <span className="text-[11px] text-gray-600 tabular-nums">
          基準 {formatValue(kpi.baselineValue)} → 現在{' '}
          <span className="font-medium text-gray-800">{formatValue(kpi.currentValue)}</span> → 目標{' '}
          {formatValue(kpi.targetValue)}
          {kpi.unit ? ` ${kpi.unit}` : ''}
        </span>
        {rate != null && (
          <span className="flex items-center gap-1.5" title={`達成率 ${rate}%`}>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
              <span
                className={`block h-full rounded-full ${
                  rate >= 100 ? 'bg-emerald-500' : rate >= 50 ? 'bg-blue-500' : 'bg-amber-400'
                }`}
                style={{ width: `${rate}%` }}
              />
            </span>
            <span className="text-[11px] text-gray-500 tabular-nums">{rate}%</span>
          </span>
        )}
      </div>

      {/* 4行目: 対象（フロー/システム）・測定対象IO */}
      {(kpi.flowName || kpi.systemName || kpi.informationTypes.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {kpi.flowName && (
            <span className="inline-flex items-center gap-0.5 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
              <GitBranch className="h-2.5 w-2.5" />
              {kpi.flowName}
            </span>
          )}
          {kpi.systemName && (
            <span className="inline-flex items-center gap-0.5 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
              <Server className="h-2.5 w-2.5" />
              {kpi.systemName}
            </span>
          )}
          {kpi.informationTypes.map((it) => (
            <span key={it.id} className="inline-flex items-center gap-1">
              <IoCategoryBadge category={it.category} />
              <span className="text-[10px] text-gray-600">{it.name}</span>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
