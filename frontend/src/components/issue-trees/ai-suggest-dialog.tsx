'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Wand2, Loader2, Check, AlertCircle, Settings, RefreshCw } from 'lucide-react';
import { KIND_CONFIG, type IssueNodeKind } from '@/lib/issue-tree-patterns';

export type AiSuggestion = { label: string; kind: IssueNodeKind };

type Candidate = AiSuggestion & { id: string; checked: boolean };

let seq = 0;
const nextId = () => `aisug-${seq++}`;

/**
 * 生成AIで子ノード候補を提案するダイアログ（spec D）。
 *
 * - 開くと自動で onFetch を叩き、返った {label,kind} をチェックリストに展開。
 * - チェックして「採用」で onAdopt(parentId, items) を呼び、既存 addChild で子ノード化。
 * - 鍵未設定（4xx）時はボタンを無効化し「設定でAI鍵を登録」へ誘導。
 */
export function AiSuggestDialog({
  open,
  onOpenChange,
  parentId,
  parentLabel,
  settingsHref,
  onFetch,
  onAdopt,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 対象（親）ノードID。AIは対象ノード必須なので null は呼ばれない想定。 */
  parentId: string | null;
  /** 対象ノードのラベル（見出し用） */
  parentLabel: string;
  /** AI鍵設定への導線（あれば「設定でAI鍵を登録」リンクを出す） */
  settingsHref?: string;
  /**
   * 生成AI候補を取得する。
   * @returns { ok, suggestions, keyMissing, message }
   *   keyMissing=true は鍵未設定（4xx）で、UI は設定導線に切り替える。
   */
  onFetch: (
    nodeId: string,
    context: string | undefined,
  ) => Promise<{
    ok: boolean;
    suggestions: AiSuggestion[];
    keyMissing: boolean;
    message?: string;
  }>;
  /** チェック済み候補を子ノードとして採用（一括追加）。@returns 成功したか */
  onAdopt: (parentId: string | null, items: AiSuggestion[]) => Promise<boolean>;
}) {
  const [context, setContext] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyMissing, setKeyMissing] = useState(false);
  const [fetched, setFetched] = useState(false);

  const checkedCount = useMemo(
    () => candidates.filter((c) => c.checked).length,
    [candidates],
  );

  const runFetch = useCallback(async () => {
    if (!parentId) return;
    setLoading(true);
    setError(null);
    setKeyMissing(false);
    const res = await onFetch(parentId, context.trim() || undefined);
    setLoading(false);
    setFetched(true);
    if (!res.ok) {
      setKeyMissing(res.keyMissing);
      setError(
        res.keyMissing
          ? 'AIの鍵が未設定です。設定からAI鍵を登録すると候補生成が使えます。'
          : res.message || '候補の生成に失敗しました。時間をおいて再度お試しください。',
      );
      setCandidates([]);
      return;
    }
    setCandidates(
      res.suggestions.map((s) => ({
        ...s,
        id: nextId(),
        checked: true,
      })),
    );
  }, [parentId, context, onFetch]);

  // 開くたびに初期化し、自動で1回取得する。
  useEffect(() => {
    if (!open) return;
    setContext('');
    setCandidates([]);
    setError(null);
    setKeyMissing(false);
    setFetched(false);
    setLoading(false);
    setAdopting(false);
    // parentId が無い場合は何もしない（呼ばれない想定）
    if (!parentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await onFetch(parentId, undefined);
      if (cancelled) return;
      setLoading(false);
      setFetched(true);
      if (!res.ok) {
        setKeyMissing(res.keyMissing);
        setError(
          res.keyMissing
            ? 'AIの鍵が未設定です。設定からAI鍵を登録すると候補生成が使えます。'
            : res.message || '候補の生成に失敗しました。時間をおいて再度お試しください。',
        );
        return;
      }
      setCandidates(
        res.suggestions.map((s) => ({ ...s, id: nextId(), checked: true })),
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentId]);

  const toggle = (id: string) =>
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, checked: !c.checked } : c)));

  const handleAdopt = async () => {
    const items = candidates
      .filter((c) => c.checked && c.label.trim())
      .map((c) => ({ label: c.label.trim(), kind: c.kind }));
    if (items.length === 0) {
      setError('採用する候補を1つ以上チェックしてください。');
      return;
    }
    setAdopting(true);
    setError(null);
    const ok = await onAdopt(parentId, items);
    setAdopting(false);
    if (ok) onOpenChange(false);
    else setError('子ノードの追加に失敗しました。時間をおいて再度お試しください。');
  };

  const busy = loading || adopting;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="bg-white sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-violet-600" />
            AIで候補を生成
          </DialogTitle>
          <DialogDescription>
            「{parentLabel || 'ルートの問い'}」の文脈から、生成AIが子ノード候補を提案します。
            チェックした候補を子ノードとして追加します。
          </DialogDescription>
        </DialogHeader>

        {/* 補足コンテキスト + 再生成 */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-gray-500">補足（任意）</label>
            <HelpTooltip text="AIへの補足コンテキストです（例: 直近3ヶ月の解約データを踏まえて）。入力して「再生成」を押すと反映されます。" />
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="例: 直近3ヶ月の解約データを踏まえて"
              className="text-sm"
              disabled={busy || keyMissing}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runFetch();
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runFetch}
              disabled={busy || keyMissing || !parentId}
              className="shrink-0 text-gray-600"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1">再生成</span>
            </Button>
          </div>
        </div>

        {/* 候補 */}
        <div className="min-h-[120px]">
          {loading ? (
            <div className="flex h-[160px] flex-col items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              候補を生成しています…
            </div>
          ) : keyMissing ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-5 text-center">
              <AlertCircle className="h-6 w-6 text-amber-500" />
              <p className="text-sm text-amber-800">
                AIの鍵が未設定です。設定からAI鍵を登録すると候補生成が使えます。
              </p>
              {settingsHref && (
                <Link href={settingsHref}>
                  <Button size="sm" variant="outline" className="gap-1.5 text-amber-700">
                    <Settings className="h-4 w-4" />
                    設定でAI鍵を登録
                  </Button>
                </Link>
              )}
            </div>
          ) : candidates.length > 0 ? (
            <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
              {candidates.map((c) => {
                const kc = KIND_CONFIG[c.kind];
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(c.id)}
                      aria-pressed={c.checked}
                      className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left transition ${
                        c.checked
                          ? 'border-violet-300 bg-violet-50/40'
                          : 'border-gray-200 bg-white hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
                          c.checked
                            ? 'border-violet-600 bg-violet-600 text-white'
                            : 'border-gray-300 bg-white text-transparent'
                        }`}
                      >
                        <Check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1 text-sm text-gray-800">{c.label}</span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${kc.chip}`}
                      >
                        {kc.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : fetched ? (
            <div className="flex h-[140px] items-center justify-center text-sm text-gray-400">
              候補が得られませんでした。補足を入れて「再生成」をお試しください。
            </div>
          ) : null}
        </div>

        {error && !keyMissing && (
          <div className="flex items-center gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            キャンセル
          </Button>
          <Button
            onClick={handleAdopt}
            disabled={busy || keyMissing || checkedCount === 0}
            className="bg-violet-600 hover:bg-violet-700"
          >
            {adopting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                採用中…
              </>
            ) : (
              <>
                <Check className="mr-1.5 h-4 w-4" />
                採用（{checkedCount}件）
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
