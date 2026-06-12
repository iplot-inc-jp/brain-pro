'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { SortableTh } from '@/components/ui/sortable-th';
import { Check, X, Loader2, ClipboardList } from 'lucide-react';
import { useTableSort } from '@/lib/use-table-sort';
import { gapLedgerApi } from '@/lib/gap-ledger';
import {
  roadmapPhaseApi,
  phaseStorageKey,
  resolvePhase,
  type RoadmapPhase,
} from '@/lib/roadmap-phases';
import { SheetToolbar } from './sheet-toolbar';

type Priority = 'HIGH' | 'MEDIUM' | 'LOW';
type GapStatus = 'OPEN' | 'RESOLVED';

export type LedgerGapItem = {
  id: string;
  businessArea: string;
  asisDescription: string | null;
  tobeDescription: string | null;
  gapDescription: string | null;
  priority: Priority;
  status: GapStatus;
  ownerName: string | null;
};

const priorityLabel: Record<Priority, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};
const priorityBadge: Record<Priority, string> = {
  HIGH: 'text-red-700 bg-red-50 border-red-300',
  MEDIUM: 'text-amber-700 bg-amber-50 border-amber-300',
  LOW: 'text-gray-600 bg-gray-100 border-gray-300',
};

// 優先度スコア用の難易度係数（課題9: 低=1 / 中=3 / 高=5）
const SCORE_DIFF: Record<string, number> = { LOW: 1, MID: 3, HIGH: 5 };
const SCORE_DIFF_LABEL: Record<string, string> = {
  LOW: '低 (=1)',
  MID: '中 (=3)',
  HIGH: '高 (=5)',
};

// TOBE フェーズ（RoadmapPhase マスタ駆動。ロードマップページと共有）。
// 保存値は legacyKey ?? name（未割当は 'NONE'）。バッジは旧固定キーのみ
// 専用色、カスタムフェーズは共通色にフォールバック。
const phaseBadge: Record<string, string> = {
  Q: 'text-emerald-700 bg-emerald-50 border-emerald-300',
  P2: 'text-amber-700 bg-amber-50 border-amber-300',
  P3: 'text-gray-600 bg-gray-100 border-gray-300',
  NONE: 'text-gray-400 bg-white border-gray-200 border-dashed',
};
const customPhaseBadge = 'text-blue-700 bg-blue-50 border-blue-300';

const filled = (v: string | null | undefined) => !!v && v.trim() !== '';

// gap id ごとの追加メタ（インパクト/難易度/フェーズ/補完問い）を GapLedger テーブルに保存
type ScoreRow = {
  gapId: string;
  impact: string; // 件/月（削減は負数）
  difficulty: string; // LOW/MID/HIGH
  phase: string; // GapLedger.phase の生値（フェーズの legacyKey ?? name。未割当は NONE）
  toComplete: string; // 補完すべきこと
};

// 台帳テーブルの1行（GAP item + メタ + 完備チェックの導出値）
type LedgerRow = {
  item: LedgerGapItem;
  meta: ScoreRow;
  seq: number;
  asisOk: boolean;
  tobeOk: boolean;
  gapOk: boolean;
  allThree: boolean;
  score: number | null;
  coef: number;
};

// ヘッダーソート用: 優先度は 低 < 中 < 高 の順位で比較
const PRIORITY_RANK: Record<Priority, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

// 台帳テーブル（課題一覧/対応表）のヘッダークリックソート accessor。
// 表示用の派生値で比較する。ID（連番）と補完すべきこと（入力欄）は対象外。
// ※ 優先度スコア表はスコア降順に自動整列済みの計算結果表のためソートUI対象外。
const ledgerSortAccessors: Record<
  string,
  (r: LedgerRow) => string | number | null
> = {
  businessArea: (r) => r.item.businessArea,
  asis: (r) => (filled(r.item.asisDescription) ? r.item.asisDescription : null),
  tobe: (r) => (filled(r.item.tobeDescription) ? r.item.tobeDescription : null),
  gap: (r) => (filled(r.item.gapDescription) ? r.item.gapDescription : null),
  priority: (r) => PRIORITY_RANK[r.item.priority],
  // 対応表: 埋まっている要素数（0〜3。3=揃）。昇順なら要補完の行が先頭に来る
  check: (r) => (r.asisOk ? 1 : 0) + (r.tobeOk ? 1 : 0) + (r.gapOk ? 1 : 0),
};

/**
 * GapLedger テーブルを ScoreRow[] として読み書きするローカルフック。
 * 旧 useRecordSheet<ScoreRow>(projectId, 'gap-ledger-meta', []) の返り値面
 * （rows/setRows/save/saving/savedAt）をそのまま再現し、コンポーネント本体は無改変で済む。
 */
function useGapLedgerMeta(projectId: string) {
  const [rows, setRows] = useState<ScoreRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const fetched = await gapLedgerApi.list(projectId);
        if (!active) return;
        setRows(
          fetched.map((r) => ({
            gapId: r.gapId,
            impact: r.impact ?? '',
            difficulty: r.difficulty ?? 'MID',
            phase: r.phase ?? 'NONE',
            toComplete: r.toComplete ?? '',
          })),
        );
      } catch (err) {
        console.error('Failed to load gap ledger:', err);
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId]);

  const update = useCallback((updater: (prev: ScoreRow[]) => ScoreRow[]) => {
    setRows((prev) => updater(prev));
    setSavedAt(null);
  }, []);

  const save = useCallback(
    async (next?: ScoreRow[]) => {
      const payload = next ?? rows;
      setSaving(true);
      try {
        await gapLedgerApi.save(
          projectId,
          payload.map((r) => ({
            gapId: r.gapId,
            impact: r.impact,
            difficulty: r.difficulty,
            phase: r.phase,
            toComplete: r.toComplete,
          })),
        );
        setSavedAt(Date.now());
      } catch (err) {
        console.error('Failed to save gap ledger:', err);
      } finally {
        setSaving(false);
      }
    },
    [projectId, rows],
  );

  return { rows, setRows: update, saving, savedAt, save };
}

export function LedgerTab({
  projectId,
  items,
  loading,
}: {
  projectId: string;
  items: LedgerGapItem[];
  loading: boolean;
}) {
  const {
    rows: meta,
    setRows: setMeta,
    saving,
    savedAt,
    save,
  } = useGapLedgerMeta(projectId);

  const [onlyIncomplete, setOnlyIncomplete] = useState(false);

  // フェーズマスタ（RoadmapPhase）。list がバックエンドで初期3フェーズ（Q/P2/P3）をシード。
  const [phases, setPhases] = useState<RoadmapPhase[]>([]);
  useEffect(() => {
    let active = true;
    roadmapPhaseApi
      .list(projectId)
      .then((rows) => {
        if (active) setPhases([...rows].sort((a, b) => a.order - b.order));
      })
      .catch((err) => console.error('Failed to load roadmap phases:', err));
    return () => {
      active = false;
    };
  }, [projectId]);

  // セレクト選択肢: 未割当(NONE) + フェーズ行(order昇順、value は legacyKey ?? name)
  const phaseOptions = useMemo(
    () => [
      { value: 'NONE', label: '未割当' },
      ...phases.map((p) => ({ value: phaseStorageKey(p), label: p.name })),
    ],
    [phases],
  );

  // GapLedger.phase の生値 → セレクト値（legacyKey 一致 → name 一致 → NONE）
  const phaseValueOf = useCallback(
    (raw: string) => {
      const p = resolvePhase(raw, phases);
      return p ? phaseStorageKey(p) : 'NONE';
    },
    [phases],
  );

  const metaFor = (gapId: string): ScoreRow =>
    meta.find((m) => m.gapId === gapId) ?? {
      gapId,
      impact: '',
      difficulty: 'MID',
      phase: 'NONE',
      toComplete: '',
    };

  const setMetaField = (gapId: string, patch: Partial<ScoreRow>) => {
    setMeta((prev) => {
      const exists = prev.some((m) => m.gapId === gapId);
      if (exists) {
        return prev.map((m) => (m.gapId === gapId ? { ...m, ...patch } : m));
      }
      return [...prev, { ...metaFor(gapId), ...patch }];
    });
  };

  // 各 GAP item の完備状態とスコアを導出
  const rows = useMemo<LedgerRow[]>(() => {
    return items.map((it, i) => {
      const m = metaFor(it.id);
      const asisOk = filled(it.asisDescription);
      const tobeOk = filled(it.tobeDescription);
      const gapOk = filled(it.gapDescription);
      const allThree = asisOk && tobeOk && gapOk;
      const impact = Number(String(m.impact ?? '').replace(/[, ]/g, ''));
      const hasImpact = Number.isFinite(impact) && m.impact.trim() !== '';
      const coef = SCORE_DIFF[m.difficulty] ?? 3;
      const score = hasImpact ? Math.abs(impact) / coef : null;
      return {
        item: it,
        meta: m,
        seq: i + 1,
        asisOk,
        tobeOk,
        gapOk,
        allThree,
        score,
        coef,
      };
    });
    // meta を依存に含めるため items + meta が変わると再計算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, meta]);

  const completeness = useMemo(() => {
    const total = rows.length;
    const complete = rows.filter((r) => r.allThree).length;
    return { total, complete, incomplete: total - complete };
  }, [rows]);

  const scoreSorted = useMemo(
    () =>
      [...rows]
        .filter((r) => r.score !== null)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [rows],
  );

  // 台帳テーブルのヘッダークリックソート（解除時は元の連番順に戻る）。
  // 優先度スコア表は scoreSorted（スコア降順固定）のままで対象外。
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(
    rows,
    ledgerSortAccessors,
  );

  const visible = onlyIncomplete ? sorted.filter((r) => !r.allThree) : sorted;

  const CheckChip = ({ ok }: { ok: boolean }) =>
    ok ? (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
        <Check className="h-3.5 w-3.5" />
      </span>
    ) : (
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-100 text-red-600">
        <X className="h-3.5 w-3.5" />
      </span>
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[260px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* サマリー + ツールバー */}
      <Card className="bg-white border-gray-200">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-gray-700 font-medium">
              <ClipboardList className="h-5 w-5 text-blue-600" />
              課題一覧 / 対応表
              <HelpTooltip text="既存GAP itemsを1業務1行の台帳として表示。対応表=ASIS/TOBE/GAPが全て埋まっているか（✓/✗）の自己チェックと補完すべきこと。優先度スコア=|インパクト|÷難易度。" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                3要素揃い {completeness.complete}
              </span>
              <span className="text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                要補完 {completeness.incomplete}
              </span>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyIncomplete}
                onChange={(e) => setOnlyIncomplete(e.target.checked)}
                className="rounded border-gray-300"
              />
              未完備のみ
            </label>
            <div className="ml-auto">
              <SheetToolbar
                onAdd={() => {}}
                onSave={save}
                saving={saving}
                savedAt={savedAt}
                addLabel=""
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            ASIS/TOBE/GAP本文・優先度はGAP一覧タブで編集。ここで入力するインパクト/難易度/フェーズ/補完すべきことは「保存」で記録に保持されます。
          </p>
        </CardContent>
      </Card>

      {items.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="py-12 text-center text-gray-500 text-sm">
            GAP（課題）がまだありません。「GAP一覧」タブで追加してください。
          </CardContent>
        </Card>
      ) : (
        <>
          {/* 台帳 + 対応表 */}
          <Card className="bg-white border-gray-200 overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-600">
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[40px]">
                        ID
                      </th>
                      <SortableTh
                        label="業務・領域"
                        sortKey="businessArea"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="font-medium border-b border-gray-200 w-[130px]"
                      />
                      <SortableTh
                        label="ASIS"
                        sortKey="asis"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="font-medium border-b border-gray-200"
                      />
                      <SortableTh
                        label="TOBE"
                        sortKey="tobe"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="font-medium border-b border-gray-200"
                      />
                      <SortableTh
                        label="GAP"
                        sortKey="gap"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="font-medium border-b border-gray-200 bg-amber-50/50"
                      />
                      <SortableTh
                        label="優先度"
                        sortKey="priority"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="px-2 font-medium border-b border-gray-200 w-[70px]"
                      />
                      <SortableTh
                        label="対応表（A/T/G・揃）"
                        sortKey="check"
                        current={sortKey}
                        dir={sortDir}
                        onToggle={toggleSort}
                        className="px-2 font-medium border-b border-gray-200 text-center w-[150px]"
                      >
                        <HelpTooltip text="ASIS/TOBE/GAPの各セルが埋まっているか（✓/✗）と、3つ揃ったか。1つでも✗なら補完すべきことを記入。" />
                      </SortableTh>
                      <th className="px-3 py-2 font-medium border-b border-gray-200 w-[200px]">
                        補完すべきこと
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r) => (
                      <tr
                        key={r.item.id}
                        className={`border-b border-gray-100 align-top ${
                          r.allThree ? '' : 'bg-red-50/30'
                        }`}
                      >
                        <td className="px-2 py-2 text-gray-400">{r.seq}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">
                          {r.item.businessArea}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {filled(r.item.asisDescription) ? (
                            r.item.asisDescription
                          ) : (
                            <span className="inline-block text-xs px-1.5 py-0.5 rounded border border-dashed border-gray-300 text-gray-400">
                              ？
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-700">
                          {filled(r.item.tobeDescription) ? (
                            r.item.tobeDescription
                          ) : (
                            <span className="inline-block text-xs px-1.5 py-0.5 rounded border border-dashed border-gray-300 text-gray-400">
                              ？
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-900 bg-amber-50/30">
                          {filled(r.item.gapDescription) ? (
                            r.item.gapDescription
                          ) : (
                            <span className="inline-block text-xs px-1.5 py-0.5 rounded border border-dashed border-gray-300 text-gray-400">
                              ？
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <span
                            className={`inline-block text-xs px-2 py-0.5 rounded border font-semibold ${priorityBadge[r.item.priority]}`}
                          >
                            {priorityLabel[r.item.priority]}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center justify-center gap-2">
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] text-gray-400">A</span>
                              <CheckChip ok={r.asisOk} />
                            </div>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] text-gray-400">T</span>
                              <CheckChip ok={r.tobeOk} />
                            </div>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] text-gray-400">G</span>
                              <CheckChip ok={r.gapOk} />
                            </div>
                            <div className="flex flex-col items-center gap-0.5 ml-1 pl-2 border-l border-gray-200">
                              <span className="text-[10px] text-gray-400">
                                揃
                              </span>
                              {r.allThree ? (
                                <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-emerald-600 text-white text-[10px] font-bold">
                                  ✓
                                </span>
                              ) : (
                                <span className="inline-flex items-center justify-center px-1.5 h-5 rounded bg-red-500 text-white text-[10px] font-bold">
                                  ✗
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {r.allThree ? (
                            <span className="text-xs text-gray-400">—</span>
                          ) : (
                            <Input
                              value={r.meta.toComplete}
                              onChange={(e) =>
                                setMetaField(r.item.id, {
                                  toComplete: e.target.value,
                                })
                              }
                              placeholder="次回ヒアリングで埋める補完問い"
                              className="h-8 bg-white border-gray-200 text-xs"
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* 優先度スコア + TOBE3段階 */}
          <Card className="bg-white border-gray-200 overflow-hidden">
            <CardContent className="p-4 space-y-3">
              <div>
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  優先度スコア（|インパクト| ÷ 難易度）＆ TOBE 3段階
                  <HelpTooltip text="優先度スコア = |インパクト(件/月)| ÷ 難易度（低=1/中=3/高=5）。スコア降順で着手順。主観の優先度(高/中/低)との乖離を客観スコアで確認。TOBE3段階=3ヶ月/1年/3年のフェーズ割当。" />
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  各課題にインパクト（件/月、削減は負数）と難易度を入力 → スコアを自動計算しスコア降順で表示。フェーズ（3ヶ月/1年/3年）も割り当てられます。
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-600">
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[40px]">
                        順
                      </th>
                      <th className="px-3 py-2 font-medium border-b border-gray-200">
                        業務・領域
                      </th>
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[70px]">
                        主観優先度
                      </th>
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[120px]">
                        インパクト(件/月)
                      </th>
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[120px]">
                        難易度
                      </th>
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[90px] text-right">
                        スコア
                      </th>
                      <th className="px-2 py-2 font-medium border-b border-gray-200 w-[180px]">
                        TOBE 3段階
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scoreSorted.length > 0 ? scoreSorted : rows).map(
                      (r, idx) => {
                        // スコア乖離の警告: 主観=高 なのにスコア下位、または主観=低 なのにスコア上位
                        const objectiveRank =
                          r.score !== null
                            ? scoreSorted.findIndex(
                                (x) => x.item.id === r.item.id,
                              )
                            : -1;
                        const topThird = scoreSorted.length
                          ? Math.ceil(scoreSorted.length / 3)
                          : 0;
                        const isObjTop =
                          objectiveRank >= 0 && objectiveRank < topThird;
                        const mismatch =
                          r.score !== null &&
                          ((r.item.priority === 'HIGH' && !isObjTop) ||
                            (r.item.priority === 'LOW' && isObjTop));
                        return (
                          <tr
                            key={r.item.id}
                            className="border-b border-gray-100 align-middle"
                          >
                            <td className="px-2 py-2 text-gray-500">
                              {r.score !== null ? idx + 1 : '—'}
                            </td>
                            <td className="px-3 py-2 font-medium text-gray-900">
                              {r.item.businessArea}
                            </td>
                            <td className="px-2 py-2">
                              <span
                                className={`inline-block text-xs px-2 py-0.5 rounded border font-semibold ${priorityBadge[r.item.priority]}`}
                              >
                                {priorityLabel[r.item.priority]}
                              </span>
                            </td>
                            <td className="px-2 py-2">
                              <Input
                                value={r.meta.impact}
                                onChange={(e) =>
                                  setMetaField(r.item.id, {
                                    impact: e.target.value,
                                  })
                                }
                                placeholder="-10"
                                className="h-8 bg-white border-gray-200 text-right"
                              />
                            </td>
                            <td className="px-2 py-2">
                              <Select
                                value={r.meta.difficulty}
                                onValueChange={(v) =>
                                  setMetaField(r.item.id, { difficulty: v })
                                }
                              >
                                <SelectTrigger className="h-8 bg-white border-gray-200">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white">
                                  <SelectItem value="LOW">
                                    {SCORE_DIFF_LABEL.LOW}
                                  </SelectItem>
                                  <SelectItem value="MID">
                                    {SCORE_DIFF_LABEL.MID}
                                  </SelectItem>
                                  <SelectItem value="HIGH">
                                    {SCORE_DIFF_LABEL.HIGH}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-2 py-2 text-right">
                              {r.score !== null ? (
                                <span className="inline-flex items-center gap-1 font-bold text-blue-700">
                                  {r.score.toFixed(1)}
                                  {mismatch && (
                                    <span
                                      title="主観優先度と客観スコアが乖離しています"
                                      className="text-amber-500"
                                    >
                                      ⚠
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1.5">
                                <Select
                                  value={phaseValueOf(r.meta.phase)}
                                  onValueChange={(v) =>
                                    setMetaField(r.item.id, { phase: v })
                                  }
                                >
                                  <SelectTrigger
                                    className={`h-8 border text-xs ${phaseBadge[phaseValueOf(r.meta.phase)] ?? customPhaseBadge}`}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-white">
                                    {phaseOptions.map((p) => (
                                      <SelectItem key={p.value} value={p.value}>
                                        {p.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </td>
                          </tr>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-400">
                ⚠ = 主観優先度（高/中/低）と客観スコアが乖離しているサイン。難易度係数: 低=1 / 中=3 / 高=5。
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
