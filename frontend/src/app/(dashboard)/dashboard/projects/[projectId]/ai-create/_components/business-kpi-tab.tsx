'use client';

/**
 * タブ「業務KPI」。
 *
 * 対象業務フロー（ASIS/TOBE どちらも可）を選ぶと io-summary を取得し、
 * フロー上の INPUT/OUTPUT・帳票を種別ごと（帳票/データ/物体）に表示する。
 * 複数選択して追加指示を添え、「AIでKPIを作成」で category=BUSINESS の
 * 下書きKPI（status=DRAFT・aiGenerated=true）を生成する。
 */

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { kpiApi, type IoSummaryItemDto, type KpiDto } from '@/lib/kpis';
import type { BusinessFlowItem } from './types';
import { FlowSelect } from './flow-select';
import { IoSummaryTable } from './io-summary-table';

export function BusinessKpiTab({
  projectId,
  flows,
  onGenerated,
}: {
  projectId: string;
  flows: BusinessFlowItem[];
  /** 生成された下書きKPI（一覧でハイライトするため親へ通知） */
  onGenerated: (created: KpiDto[]) => void;
}) {
  const [flowId, setFlowId] = useState('');
  const [ioItems, setIoItems] = useState<IoSummaryItemDto[]>([]);
  const [ioLoading, setIoLoading] = useState(false);
  const [ioError, setIoError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [instructions, setInstructions] = useState('');
  const [count, setCount] = useState(5);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadIoSummary = useCallback(async (targetFlowId: string) => {
    if (!targetFlowId) {
      setIoItems([]);
      return;
    }
    setIoLoading(true);
    setIoError(null);
    try {
      const items = await kpiApi.getFlowIoSummary(targetFlowId);
      setIoItems(items);
    } catch (err) {
      setIoError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIoLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedIds(new Set());
    setSuccessMessage(null);
    setGenerateError(null);
    void loadIoSummary(flowId);
  }, [flowId, loadIoSummary]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 種別変更（informationType 更新）後に io-summary を取り直してグルーピングへ反映
  const handleCategoryChanged = useCallback(async () => {
    await loadIoSummary(flowId);
  }, [flowId, loadIoSummary]);

  const handleGenerate = useCallback(async () => {
    if (!flowId || selectedIds.size === 0) return;
    setGenerating(true);
    setGenerateError(null);
    setSuccessMessage(null);
    try {
      const created = await kpiApi.generate(projectId, {
        category: 'BUSINESS',
        flowId,
        informationTypeIds: Array.from(selectedIds),
        instructions: instructions.trim() || undefined,
        count,
      });
      onGenerated(created);
      setSuccessMessage(
        `${created.length}件の下書きKPIを作成しました。下のKPI一覧（ハイライト表示）で内容を確認し、採用してください。`,
      );
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'KPIのAI生成に失敗しました');
    } finally {
      setGenerating(false);
    }
  }, [projectId, flowId, selectedIds, instructions, count, onGenerated]);

  return (
    <div className="space-y-4">
      {/* 対象フロー選択 */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
          <GitBranch className="h-3.5 w-3.5 text-blue-600" />
          対象業務フロー
        </label>
        <FlowSelect flows={flows} value={flowId} onChange={setFlowId} />
        {flows.length === 0 && (
          <p className="text-xs text-gray-400">
            業務フローがまだありません。先に「ASIS」または「TOBE」ページでフローを作成してください。
          </p>
        )}
      </div>

      {/* フロー未選択ガイド */}
      {!flowId ? (
        <div className="rounded border border-dashed border-blue-200 bg-blue-50/50 px-4 py-8 text-center">
          <GitBranch className="mx-auto mb-2 h-6 w-6 text-blue-300" />
          <p className="text-sm font-medium text-gray-600">業務フローを選択してください</p>
          <p className="mt-1 text-xs text-gray-400">
            フロー上の INPUT/OUTPUT・帳票を読み取り、それを測るKPIをAIが提案します。
          </p>
        </div>
      ) : ioLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        </div>
      ) : ioError ? (
        <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{ioError}</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-xs text-gray-500">
              KPIで測りたい INPUT/OUTPUT にチェックを入れてください（種別はその場で変更して保存できます）。
            </p>
            <IoSummaryTable
              items={ioItems}
              selectedIds={selectedIds}
              onToggle={toggleSelected}
              editableCategory
              onCategoryChanged={handleCategoryChanged}
            />
          </div>

          {/* 生成フォーム */}
          <div className="space-y-2 rounded border border-violet-100 bg-violet-50/40 p-3">
            <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
              追加指示（任意）
            </label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="例：欠品と発注リードタイムに関するKPIを重視してください"
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
              <span className="text-xs text-gray-400">{selectedIds.size}件の INPUT/OUTPUT を選択中</span>
              <Button
                size="sm"
                onClick={() => void handleGenerate()}
                disabled={generating || selectedIds.size === 0}
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
