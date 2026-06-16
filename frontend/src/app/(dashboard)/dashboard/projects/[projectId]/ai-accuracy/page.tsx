'use client';

/**
 * AI精度指標ページ。
 *
 * システムのAI精度指標（category=AI_QUALITY: 認識精度・自動化率など）の
 * 一覧・手動作成・編集・採用を行う。手動作成は KpiEditModal のほか、
 * 「プリセットから追加」（AI不要・ワンクリックで下書き追加）も提供する。
 * さらに「AIで生成」（対象システムから精度指標を AI で下書き生成）を本ページに統合している。
 * AI生成はダイアログ内の AiQualityKpiTab で行い、生成成功時は一覧（loadKpis）を再取得して反映する。
 *
 * KPI の取得・作成・更新・削除はすべて @/lib/kpis の kpiApi 経由。
 * 参照マスタは共有フック useKpiMasters に集約。
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  Server,
  GitBranch,
  Loader2,
  Plus,
  Sparkles,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { useReadOnly } from '@/components/read-only-context';
import { FeatureSectionIo } from '@/components/io/FeatureSectionIo';
import { EditGate } from '@/components/edit-gate';
import { kpiApi, type KpiDirection, type KpiDto } from '@/lib/kpis';
import { useKpiMasters } from '../ai-create/_components/use-kpi-masters';
import { KpiList } from '../ai-create/_components/kpi-list';
import { KpiEditModal } from '../ai-create/_components/kpi-edit-modal';
import { FlowSelect } from '../ai-create/_components/flow-select';
import { IoSummaryTable } from '../ai-create/_components/io-summary-table';
import { AiQualityKpiTab } from '../ai-create/_components/ai-quality-kpi-tab';
import type { IoSummaryItemDto } from '@/lib/kpis';

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

export default function AiAccuracyPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  // 参照マスタ（フロー / システム / ロール / INPUT-OUTPUT）
  const { flows, systems, roles, informationTypes } = useKpiMasters(projectId);

  // AI精度指標一覧（category=AI_QUALITY のみ）
  const [kpis, setKpis] = useState<KpiDto[]>([]);
  const [kpisLoading, setKpisLoading] = useState(true);
  const [kpisError, setKpisError] = useState<string | null>(null);

  // 手動作成モーダルの開閉
  const [creating, setCreating] = useState(false);

  // AI生成ダイアログの開閉
  const [aiOpen, setAiOpen] = useState(false);

  // 直前にプリセット追加・AI生成されたKPI（一覧でハイライト）
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());

  // ===== プリセット追加 UI 用の状態（systemId/flowId/IO 依存を保持する） =====
  const [systemId, setSystemId] = useState('');
  const [flowId, setFlowId] = useState('');
  const [ioItems, setIoItems] = useState<IoSummaryItemDto[]>([]);
  const [ioLoading, setIoLoading] = useState(false);
  const [ioError, setIoError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addingPreset, setAddingPreset] = useState<string | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetSuccess, setPresetSuccess] = useState<string | null>(null);

  const loadKpis = useCallback(async () => {
    setKpisError(null);
    try {
      setKpis(await kpiApi.list(projectId, { category: 'AI_QUALITY' }));
    } catch (err) {
      setKpisError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setKpisLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadKpis();
  }, [loadKpis]);

  // AI生成成功時：生成された下書きを一覧へ反映し、ハイライトする。
  const handleGenerated = useCallback(
    (created: KpiDto[]) => {
      setHighlightIds(new Set(created.map((k) => k.id)));
      void loadKpis();
    },
    [loadKpis],
  );

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

  /** プリセットをワンクリックで下書きKPIとして追加する（AI不要）。systemId/flowId/IO を引き継ぐ。 */
  const handleAddPreset = useCallback(
    async (preset: (typeof AI_QUALITY_PRESETS)[number]) => {
      if (!systemId) return;
      setAddingPreset(preset.name);
      setPresetError(null);
      setPresetSuccess(null);
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
        setHighlightIds(new Set([kpi.id]));
        setPresetSuccess(`「${preset.name}」を下書きとして追加しました。`);
        await loadKpis();
      } catch (err) {
        setPresetError(err instanceof Error ? err.message : 'KPIの作成に失敗しました');
      } finally {
        setAddingPreset(null);
      }
    },
    [projectId, systemId, flowId, selectedIds, loadKpis],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI精度指標"
        description="システムのAI精度指標（認識精度・自動化率など）を作成・採用します。"
        help="「AIで生成」で対象システムから精度指標の下書きをAI生成できます。「プリセットから追加」でよく使う精度指標をワンクリック追加、「＋手動で追加」で自由に作成でき、各カードをクリックすると全項目を編集できます。"
        backHref={`/dashboard/projects/${projectId}`}
        backLabel="プロジェクトへ戻る"
        actions={
          <>
            <EditGate dim={false}>
              <Button
                size="sm"
                onClick={() => setAiOpen(true)}
                className="bg-violet-600 hover:bg-violet-700"
              >
                <Sparkles className="mr-1 h-4 w-4" />
                AIで生成
              </Button>
            </EditGate>
            <HowToPanel
              steps={[
                '「AIで生成」で対象システムを選び、追加指示を添えて精度指標（認識精度・自動化率など）の下書きをAIで生成できます。',
                '「プリセットから追加」で対象システムを選び、精度指標をワンクリックで下書き追加できます。',
                '「＋手動で追加」で自由にAI精度指標を新規作成します（区分はAI精度指標に固定）。',
                '各カードをクリックすると、SMART採点・対象システム/IO紐づけを含め全項目を編集できます。',
              ]}
            />
            <FeatureSectionIo
              projectId={projectId}
              sectionKey="kpis"
              label="KPI"
              canEdit={canEdit}
              onDone={() => void loadKpis()}
            />
          </>
        }
      />

      {/* プリセットから追加（AI不要） */}
      <EditGate dim={false}>
        <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
          <div className="flex items-center gap-1.5">
            <Plus className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-semibold text-gray-800">プリセットから追加</h2>
            <span className="text-xs text-gray-400">
              対象システムを選び、よく使う精度指標をワンクリックで下書き追加（AI不要）
            </span>
          </div>

          {/* 対象システム選択 + 任意フロー */}
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
            <p className="text-xs text-gray-400">
              対象システムを選択すると、プリセット精度指標を追加できます。
            </p>
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
                    <IoSummaryTable
                      items={ioItems}
                      selectedIds={selectedIds}
                      onToggle={toggleSelected}
                    />
                  )}
                </div>
              )}

              {/* プリセットボタン群 */}
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
              {selectedIds.size > 0 && (
                <p className="text-xs text-gray-400">
                  {selectedIds.size}件の INPUT/OUTPUT を選択中（追加するプリセットに紐づきます）
                </p>
              )}
            </>
          )}
          {presetError && <p className="text-xs text-red-600">{presetError}</p>}
          {presetSuccess && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {presetSuccess}
            </p>
          )}
        </div>
      </EditGate>

      {/* AI精度指標一覧（category 固定） */}
      <EditGate dim={false}>
        <KpiList
          kpis={kpis}
          loading={kpisLoading}
          error={kpisError}
          highlightIds={highlightIds}
          flows={flows}
          systems={systems}
          roles={roles}
          informationTypes={informationTypes}
          onChanged={loadKpis}
          lockedCategory="AI_QUALITY"
          onCreateNew={() => setCreating(true)}
        />
      </EditGate>

      {/* AI生成ダイアログ（対象システム → AI精度指標下書き生成） */}
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-violet-600" />
              AIでAI精度指標を生成
            </DialogTitle>
            <DialogDescription>
              対象システムを選び、精度指標（認識精度・自動化率など）の下書きをAIで生成します。
              生成した下書きはこのページのKPI一覧に追加されます。
            </DialogDescription>
          </DialogHeader>
          <EditGate dim={false}>
            <AiQualityKpiTab
              projectId={projectId}
              flows={flows}
              systems={systems}
              onGenerated={handleGenerated}
            />
          </EditGate>
        </DialogContent>
      </Dialog>

      {/* 手動作成モーダル（新規作成・区分はAI精度指標に固定） */}
      {creating && (
        <KpiEditModal
          kpi={null}
          projectId={projectId}
          flows={flows}
          systems={systems}
          roles={roles}
          informationTypes={informationTypes}
          lockedCategory="AI_QUALITY"
          onClose={() => setCreating(false)}
          onSaved={loadKpis}
        />
      )}
    </div>
  );
}
