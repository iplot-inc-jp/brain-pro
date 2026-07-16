'use client';

// AI使用量ページ。Claude のトークン使用量と概算コストをモデル別/機能領域別に可視化し、
// 既存 ProjectKnowledgeSettings（AI抽出/OCR/モデル等）を編集できる。プロジェクト単位。

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useReadOnly } from '@/components/read-only-context';
import { EditGate } from '@/components/edit-gate';
import {
  BarChart3,
  Loader2,
  AlertCircle,
  Cpu,
  Layers,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  llmUsageApi,
  AREA_LABEL,
  formatTokens,
  formatUsd,
  formatPromptVersionLabel,
  type LlmUsageSummary,
} from '@/lib/llm-usage';
import {
  knowledgeSettingsApi,
  CLAUDE_MODEL_OPTIONS,
  type ProjectKnowledgeSettings,
} from '@/lib/knowledge';

type Period = 'month' | 'all';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AiUsagePage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { canEdit } = useReadOnly();

  const [period, setPeriod] = useState<Period>('month');
  const [summary, setSummary] = useState<LlmUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 設定（ProjectKnowledgeSettings）
  const [settings, setSettings] = useState<ProjectKnowledgeSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const s = await llmUsageApi.getSummary(projectId, period);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI使用量の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, period]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    knowledgeSettingsApi
      .get(projectId)
      .then(setSettings)
      .catch(() => {
        /* 設定はベストエフォート（取得失敗時は非表示） */
      });
  }, [projectId]);

  const saveSettings = async (patch: Partial<ProjectKnowledgeSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSavingSettings(true);
    setSettingsError(null);
    try {
      const saved = await knowledgeSettingsApi.update(projectId, {
        aiExtractionEnabled: next.aiExtractionEnabled,
        ocrEnabled: next.ocrEnabled,
        defaultModel: next.defaultModel,
        imagingMode: next.imagingMode,
        maxFilesPerBatch: next.maxFilesPerBatch,
      });
      setSettings(saved);
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : '設定の保存に失敗しました');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            AI使用量
          </span>
        }
        description="Claude のトークン使用量と概算コスト（プロジェクト単位・モデル別/機能領域別）。"
        help="すべてのAI機能（ナレッジ抽出・Mermaid変換・KPI生成・要求定義・イシューツリー候補・コード解析）の input/output トークンを記録します。コストは概算です。"
        actions={
          <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
            {(['month', 'all'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm ${
                  period === p
                    ? 'bg-primary text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p === 'month' ? '今月' : '全期間'}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-[160px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : summary ? (
        <>
          {/* 合計カード */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="入力トークン" value={formatTokens(summary.totalInputTokens)} />
            <SummaryCard label="出力トークン" value={formatTokens(summary.totalOutputTokens)} />
            <SummaryCard label="合計トークン" value={formatTokens(summary.totalTokens)} />
            <SummaryCard
              label="概算コスト"
              value={formatUsd(summary.totalCostUsd)}
              hint="モデル別単価による概算"
            />
          </div>

          {/* モデル別 */}
          <UsageTable
            title="モデル別"
            icon={<Cpu className="h-4 w-4 text-gray-500" />}
            firstColLabel="モデル"
            rows={summary.byModel.map((m) => ({
              key: m.model,
              label: m.model,
              inputTokens: m.inputTokens,
              outputTokens: m.outputTokens,
              tokens: m.tokens,
              costUsd: m.costUsd,
              count: m.count,
            }))}
          />

          {/* 機能領域別 */}
          <UsageTable
            title="機能領域別"
            icon={<Layers className="h-4 w-4 text-gray-500" />}
            firstColLabel="機能領域"
            rows={summary.byArea.map((a) => ({
              key: a.area,
              label: AREA_LABEL[a.area] ?? a.area,
              inputTokens: a.inputTokens,
              outputTokens: a.outputTokens,
              tokens: a.tokens,
              costUsd: a.costUsd,
              count: a.count,
            }))}
          />

          {/* 直近の呼び出し */}
          <Card className="bg-white border-gray-200">
            <CardContent className="space-y-2 p-4">
              <h2 className="text-sm font-semibold text-[#050f3e]">直近の呼び出し</h2>
              {summary.recent.length === 0 ? (
                <p className="py-2 text-xs text-gray-400">まだ記録がありません。</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {summary.recent.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-xs"
                    >
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">
                        {AREA_LABEL[r.area] ?? r.area}
                      </span>
                      <span className="font-mono text-gray-500">{r.model}</span>
                      {r.promptVersion ? (
                        <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-cyan-800">
                          {formatPromptVersionLabel(r.promptVersion)}
                        </span>
                      ) : null}
                      <span className="text-gray-500">
                        in {formatTokens(r.inputTokens)} / out{' '}
                        {formatTokens(r.outputTokens)}
                      </span>
                      <span className="text-gray-500">{formatUsd(r.costUsd)}</span>
                      <span className="ml-auto text-gray-400">
                        {formatDateTime(r.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* 設定（ProjectKnowledgeSettings 編集） */}
      {settings && (
        <EditGate dim={false}>
          <Card className="bg-white border-gray-200">
            <CardContent className="space-y-3 p-4">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
                <SettingsIcon className="h-4 w-4 text-primary" />
                AI抽出の設定（ナレッジ取り込みの既定）
                {savingSettings && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                )}
              </h2>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={settings.aiExtractionEnabled}
                  disabled={!canEdit}
                  onChange={(e) =>
                    void saveSettings({ aiExtractionEnabled: e.target.checked })
                  }
                />
                <span>
                  AI 抽出（要約・タグ・実体・関係）
                  <span className="block text-xs text-gray-500">
                    Claude を呼びます（料金が発生）。OFF なら原本テキストのみ保持。
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={settings.ocrEnabled}
                  disabled={!canEdit}
                  onChange={(e) =>
                    void saveSettings({ ocrEnabled: e.target.checked })
                  }
                />
                <span>
                  OCR / 画像解析
                  <span className="block text-xs text-gray-500">
                    画像・スキャン PDF を vision/document で読みます（画像トークン分の料金）。
                  </span>
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">既定モデル（空欄でサーバ既定）</Label>
                  <Select
                    value={settings.defaultModel || '__default__'}
                    onValueChange={(v) =>
                      void saveSettings({
                        defaultModel: v === '__default__' ? null : v,
                      })
                    }
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="サーバ既定" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        サーバ既定（EXTRACTION_MODEL）
                      </SelectItem>
                      {CLAUDE_MODEL_OPTIONS.map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Office→画像化の方針</Label>
                  <Select
                    value={settings.imagingMode}
                    onValueChange={(v) => void saveSettings({ imagingMode: v })}
                    disabled={!canEdit}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">auto（自動）</SelectItem>
                      <SelectItem value="always">always（常に画像化）</SelectItem>
                      <SelectItem value="never">never（画像化しない）</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">1バッチの最大ファイル数</Label>
                  <Input
                    type="number"
                    min={1}
                    defaultValue={settings.maxFilesPerBatch}
                    disabled={!canEdit}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1 && n !== settings.maxFilesPerBatch) {
                        void saveSettings({ maxFilesPerBatch: Math.floor(n) });
                      }
                    }}
                  />
                </div>
              </div>

              {settingsError && (
                <p className="flex items-center gap-1 text-xs text-red-600">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {settingsError}
                </p>
              )}
            </CardContent>
          </Card>
        </EditGate>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-4">
        <div className="text-xs text-gray-500">{label}</div>
        <div className="mt-1 text-2xl font-semibold text-[#050f3e]">{value}</div>
        {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
      </CardContent>
    </Card>
  );
}

interface UsageRow {
  key: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  costUsd: number;
  count: number;
}

function UsageTable({
  title,
  icon,
  firstColLabel,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  firstColLabel: string;
  rows: UsageRow[];
}) {
  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="space-y-2 p-4">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[#050f3e]">
          {icon}
          {title}
        </h2>
        {rows.length === 0 ? (
          <p className="py-2 text-xs text-gray-400">データがありません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-1.5 pr-2">{firstColLabel}</th>
                  <th className="py-1.5 pr-2 text-right">入力</th>
                  <th className="py-1.5 pr-2 text-right">出力</th>
                  <th className="py-1.5 pr-2 text-right">合計</th>
                  <th className="py-1.5 pr-2 text-right">概算コスト</th>
                  <th className="py-1.5 text-right">回数</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-gray-50">
                    <td className="py-1.5 pr-2 font-medium text-gray-700">
                      {r.label}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">
                      {formatTokens(r.inputTokens)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-600">
                      {formatTokens(r.outputTokens)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-700">
                      {formatTokens(r.tokens)}
                    </td>
                    <td className="py-1.5 pr-2 text-right text-gray-700">
                      {formatUsd(r.costUsd)}
                    </td>
                    <td className="py-1.5 text-right text-gray-500">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
