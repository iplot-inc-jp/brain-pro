'use client';

/**
 * AI作成（KPI）ページの共通表示部品。
 * KPIカテゴリ/ステータスのバッジ、SMARTチップ、方向アイコン、達成率の計算など。
 */

import { TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';
import {
  KPI_CATEGORY_LABELS,
  KPI_DIRECTION_LABELS,
  KPI_STATUS_LABELS,
  type KpiCategory,
  type KpiDirection,
  type KpiDto,
  type KpiStatus,
} from '@/lib/kpis';
import { INFORMATION_CATEGORY_LABELS, type InformationCategory } from '@/lib/dfd';

/** KPI区分バッジ（業務=blue / AI精度=violet）。 */
export function KpiCategoryBadge({ category }: { category: KpiCategory }) {
  const styles: Record<KpiCategory, string> = {
    BUSINESS: 'border-blue-200 bg-blue-50 text-blue-700',
    AI_QUALITY: 'border-violet-200 bg-violet-50 text-violet-700',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles[category]}`}
    >
      {KPI_CATEGORY_LABELS[category]}
    </span>
  );
}

/** ステータスバッジ（下書き=amber / 運用中=emerald / アーカイブ=gray）。 */
export function KpiStatusBadge({ status }: { status: KpiStatus }) {
  const styles: Record<KpiStatus, string> = {
    DRAFT: 'border-amber-300 bg-amber-50 text-amber-700',
    ACTIVE: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    ARCHIVED: 'border-gray-300 bg-gray-100 text-gray-500',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles[status]}`}
    >
      {KPI_STATUS_LABELS[status]}
    </span>
  );
}

/** AI生成チップ。 */
export function AiGeneratedChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-600">
      <Sparkles className="h-3 w-3" />
      AI生成
    </span>
  );
}

/** 望ましい方向アイコン（増やす=↑emerald / 減らす=↓blue / 維持=−gray）。 */
export function DirectionIcon({ direction }: { direction: KpiDirection }) {
  const title = KPI_DIRECTION_LABELS[direction];
  if (direction === 'INCREASE') {
    return <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-label={title} />;
  }
  if (direction === 'DECREASE') {
    return <TrendingDown className="h-3.5 w-3.5 text-blue-600" aria-label={title} />;
  }
  return <Minus className="h-3.5 w-3.5 text-gray-500" aria-label={title} />;
}

const SMART_AXES: ReadonlyArray<{
  key: keyof Pick<
    KpiDto,
    'smartSpecific' | 'smartMeasurable' | 'smartAchievable' | 'smartRelevant' | 'smartTimeBound'
  >;
  letter: string;
  label: string;
}> = [
  { key: 'smartSpecific', letter: 'S', label: '具体的（Specific）' },
  { key: 'smartMeasurable', letter: 'M', label: '測定可能（Measurable）' },
  { key: 'smartAchievable', letter: 'A', label: '達成可能（Achievable）' },
  { key: 'smartRelevant', letter: 'R', label: '関連性（Relevant）' },
  { key: 'smartTimeBound', letter: 'T', label: '期限（Time-bound）' },
];

/** SMART合計（全軸 null のときは null）。 */
export function smartTotal(kpi: KpiDto): number | null {
  const values = SMART_AXES.map((a) => kpi[a.key]);
  if (values.every((v) => v == null)) return null;
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

/**
 * SMART 5軸チップ。ホバー（title）で軸名・点数・講評を表示する。
 * 4点以上=emerald / 3点=amber / 2点以下=red / 未採点=gray。
 */
export function SmartChips({ kpi }: { kpi: KpiDto }) {
  const total = smartTotal(kpi);
  if (total == null) {
    return <span className="text-[10px] text-gray-400">SMART未採点</span>;
  }
  return (
    <span className="inline-flex items-center gap-0.5">
      {SMART_AXES.map((axis) => {
        const value = kpi[axis.key];
        const tone =
          value == null
            ? 'border-gray-200 bg-gray-50 text-gray-400'
            : value >= 4
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : value >= 3
                ? 'border-amber-200 bg-amber-50 text-amber-700'
                : 'border-red-200 bg-red-50 text-red-700';
        const title = `${axis.label}: ${value ?? '-'} / 5${kpi.smartComment ? `\n講評: ${kpi.smartComment}` : ''}`;
        return (
          <span
            key={axis.key}
            title={title}
            className={`inline-flex cursor-default items-center rounded border px-1 py-0.5 text-[10px] font-medium tabular-nums ${tone}`}
          >
            {axis.letter}
            {value ?? '-'}
          </span>
        );
      })}
      <span
        className="ml-0.5 cursor-default text-[10px] font-medium text-gray-500 tabular-nums"
        title={kpi.smartComment ? `講評: ${kpi.smartComment}` : undefined}
      >
        {total}/25
      </span>
    </span>
  );
}

/**
 * 達成率（%）。baseline→target の間で current がどこまで進んだか。
 * baseline が無い場合は 目標に対する現在値の比率で代替（減らす指標は 目標/現在）。
 * 計算できなければ null。
 */
export function achievementRate(kpi: KpiDto): number | null {
  const b = kpi.baselineValue;
  const t = kpi.targetValue;
  const c = kpi.currentValue;
  if (t == null || c == null) return null;
  let rate: number;
  if (b != null && t !== b) {
    rate = ((c - b) / (t - b)) * 100;
  } else if (kpi.direction === 'DECREASE') {
    if (c === 0) return 100;
    rate = (t / c) * 100;
  } else {
    if (t === 0) return null;
    rate = (c / t) * 100;
  }
  if (!Number.isFinite(rate)) return null;
  return Math.max(0, Math.min(100, Math.round(rate)));
}

/** 数値の表示（null は「-」）。 */
export function formatValue(v: number | null): string {
  if (v == null) return '-';
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/** INPUT/OUTPUT 分類バッジ（情報/物体/帳票）。io-types ページと同じ配色。 */
export function IoCategoryBadge({ category }: { category: string }) {
  const cat = normalizeIoCategory(category);
  const styles: Record<InformationCategory, string> = {
    INFORMATION: 'border-blue-200 bg-blue-50 text-blue-700',
    OBJECT: 'border-amber-200 bg-amber-50 text-amber-700',
    DOCUMENT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${styles[cat]}`}
    >
      {INFORMATION_CATEGORY_LABELS[cat]}
    </span>
  );
}

/** 不明な分類値は「情報」に寄せて扱う（io-summary の category は string）。 */
export function normalizeIoCategory(category: string): InformationCategory {
  if (category === 'DOCUMENT' || category === 'OBJECT') return category;
  return 'INFORMATION';
}
