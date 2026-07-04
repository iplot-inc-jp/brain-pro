'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles,
  Loader2,
  Gauge,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  CircleDot,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import {
  getReadiness,
  analyzeReadiness,
  type ReadinessReport,
  type ReadinessAnalysis,
  type ReadinessSection,
} from '@/lib/readiness';

/** セクション状態ごとの見た目（未着手=灰 / 着手=琥珀 / 充実=翠）。 */
const STATUS_META: Record<
  ReadinessSection['status'],
  { label: string; chip: string; Icon: typeof CheckCircle2 }
> = {
  empty: {
    label: '未着手',
    chip: 'border-gray-200 bg-gray-50 text-gray-400',
    Icon: CircleDashed,
  },
  started: {
    label: '着手',
    chip: 'border-amber-200 bg-amber-50 text-amber-700',
    Icon: CircleDot,
  },
  rich: {
    label: '充実',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    Icon: CheckCircle2,
  },
};

/** 充実率に応じたバーの色。 */
function barColor(percent: number): string {
  if (percent >= 70) return 'bg-emerald-500';
  if (percent >= 30) return 'bg-amber-400';
  return 'bg-gray-300';
}

export function ReadinessBoard({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [analysis, setAnalysis] = useState<ReadinessAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getReadiness(projectId)
      .then((r) => {
        if (alive) setReport(r);
      })
      .catch(() => {
        if (alive) setError('充実度の取得に失敗しました');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const runAnalyze = useCallback(async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const a = await analyzeReadiness(projectId);
      setAnalysis(a);
    } catch (err) {
      setAnalyzeError(
        err instanceof Error ? err.message : 'AI分析に失敗しました',
      );
    } finally {
      setAnalyzing(false);
    }
  }, [projectId]);

  if (loading) {
    return (
      <Card className="flex items-center justify-center border-gray-200 bg-white py-10">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
      </Card>
    );
  }

  if (error || !report) {
    return (
      <Card className="border-gray-200 bg-white p-5 text-sm text-gray-500">
        {error ?? '充実度を表示できません'}
      </Card>
    );
  }

  return (
    <Card className="border-gray-200 bg-white p-5">
      {/* ヘッダー: 全体充実度（定量）＋ LLM分析ボタン */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-800">
              設定の充実度
            </h2>
            <HelpTooltip text="各方法論エリア（背景→現状把握→課題→設計→推進）に何件データが登録されているかから、プロジェクトの充実度を自動集計しています。未着手のエリアが「今 設定すべきこと」の目安になります。右の『LLMで分析させる』で、優先順位や抜け漏れをAI(Haiku)が講評します。" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-gray-900">
              {report.overallPercent}
            </span>
            <span className="text-sm text-gray-400">%</span>
            <span className="ml-2 text-xs text-gray-400">
              {report.completedSections} / {report.totalSections} エリア着手
            </span>
          </div>
        </div>
        <Button
          type="button"
          onClick={runAnalyze}
          disabled={analyzing}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700"
        >
          {analyzing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          LLMで分析させる
        </Button>
      </div>

      {/* 全体バー */}
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all ${barColor(report.overallPercent)}`}
          style={{ width: `${report.overallPercent}%` }}
        />
      </div>

      {/* AI分析結果 */}
      {analyzeError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
          {analyzeError}
        </p>
      )}
      {analysis && (
        <div className="mt-4 rounded-lg border border-violet-200 bg-violet-50/50 p-4">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-4 w-4 text-violet-600" />
            <span className="text-sm font-semibold text-violet-900">
              AI診断
            </span>
          </div>
          {analysis.headline && (
            <p className="mt-1.5 text-sm font-medium text-gray-800">
              {analysis.headline}
            </p>
          )}
          {analysis.priorities.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-gray-500">
                優先して着手すべきこと
              </p>
              <ol className="space-y-2">
                {analysis.priorities.map((p, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium text-gray-800">
                        {p.title}
                      </span>
                      {p.detail && (
                        <span className="text-gray-500"> — {p.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {analysis.watchouts.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-gray-500">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                抜け漏れ・リスク
              </p>
              <ul className="space-y-1">
                {analysis.watchouts.map((w, i) => (
                  <li key={i} className="text-sm text-gray-600">
                    ・{w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* グループ別の充実度（定量） */}
      <div className="mt-5 space-y-4">
        {report.groups.map((g) => (
          <div key={g.key}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-700">
                {g.label}
              </span>
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${barColor(g.percent)}`}
                  style={{ width: `${g.percent}%` }}
                />
              </div>
              <span className="text-[11px] text-gray-400">{g.percent}%</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {g.sections.map((s) => {
                const meta = STATUS_META[s.status];
                const Icon = meta.Icon;
                return (
                  <span
                    key={s.key}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}
                    title={`${s.label}: ${s.count}件（目安 ${s.target}／${meta.label}）`}
                  >
                    <Icon className="h-3 w-3" />
                    {s.label}
                    <span className="font-semibold">{s.count}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 flex items-center gap-1 text-[11px] text-gray-400">
        <ArrowRight className="h-3 w-3" />
        各エリアはサイドメニューから開いて設定できます。未着手（灰）から着手していきましょう。
      </p>
    </Card>
  );
}
