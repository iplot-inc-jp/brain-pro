'use client';

/**
 * タブ「AI精度KPI」。
 *
 * 対象システム（システムマスタ）を選び、精度指標プリセット（AI不要・ワンクリック）で
 * 下書きKPIを追加するか、「AIでKPIを作成」(category=AI_QUALITY) で生成する。
 * 任意で対象フロー・測定対象の INPUT/OUTPUT も選択できる。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Server,
  GitBranch,
  Loader2,
  Sparkles,
  Plus,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { SystemMaster } from '@/lib/masters';
import {
  kpiApi,
  type IoSummaryItemDto,
  type KpiDirection,
  type KpiDto,
} from '@/lib/kpis';
import type { BusinessFlowItem } from './types';
import { FlowSelect } from './flow-select';
import { IoSummaryTable } from './io-summary-table';

/** 精度指標プリセット。definition / unit / direction を定義済みで、AIを使わず下書き追加する。 */
const AI_QUALITY_PRESETS: ReadonlyArray<{
  name: string;
  unit: string | null;
  direction: KpiDirection;
  definition: string;
  description: string;
}> = [
  {
    name: '認識精度',
    unit: '%',
    direction: 'INCREASE',
    definition: '認識精度 = 正しく認識できた件数 ÷ 全処理件数 × 100',
    description: 'OCR・画像認識などで、AIの出力がどれだけ正しいか',
  },
  {
    name: '適合率',
    unit: '%',
    direction: 'INCREASE',
    definition: '適合率 = 正しく検出した件数(TP) ÷ 検出した全件数(TP+FP) × 100',
    description: 'AIが「該当」と判断したもののうち、本当に該当だった割合',
  },
  {
    name: '再現率',
    unit: '%',
    direction: 'INCREASE',
    definition: '再現率 = 正しく検出した件数(TP) ÷ 検出すべき全件数(TP+FN) × 100',
    description: '本当に該当するもののうち、AIが拾えた割合（見逃しの少なさ）',
  },
  {
    name: 'F1スコア',
    unit: null,
    direction: 'INCREASE',
    definition: 'F1 = 2 × (適合率 × 再現率) ÷ (適合率 + 再現率)',
    description: '適合率と再現率のバランスを1つの値で評価する指標（0〜1）',
  },
  {
    name: '誤り率',
    unit: '%',
    direction: 'DECREASE',
    definition: '誤り率 = 誤った出力の件数 ÷ 全処理件数 × 100',
    description: 'AIの出力のうち誤りだった割合（低いほど良い）',
  },
  {
    name: '自動化率',
    unit: '%',
    direction: 'INCREASE',
    definition: '自動化率 = 人手を介さず完了した件数 ÷ 全処理件数 × 100',
    description: '人の確認・修正なしで処理が完了した割合',
  },
  {
    name: '人手修正率',
    unit: '%',
    direction: 'DECREASE',
    definition: '人手修正率 = 人手修正が発生した件数 ÷ AI処理件数 × 100',
    description: 'AIの出力に対して人が修正を加えた割合（低いほど良い）',
  },
  {
    name: 'AI提案採用率',
    unit: '%',
    direction: 'INCREASE',
    definition: 'AI提案採用率 = 採用されたAI提案件数 ÷ AI提案総数 × 100',
    description: 'AIの提案（発注案・回答案など）が実際に採用された割合',
  },
  {
    name: '平均処理時間',
    unit: '秒',
    direction: 'DECREASE',
    definition: '平均処理時間 = 処理時間の合計 ÷ 処理件数',
    description: '1件あたりの処理にかかる時間（低いほど良い）',
  },
  {
    name: '需要予測MAPE',
    unit: '%',
    direction: 'DECREASE',
    definition: 'MAPE = Σ(|実績 − 予測| ÷ 実績) ÷ 件数 × 100',
    description: '需要予測の平均絶対誤差率（低いほど予測が正確）',
  },
];

export function AiQualityKpiTab({
  projectId,
  flows,
  systems,
  onCreated,
}: {
  projectId: string;
  flows: BusinessFlowItem[];
  systems: SystemMaster[];
  /** 追加・生成された下書きKPI（一覧でハイライトするため親へ通知） */
  onCreated: (created: KpiDto[]) => void;
}) {
  const [systemId, setSystemId] = useState('');
  const [flowId, setFlowId] = useState('');

  const [ioItems, setIoItems] = useState<IoSummaryItemDto[]>([]);
  const [ioLoading, setIoLoading] = useState(false);
  const [ioError, setIoError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // プリセット追加中の指標名（ボタンごとのスピナー用）
  const [addingPreset, setAddingPreset] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);

  const [instructions, setInstructions] = useState('');
  const [count, setCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // 任意のフロー選択 → io-summary を取得（測定対象IOの候補）
  useEffect(() => {
    setSelectedIds(new Set());
    if (!flowId) {
      setIoItems([]);
      setIoError(null);
      return;
    }
    let cancelled = false;
    setIoLoading(true);
    setIoError(null);
    kpiApi
      .getFlowIoSummary(flowId)
      .then((items) => {
        if (!cancelled) setIoItems(items);
      })
      .catch((err) => {
        if (!cancelled) setIoError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setIoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [flowId]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** プリセットをワンクリックで下書きKPIとして追加する（AI不要）。 */
  const handleAddPreset = useCallback(
    async (preset: (typeof AI_QUALITY_PRESETS)[number]) => {
      if (!systemId) return;
      setAddingPreset(preset.name);
      setPresetError(null);
      setSuccessMessage(null);
      try {
        let kpi = await kpiApi.create(projectId, {
          name: preset.name,
          category: 'AI_QUALITY',
          systemId,
          flowId: flowId || null,
          definition: preset.definition,
          description: preset.description,
          unit: preset.unit,
          direction: preset.direction,
          frequency: 'MONTHLY',
          status: 'DRAFT',
        });
        if (selectedIds.size > 0) {
          kpi = await kpiApi.setInformationTypes(kpi.id, Array.from(selectedIds));
        }
        onCreated([kpi]);
        setSuccessMessage(`「${preset.name}」を下書きKPIとして追加しました。`);
      } catch (err) {
        setPresetError(err instanceof Error ? err.message : 'KPIの作成に失敗しました');
      } finally {
        setAddingPreset(null);
      }
    },
    [projectId, systemId, flowId, selectedIds, onCreated],
  );

  const handleGenerate = useCallback(async () => {
    if (!systemId) return;
    setGenerating(true);
    setGenerateError(null);
    setSuccessMessage(null);
    try {
      const created = await kpiApi.generate(projectId, {
        category: 'AI_QUALITY',
        systemId,
        flowId: flowId || null,
        informationTypeIds: Array.from(selectedIds),
        instructions: instructions.trim() || undefined,
        count,
      });
      onCreated(created);
      setSuccessMessage(
        `${created.length}件の下書きKPIを作成しました。下のKPI一覧（ハイライト表示）で内容を確認し、採用してください。`,
      );
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'KPIのAI生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  }, [projectId, systemId, flowId, selectedIds, instructions, count, onCreated]);

  return (
    <div className="space-y-4">
      {/* 対象システム選択 */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <Server className="h-3.5 w-3.5 text-indigo-600" />
            対象システム
          </label>
          <select
            value={systemId}
            onChange={(e) => setSystemId(e.target.value)}
            className="w-64 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="" disabled>
              システムを選択…
            </option>
            {systems.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind === 'TARGET' ? '（対象）' : '（周辺）'}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <GitBranch className="h-3.5 w-3.5 text-blue-600" />
            対象フロー（任意）
          </label>
          <FlowSelect
            flows={flows}
            value={flowId}
            onChange={setFlowId}
            allowEmpty
            emptyLabel="指定なし"
            className="w-64 rounded border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
      </div>
      {systems.length === 0 && (
        <p className="text-xs text-gray-400">
          システムがまだありません。先に「システム」ページでシステムマスタを登録してください。
        </p>
      )}

      {!systemId ? (
        <div className="rounded border border-dashed border-indigo-200 bg-indigo-50/50 px-4 py-8 text-center">
          <Server className="mx-auto mb-2 h-6 w-6 text-indigo-300" />
          <p className="text-sm font-medium text-gray-600">対象システムを選択してください</p>
          <p className="mt-1 text-xs text-gray-400">
            AI・システムの精度を測るKPI（認識精度・自動化率など）をプリセットまたはAIで追加できます。
          </p>
        </div>
      ) : (
        <>
          {/* 任意の測定対象IO（フロー選択時のみ） */}
          {flowId && (
            <div className="space-y-1.5">
              <p className="text-xs text-gray-500">
                測定対象にしたい INPUT/OUTPUT があればチェックしてください（任意）。
              </p>
              {ioLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
              ) : ioError ? (
                <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {ioError}
                </p>
              ) : (
                <IoSummaryTable items={ioItems} selectedIds={selectedIds} onToggle={toggleSelected} />
              )}
            </div>
          )}

          {/* 精度指標プリセット */}
          <div className="space-y-2 rounded border border-indigo-100 bg-indigo-50/40 p-3">
            <div className="flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5 text-indigo-600" />
              <span className="text-xs font-medium text-gray-700">
                精度指標プリセット（ワンクリックで下書き追加・AI不要）
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
              {AI_QUALITY_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => void handleAddPreset(preset)}
                  disabled={addingPreset !== null}
                  title={`${preset.definition}\n${preset.description}`}
                  className="flex items-center justify-between gap-1 rounded border border-indigo-200 bg-white px-2 py-1.5 text-left text-xs text-gray-700 hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50"
                >
                  <span className="truncate">
                    {preset.name}
                    {preset.unit ? `(${preset.unit})` : ''}
                  </span>
                  {addingPreset === preset.name ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-indigo-500" />
                  ) : preset.direction === 'INCREASE' ? (
                    <TrendingUp className="h-3 w-3 shrink-0 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-3 w-3 shrink-0 text-blue-500" />
                  )}
                </button>
              ))}
            </div>
            {presetError && <p className="text-xs text-red-600">{presetError}</p>}
          </div>

          {/* AI生成フォーム */}
          <div className="space-y-2 rounded border border-violet-100 bg-violet-50/40 p-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              追加指示（任意）
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="例：OCRの読み取り精度と人手修正の負荷を測るKPIを提案してください"
              rows={2}
              className="bg-white text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                生成件数
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={count}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setCount(Math.max(1, Math.min(20, Math.round(n))));
                  }}
                  className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-violet-400"
                />
                件
              </label>
              {selectedIds.size > 0 && (
                <span className="text-xs text-gray-400">{selectedIds.size}件の INPUT/OUTPUT を選択中</span>
              )}
              <Button
                size="sm"
                onClick={() => void handleGenerate()}
                disabled={generating}
                className="ml-auto bg-violet-600 hover:bg-violet-700"
              >
                {generating ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-4 w-4" />
                )}
                AIでKPIを作成
              </Button>
            </div>
            {generateError && <p className="text-xs text-red-600">{generateError}</p>}
            {successMessage && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                {successMessage}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
