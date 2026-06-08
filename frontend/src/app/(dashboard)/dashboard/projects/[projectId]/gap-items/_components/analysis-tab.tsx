'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import {
  Trash2,
  Loader2,
  Plus,
  BarChart3,
  Gauge,
  GitCompareArrows,
  Filter as FunnelIcon,
} from 'lucide-react';
import { createGapItem } from '../_lib/use-record-sheet';
import { useAnalysisSheet } from '../_lib/use-analysis-sheet';
import { SheetToolbar } from './sheet-toolbar';

const yen = (n: number) =>
  n.toLocaleString('ja-JP', { maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toFixed(1)}%`;
const numVal = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** 分析結果の1行を打ち手（GAP item）として起票する小ボタン。 */
function AddAsActionButton({
  projectId,
  build,
  onDone,
}: {
  projectId: string;
  build: () => {
    businessArea: string;
    asisDescription?: string;
    tobeDescription?: string;
    gapDescription?: string;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50 whitespace-nowrap"
      disabled={busy || ok}
      onClick={async () => {
        setBusy(true);
        const success = await createGapItem(projectId, build());
        setBusy(false);
        if (success) {
          setOk(true);
          onDone?.();
        }
      }}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
      ) : (
        <Plus className="h-3.5 w-3.5 mr-1" />
      )}
      {ok ? '追加済み' : '打ち手として追加'}
    </Button>
  );
}

/* ──────────────────────────────────────────────────────────────
   1) 80/20 分析（パレート / ABCランク）
   金額降順 → 累積金額 → 累積シェア% → ABCランク（≤80%=A / ≤95%=B / >95%=C）
   上位約20%品目で約80%を占めるか＝パレート成立/不成立を文章表示。
   ────────────────────────────────────────────────────────────── */
type ParetoRow = { code: string; count: string; amount: string };

function ParetoTool({ projectId }: { projectId: string }) {
  const { rows, setRows, saving, savedAt, save, loading } =
    useAnalysisSheet<ParetoRow>(projectId, 'analysis-pareto', [
      { code: '', count: '', amount: '' },
    ]);

  const addRow = () =>
    setRows((p) => [...p, { code: '', count: '', amount: '' }]);
  const delRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  const set = (i: number, k: keyof ParetoRow, v: string) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));

  const ranked = useMemo(() => {
    const valid = rows
      .map((r) => ({ ...r, amt: numVal(r.amount) }))
      .filter((r) => r.code.trim() !== '' || r.amt !== 0);
    const total = valid.reduce((s, r) => s + r.amt, 0);
    const sorted = [...valid].sort((a, b) => b.amt - a.amt);
    let cum = 0;
    return {
      total,
      n: sorted.length,
      list: sorted.map((r, i) => {
        cum += r.amt;
        const cumShare = total > 0 ? (cum / total) * 100 : 0;
        const rank = cumShare <= 80 ? 'A' : cumShare <= 95 ? 'B' : 'C';
        return { ...r, idx: i, cum, cumShare, rank };
      }),
    };
  }, [rows]);

  // パレート判定: 上位約20%の品目で何%を占めるか
  const pareto = useMemo(() => {
    const n = ranked.n;
    if (n === 0) return null;
    const top20Count = Math.max(1, Math.round(n * 0.2));
    const topShare =
      ranked.list[top20Count - 1]?.cumShare ?? ranked.list[n - 1].cumShare;
    return {
      top20Count,
      topShare,
      holds: topShare >= 80,
    };
  }, [ranked]);

  const rankBadge: Record<string, string> = {
    A: 'text-emerald-700 bg-emerald-50 border-emerald-300',
    B: 'text-amber-700 bg-amber-50 border-amber-300',
    C: 'text-gray-600 bg-gray-50 border-gray-300',
  };

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              80/20 分析（パレート / ABCランク）
              <HelpTooltip text="品目を金額の大きい順に並べ、累積シェアで上位少数が全体の大半を占めるか（パレート）を判定。A=累積≤80%（主力）/B=≤95%/C=>95%（撤退候補）。" />
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              コード／件数（任意）／金額を入力 → 金額降順で累積シェア%とA/B/Cランクを自動計算。
            </p>
          </div>
          <SheetToolbar
            onAdd={addRow}
            onSave={save}
            saving={saving}
            savedAt={savedAt}
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            {/* 入力 */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="px-3 py-2 font-medium border-b border-gray-200">
                      商品コード／製品名
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200 w-[120px]">
                      件数（任意）
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200 w-[160px]">
                      合計金額（円）
                    </th>
                    <th className="w-10 border-b border-gray-200" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-2 py-1">
                        <Input
                          value={r.code}
                          onChange={(e) => set(i, 'code', e.target.value)}
                          placeholder="PRD-001"
                          className="h-8 bg-white border-gray-200"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={r.count}
                          onChange={(e) => set(i, 'count', e.target.value)}
                          placeholder="0"
                          className="h-8 bg-white border-gray-200 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          value={r.amount}
                          onChange={(e) => set(i, 'amount', e.target.value)}
                          placeholder="0"
                          className="h-8 bg-white border-gray-200 text-right"
                        />
                      </td>
                      <td className="px-1 text-center">
                        <button
                          onClick={() => delRow(i)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                          title="削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* パレート判定 */}
            {pareto && (
              <div
                className={`rounded-lg border p-3 text-sm ${
                  pareto.holds
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                上位約20%（{pareto.top20Count}/{ranked.n} 品目）で全体の{' '}
                <span className="font-bold">{pct(pareto.topShare)}</span> を占めます。
                {pareto.holds
                  ? '→ パレート成立（上位少数で大半を説明）。上位A群を主力として打ち手の対象に。'
                  : '→ パレート不成立（金額が分散）。撤退候補（C群）の整理も検討。'}{' '}
                合計 {yen(ranked.total)} 円。
              </div>
            )}

            {/* ランク結果 */}
            {ranked.n > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-600">
                      <th className="px-3 py-2 font-medium border-b border-gray-200">
                        順位
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200">
                        コード
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 text-right">
                        金額
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 text-right">
                        累積金額
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 text-right">
                        累積シェア
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200">
                        ランク
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 w-[160px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.list.map((r) => (
                      <tr
                        key={r.idx}
                        className={`border-b border-gray-100 ${
                          r.cumShare <= 80 ? 'bg-emerald-50/40' : ''
                        }`}
                      >
                        <td className="px-3 py-1.5 text-gray-500">{r.idx + 1}</td>
                        <td className="px-3 py-1.5 font-medium text-gray-900">
                          {r.code || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">{yen(r.amt)}</td>
                        <td className="px-3 py-1.5 text-right text-gray-500">
                          {yen(r.cum)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {pct(r.cumShare)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border font-semibold ${rankBadge[r.rank]}`}
                          >
                            {r.rank}
                            {r.rank === 'C' && (
                              <span className="font-normal">撤退候補</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <AddAsActionButton
                            projectId={projectId}
                            build={() => ({
                              businessArea: `${r.code || '品目'}（${r.rank}ランク）`,
                              asisDescription: `金額 ${yen(r.amt)}円・累積シェア ${pct(r.cumShare)}（${r.rank}ランク）`,
                              gapDescription:
                                r.rank === 'A'
                                  ? '主力品目。重点的に伸ばす/守る打ち手が必要。'
                                  : r.rank === 'C'
                                    ? '下位品目（撤退・整理候補）。'
                                    : '中位品目。要観察。',
                              priority:
                                r.rank === 'A'
                                  ? 'HIGH'
                                  : r.rank === 'C'
                                    ? 'LOW'
                                    : 'MEDIUM',
                            })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────
   2) 感度分析（インパクト÷難易度スコア）
   スコア = ★数 ÷ 難易度係数（高=4 / 中=2 / 低=1）→ 降順ソート。
   影響未確定（?）の行は『前提確定待ち』として除外可。
   ────────────────────────────────────────────────────────────── */
type SensRow = {
  measure: string;
  stars: string; // "1".."5" / "" = 未確定
  difficulty: 'HIGH' | 'MID' | 'LOW';
};
const DIFF_COEF: Record<SensRow['difficulty'], number> = { HIGH: 4, MID: 2, LOW: 1 };
const DIFF_LABEL: Record<SensRow['difficulty'], string> = {
  HIGH: '高 (×4)',
  MID: '中 (×2)',
  LOW: '低 (×1)',
};

function SensitivityTool({ projectId }: { projectId: string }) {
  const { rows, setRows, saving, savedAt, save, loading } =
    useAnalysisSheet<SensRow>(projectId, 'analysis-sensitivity', [
      { measure: '', stars: '3', difficulty: 'MID' },
    ]);

  const addRow = () =>
    setRows((p) => [...p, { measure: '', stars: '3', difficulty: 'MID' }]);
  const delRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<SensRow>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const scored = useMemo(() => {
    const withScore = rows
      .map((r, idx) => {
        const starCount = numVal(r.stars);
        const pending = !r.stars || starCount <= 0;
        const coef = DIFF_COEF[r.difficulty] ?? 2;
        const score = pending ? null : starCount / coef;
        return { ...r, idx, starCount, coef, score, pending };
      })
      .filter((r) => r.measure.trim() !== '' || r.stars !== '');
    const active = withScore
      .filter((r) => !r.pending)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const pendingRows = withScore.filter((r) => r.pending);
    return { active, pendingRows };
  }, [rows]);

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Gauge className="h-5 w-5 text-blue-600" />
              感度分析（インパクト ÷ 難易度スコア）
              <HelpTooltip text="スコア = 営業利益への影響★(1〜5) ÷ 難易度係数（高=4/中=2/低=1）。スコア降順で着手順を決める。『全部やる』を禁止し低難易度高効果から着手。" />
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              打ち手ごとに影響★と難易度を入力 → スコア=★÷係数を計算し降順に並べ替え。
            </p>
          </div>
          <SheetToolbar
            onAdd={addRow}
            onSave={save}
            saving={saving}
            savedAt={savedAt}
            addLabel="打ち手を追加"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="px-3 py-2 font-medium border-b border-gray-200">
                      打ち手
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200 w-[170px]">
                      営業利益への影響 ★
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200 w-[140px]">
                      実行難易度
                    </th>
                    <th className="w-10 border-b border-gray-200" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const stars = numVal(r.stars);
                    return (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-2 py-1">
                          <Input
                            value={r.measure}
                            onChange={(e) => set(i, { measure: e.target.value })}
                            placeholder="例: 緊急発注ゼロ化"
                            className="h-8 bg-white border-gray-200"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() =>
                                  set(i, { stars: String(s === stars ? 0 : s) })
                                }
                                className={`text-lg leading-none ${
                                  s <= stars ? 'text-amber-500' : 'text-gray-300'
                                }`}
                                title={`★${s}`}
                              >
                                ★
                              </button>
                            ))}
                            <span className="ml-1 text-xs text-gray-400">
                              {stars > 0 ? stars : '未確定'}
                            </span>
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <Select
                            value={r.difficulty}
                            onValueChange={(v) =>
                              set(i, { difficulty: v as SensRow['difficulty'] })
                            }
                          >
                            <SelectTrigger className="h-8 bg-white border-gray-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value="HIGH">{DIFF_LABEL.HIGH}</SelectItem>
                              <SelectItem value="MID">{DIFF_LABEL.MID}</SelectItem>
                              <SelectItem value="LOW">{DIFF_LABEL.LOW}</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 text-center">
                          <button
                            onClick={() => delRow(i)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-gray-400">
              難易度係数: 高=4 / 中=2 / 低=1。★だけ見ると最大インパクトが最優先に見えるが、難易度を加味すると低難易度の施策がスコア最高になりやすい。
            </p>

            {scored.active.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-600">
                      <th className="px-3 py-2 font-medium border-b border-gray-200">
                        優先
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200">
                        打ち手
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 text-right">
                        ★ ÷ 係数
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 text-right">
                        スコア
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 w-[160px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {scored.active.map((r, rank) => (
                      <tr
                        key={r.idx}
                        className={`border-b border-gray-100 ${rank === 0 ? 'bg-blue-50/40' : ''}`}
                      >
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                            {rank + 1}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-medium text-gray-900">
                          {r.measure || '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-gray-500">
                          {r.stars} ÷ {r.coef}
                        </td>
                        <td className="px-3 py-1.5 text-right font-bold text-blue-700">
                          {(r.score ?? 0).toFixed(2)}
                        </td>
                        <td className="px-3 py-1.5">
                          <AddAsActionButton
                            projectId={projectId}
                            build={() => ({
                              businessArea: r.measure || '打ち手',
                              tobeDescription: `感度スコア ${(r.score ?? 0).toFixed(2)}（影響★${r.stars} ÷ 難易度係数${r.coef}）。着手順${rank + 1}位。`,
                              priority:
                                rank === 0
                                  ? 'HIGH'
                                  : (r.score ?? 0) >= 1.5
                                    ? 'MEDIUM'
                                    : 'LOW',
                            })}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {scored.pendingRows.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                前提確定待ち（影響未確定で除外）:{' '}
                {scored.pendingRows.map((r) => r.measure || '無題').join(' / ')}
                <span className="text-gray-400">
                  {' '}
                  — 真因を確定してから★を評価してください。
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────
   3) ギャップ分析（自社−ベンチ + 要因分解）
   ギャップ = 自社 − ベンチ（マイナス=劣後）。要因ごとに寄与/シェア%/打ち手有無、
   ✗要因を除いた○要因の寄与合計 = 埋められるギャップ。
   ────────────────────────────────────────────────────────────── */
type GapRow = {
  metric: string;
  self: string;
  benchmark: string;
  factor: string;
  contribution: string;
  hasAction: 'YES' | 'NO';
};

function GapAnalysisTool({ projectId }: { projectId: string }) {
  const { rows, setRows, saving, savedAt, save, loading } =
    useAnalysisSheet<GapRow>(projectId, 'analysis-gap', [
      {
        metric: '',
        self: '',
        benchmark: '',
        factor: '',
        contribution: '',
        hasAction: 'YES',
      },
    ]);

  const addRow = () =>
    setRows((p) => [
      ...p,
      {
        metric: '',
        self: '',
        benchmark: '',
        factor: '',
        contribution: '',
        hasAction: 'YES',
      },
    ]);
  const delRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<GapRow>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const computed = useMemo(() => {
    const valid = rows.filter(
      (r) => r.metric.trim() !== '' || r.factor.trim() !== '',
    );
    const gapTotal = valid.reduce((s, r) => s + numVal(r.contribution), 0);
    const denom = Math.abs(gapTotal);
    return valid.map((r, idx) => {
      const gap = numVal(r.self) - numVal(r.benchmark);
      const contribution = numVal(r.contribution);
      const factorShare = denom > 0 ? (Math.abs(contribution) / denom) * 100 : 0;
      return { ...r, idx, gap, contribution, factorShare };
    });
  }, [rows]);

  const totals = useMemo(() => {
    const gapTotal = computed.reduce((s, r) => s + r.contribution, 0);
    const actionableTotal = computed
      .filter((r) => r.hasAction === 'YES')
      .reduce((s, r) => s + r.contribution, 0);
    return { gapTotal, actionableTotal };
  }, [computed]);

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <GitCompareArrows className="h-5 w-5 text-blue-600" />
              ギャップ分析（自社 − ベンチ + 要因分解）
              <HelpTooltip text="ギャップ=自社−ベンチマーク（マイナス=劣後）。要因に分解し寄与とシェア%を出す。✗（変えられない要因）を除いた○要因の寄与合計=実際に埋められるギャップ。" />
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              指標ごとに自社/ベンチを入力（ギャップ自動計算）。要因・寄与・打ち手有無で、埋められるギャップを集計。
            </p>
          </div>
          <SheetToolbar
            onAdd={addRow}
            onSave={save}
            saving={saving}
            savedAt={savedAt}
            addLabel="要因を追加"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="px-2 py-2 font-medium border-b border-gray-200">
                      指標 / 要因
                    </th>
                    <th className="px-2 py-2 font-medium border-b border-gray-200 w-[90px]">
                      自社
                    </th>
                    <th className="px-2 py-2 font-medium border-b border-gray-200 w-[90px]">
                      ベンチ
                    </th>
                    <th className="px-2 py-2 font-medium border-b border-gray-200 w-[80px] text-right">
                      ギャップ
                    </th>
                    <th className="px-2 py-2 font-medium border-b border-gray-200 w-[110px]">
                      寄与(pt/億)
                    </th>
                    <th className="px-2 py-2 font-medium border-b border-gray-200 w-[80px] text-right">
                      シェア
                    </th>
                    <th className="px-2 py-2 font-medium border-b border-gray-200 w-[110px]">
                      打ち手
                    </th>
                    <th className="w-8 border-b border-gray-200" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const c = computed.find((x) => x.idx === i);
                    const gap = numVal(r.self) - numVal(r.benchmark);
                    return (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="px-1.5 py-1">
                          <Input
                            value={r.metric}
                            onChange={(e) => set(i, { metric: e.target.value })}
                            placeholder="値上げ転嫁率 / 規模の差"
                            className="h-8 bg-white border-gray-200"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <Input
                            value={r.self}
                            onChange={(e) => set(i, { self: e.target.value })}
                            placeholder="39"
                            className="h-8 bg-white border-gray-200 text-right"
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <Input
                            value={r.benchmark}
                            onChange={(e) =>
                              set(i, { benchmark: e.target.value })
                            }
                            placeholder="68"
                            className="h-8 bg-white border-gray-200 text-right"
                          />
                        </td>
                        <td
                          className={`px-2 py-1 text-right font-semibold ${
                            gap < 0 ? 'text-red-600' : 'text-gray-700'
                          }`}
                        >
                          {numVal(r.self) === 0 && numVal(r.benchmark) === 0
                            ? '—'
                            : gap.toFixed(1)}
                        </td>
                        <td className="px-1.5 py-1">
                          <Input
                            value={r.contribution}
                            onChange={(e) =>
                              set(i, { contribution: e.target.value })
                            }
                            placeholder="-10"
                            className="h-8 bg-white border-gray-200 text-right"
                          />
                        </td>
                        <td className="px-2 py-1 text-right text-gray-500">
                          {c ? pct(c.factorShare) : '—'}
                        </td>
                        <td className="px-1.5 py-1">
                          <Select
                            value={r.hasAction}
                            onValueChange={(v) =>
                              set(i, { hasAction: v as GapRow['hasAction'] })
                            }
                          >
                            <SelectTrigger className="h-8 bg-white border-gray-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value="YES">○ あり</SelectItem>
                              <SelectItem value="NO">✗ なし</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 text-center">
                          <button
                            onClick={() => delRow(i)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {computed.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                  <p className="text-gray-500">要因寄与の合計（ギャップ合計）</p>
                  <p className="text-lg font-bold text-gray-800">
                    {totals.gapTotal.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <p className="text-emerald-700">
                    埋められるギャップ（○要因の寄与合計）
                  </p>
                  <p className="text-lg font-bold text-emerald-800">
                    {totals.actionableTotal.toFixed(1)}
                  </p>
                  <p className="text-xs text-emerald-700/70 mt-0.5">
                    ✗（変えられない要因）を除外。○要因を打ち手として展開。
                  </p>
                </div>
              </div>
            )}

            {/* 打ち手のある要因を起票 */}
            {computed.filter((r) => r.hasAction === 'YES').length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500">
                  打ち手のある要因 → GAP item へ
                </p>
                <div className="flex flex-wrap gap-2">
                  {computed
                    .filter((r) => r.hasAction === 'YES')
                    .map((r) => (
                      <div
                        key={r.idx}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5"
                      >
                        <span className="text-sm text-gray-700">
                          {r.factor || r.metric || '要因'}（寄与{' '}
                          {r.contribution.toFixed(1)} / {pct(r.factorShare)}）
                        </span>
                        <AddAsActionButton
                          projectId={projectId}
                          build={() => ({
                            businessArea: r.metric || r.factor || '要因',
                            asisDescription: `自社 ${r.self || '—'} / ベンチ ${r.benchmark || '—'}（ギャップ ${r.gap.toFixed(1)}）`,
                            gapDescription: `要因「${r.factor || r.metric}」寄与 ${r.contribution.toFixed(1)}（シェア ${pct(r.factorShare)}）。打ち手あり。`,
                            priority:
                              r.factorShare >= 30 ? 'HIGH' : 'MEDIUM',
                          })}
                        />
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ──────────────────────────────────────────────────────────────
   4) 漏れ分析（ファネル歩留り / 真因段特定）
   段歩留り = 当段 ÷ 前段。全体歩留り = 最終 ÷ 最初。歩留り最小段=漏れの真因段。
   ────────────────────────────────────────────────────────────── */
type LeakRow = { stage: string; passCount: string; hypothesis: string };

function LeakFunnelTool({ projectId }: { projectId: string }) {
  const { rows, setRows, saving, savedAt, save, loading } =
    useAnalysisSheet<LeakRow>(projectId, 'analysis-leak', [
      { stage: '', passCount: '', hypothesis: '' },
    ]);

  const addRow = () =>
    setRows((p) => [...p, { stage: '', passCount: '', hypothesis: '' }]);
  const delRow = (i: number) => setRows((p) => p.filter((_, idx) => idx !== i));
  const set = (i: number, patch: Partial<LeakRow>) =>
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const computed = useMemo(() => {
    const valid = rows.filter(
      (r) => r.stage.trim() !== '' || r.passCount.trim() !== '',
    );
    const withYield = valid.map((r, i) => {
      const cnt = numVal(r.passCount);
      const prev = i > 0 ? numVal(valid[i - 1].passCount) : 0;
      const stageYield = i === 0 ? 100 : prev > 0 ? (cnt / prev) * 100 : 0;
      return { ...r, idx: i, cnt, stageYield, isFirst: i === 0 };
    });
    const first = withYield[0]?.cnt ?? 0;
    const last = withYield[withYield.length - 1]?.cnt ?? 0;
    const totalYield = first > 0 ? (last / first) * 100 : 0;
    // 真因段 = 段歩留り最小（最初の段は基準なので除外）
    let worstIdx = -1;
    let worstYield = Infinity;
    withYield.forEach((r) => {
      if (!r.isFirst && r.stageYield < worstYield) {
        worstYield = r.stageYield;
        worstIdx = r.idx;
      }
    });
    return { withYield, totalYield, worstIdx };
  }, [rows]);

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <FunnelIcon className="h-5 w-5 text-blue-600" />
              漏れ分析（ファネル歩留り / 真因段特定）
              <HelpTooltip text="段歩留り=当段通過数÷前段通過数。全体歩留り=最終段÷最初段（各段歩留りの積）。歩留りが最も低い段＝漏れの真因段（赤）。" />
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              段階名と通過数を上から入力 → 段歩留り%・全体歩留り%を自動計算し、歩留り最小段を赤くハイライト。
            </p>
          </div>
          <SheetToolbar
            onAdd={addRow}
            onSave={save}
            saving={saving}
            savedAt={savedAt}
            addLabel="段を追加"
          />
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left text-gray-600">
                    <th className="px-3 py-2 font-medium border-b border-gray-200">
                      段階
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200 w-[120px]">
                      通過数
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200 w-[110px] text-right">
                      段歩留り
                    </th>
                    <th className="px-3 py-2 font-medium border-b border-gray-200">
                      漏れ要因（仮説）
                    </th>
                    <th className="w-10 border-b border-gray-200" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const c = computed.withYield.find((x) => x.idx === i);
                    const isWorst = computed.worstIdx === i;
                    return (
                      <tr
                        key={i}
                        className={`border-b border-gray-100 ${
                          isWorst ? 'bg-red-50' : ''
                        }`}
                      >
                        <td className="px-2 py-1">
                          <Input
                            value={r.stage}
                            onChange={(e) => set(i, { stage: e.target.value })}
                            placeholder="潜在顧客 / 認知 / 提案 / 受注"
                            className="h-8 bg-white border-gray-200"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            value={r.passCount}
                            onChange={(e) =>
                              set(i, { passCount: e.target.value })
                            }
                            placeholder="1000"
                            className="h-8 bg-white border-gray-200 text-right"
                          />
                        </td>
                        <td
                          className={`px-3 py-1 text-right font-semibold ${
                            isWorst ? 'text-red-600' : 'text-gray-700'
                          }`}
                        >
                          {c
                            ? c.isFirst
                              ? '基準'
                              : pct(c.stageYield)
                            : '—'}
                          {isWorst && (
                            <span className="ml-1 text-[10px] font-bold text-red-600">
                              真因段
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <Input
                            value={r.hypothesis}
                            onChange={(e) =>
                              set(i, { hypothesis: e.target.value })
                            }
                            placeholder="提案内容・価格・接触頻度 など"
                            className="h-8 bg-white border-gray-200"
                          />
                        </td>
                        <td className="px-1 text-center">
                          <button
                            onClick={() => delRow(i)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {computed.withYield.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
                  <span className="text-blue-700">全体歩留り = </span>
                  <span className="font-bold text-blue-800">
                    {pct(computed.totalYield)}
                  </span>
                  <span className="text-blue-700/70 text-xs">
                    {' '}
                    （最終段 ÷ 最初段 ＝ 各段歩留りの積）
                  </span>
                </div>
                {computed.worstIdx >= 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm flex items-center gap-2">
                    <span className="text-red-700">
                      漏れの真因段:{' '}
                      <span className="font-bold">
                        {rows[computed.worstIdx]?.stage || '無題'}
                      </span>
                    </span>
                    <AddAsActionButton
                      projectId={projectId}
                      build={() => {
                        const w = computed.withYield.find(
                          (x) => x.idx === computed.worstIdx,
                        );
                        const stage = rows[computed.worstIdx]?.stage || '段階';
                        return {
                          businessArea: `${stage}（漏れの真因段）`,
                          asisDescription: `段歩留り ${w ? pct(w.stageYield) : ''}・全体歩留り ${pct(computed.totalYield)}`,
                          gapDescription:
                            rows[computed.worstIdx]?.hypothesis ||
                            'この段の歩留りが最も低い。構造要因を追究。',
                          priority: 'HIGH',
                        };
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 分析タブ本体 ─────────────────────────────────────────────── */
const TOOLS = [
  { key: 'pareto', label: '80/20分析', icon: BarChart3 },
  { key: 'sensitivity', label: '感度分析', icon: Gauge },
  { key: 'gap', label: 'ギャップ分析', icon: GitCompareArrows },
  { key: 'leak', label: '漏れ分析', icon: FunnelIcon },
] as const;

export function AnalysisTab({ projectId }: { projectId: string }) {
  const [tool, setTool] = useState<(typeof TOOLS)[number]['key']>('pareto');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTool(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-gray-500">
        計算はすべてブラウザ側で即時実行され、入力行は保存ボタンで保存されます。各結果行の「打ち手として追加」でGAP一覧に課題を起票できます。
      </p>

      {tool === 'pareto' && <ParetoTool projectId={projectId} />}
      {tool === 'sensitivity' && <SensitivityTool projectId={projectId} />}
      {tool === 'gap' && <GapAnalysisTool projectId={projectId} />}
      {tool === 'leak' && <LeakFunnelTool projectId={projectId} />}
    </div>
  );
}
