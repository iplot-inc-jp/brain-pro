'use client';

/**
 * 図の共有リンクダイアログ（汎用）。
 *
 * 業務フロー図 / DFD / オブジェクト関係性マップ / イシューツリーで共通の
 * 「共有」ボタン＋ダイアログ。公開範囲をメニューで選べる:
 *  - PUBLIC: リンクを知っていれば誰でも閲覧（ログイン不要）
 *  - ORG   : 同じ組織のログインユーザーのみ閲覧
 *
 * バックエンドは ShareLinkController（/api/projects/:projectId/share-links）。
 * 発行済みリンクの scope 変更はトークンを維持したまま即保存する
 * （配布済みURLはそのままに公開範囲だけ切り替えられる）。
 */

import { useCallback, useState } from 'react';
import {
  Share2,
  Copy,
  Check,
  Loader2,
  Globe,
  Building2,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

export type ShareKind = 'FLOW' | 'DFD' | 'OBJECT_MAP' | 'ISSUE_TREE';
export type ShareScope = 'PUBLIC' | 'ORG';

function getHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

const SCOPE_OPTIONS: Array<{
  value: ShareScope;
  label: string;
  detail: string;
  Icon: typeof Globe;
}> = [
  {
    value: 'PUBLIC',
    label: '一般公開',
    detail: 'リンクを知っている人は誰でも閲覧できます（ログイン不要）',
    Icon: Globe,
  },
  {
    value: 'ORG',
    label: '組織メンバーのみ',
    detail: '同じ組織のログインユーザーだけが閲覧できます',
    Icon: Building2,
  },
];

export function ShareLinkDialog({
  projectId,
  kind,
  targetId,
  viewerPath,
  canEdit,
  buttonClassName,
  buttonSize,
}: {
  projectId: string;
  kind: ShareKind;
  /** 共有対象ID（FLOW=フローID / DFD=図ID / OBJECT_MAP=プロジェクトID / ISSUE_TREE=ツリーID）。 */
  targetId: string;
  /** 閲覧ページのパス（例: '/share/flow'）。URL は `${origin}${viewerPath}/${token}`。 */
  viewerPath: string;
  canEdit: boolean;
  buttonClassName?: string;
  buttonSize?: 'default' | 'sm';
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [scope, setScope] = useState<ShareScope>('PUBLIC');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `${API_URL}/api/projects/${projectId}/share-links`;
  const query = `kind=${kind}&targetId=${encodeURIComponent(targetId)}`;

  // ダイアログを開いたとき現在の発行状態を取得。
  const openDialog = useCallback(async () => {
    setOpen(true);
    setCopied(false);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${base}?${query}`, { headers: getHeaders() });
      if (res.ok) {
        const d = await res.json();
        setToken(d?.token ?? null);
        if (d?.scope === 'PUBLIC' || d?.scope === 'ORG') setScope(d.scope);
      }
    } catch {
      // 取得失敗は未発行扱い
    } finally {
      setLoading(false);
    }
  }, [base, query]);

  // 発行 / scope 変更（トークンは維持）。
  const upsert = useCallback(
    async (nextScope: ShareScope) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ kind, targetId, scope: nextScope }),
        });
        if (!res.ok) throw new Error('共有リンクの保存に失敗しました');
        const d = await res.json();
        setToken(d.token);
        setScope(d.scope === 'ORG' ? 'ORG' : 'PUBLIC');
      } catch (err) {
        setError(err instanceof Error ? err.message : '保存に失敗しました');
      } finally {
        setBusy(false);
      }
    },
    [base, kind, targetId],
  );

  const revoke = useCallback(async () => {
    if (
      !window.confirm(
        '共有リンクを無効化します。既に共有したURLも開けなくなります。よろしいですか？',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${base}?${query}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!res.ok) throw new Error('無効化に失敗しました');
      setToken(null);
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '無効化に失敗しました');
    } finally {
      setBusy(false);
    }
  }, [base, query]);

  const shareUrl =
    token && typeof window !== 'undefined'
      ? `${window.location.origin}${viewerPath}/${token}`
      : null;

  const copyUrl = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボード不可の環境では input を手動コピー
    }
  }, [shareUrl]);

  return (
    <>
      <Button
        variant="outline"
        size={buttonSize}
        onClick={() => void openDialog()}
        className={buttonClassName ?? 'text-gray-600'}
        title="閲覧用の共有リンクを発行/管理（画像出力と違い拡大しても劣化しません）"
      >
        <Share2 className="w-4 h-4 mr-2" />
        共有
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5 text-indigo-600" />
              閲覧用リンクを共有
            </DialogTitle>
            <DialogDescription>
              この図を閲覧専用のURLで共有します。ブラウザ描画（ベクタ）なので、
              画像出力と違い拡大しても画質が劣化しません。
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* 公開範囲メニュー */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-gray-500">公開範囲</p>
                <div className="space-y-1.5">
                  {SCOPE_OPTIONS.map((opt) => {
                    const selected = scope === opt.value;
                    const Icon = opt.Icon;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={busy || !canEdit}
                        onClick={() => {
                          setScope(opt.value);
                          // 発行済みなら即保存（トークン維持で範囲だけ変更）
                          if (token) void upsert(opt.value);
                        }}
                        className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
                          selected
                            ? 'border-indigo-400 bg-indigo-50'
                            : 'border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                      >
                        <Icon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            selected ? 'text-indigo-600' : 'text-gray-400'
                          }`}
                        />
                        <span className="min-w-0">
                          <span
                            className={`block text-sm font-medium ${
                              selected ? 'text-indigo-800' : 'text-gray-700'
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="block text-[11px] text-gray-400">
                            {opt.detail}
                          </span>
                        </span>
                        {selected && (
                          <Check className="ml-auto h-4 w-4 shrink-0 text-indigo-600" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              {shareUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={shareUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 text-xs"
                    />
                    <Button
                      type="button"
                      onClick={() => void copyUrl()}
                      className="shrink-0 gap-1.5 bg-blue-600 hover:bg-blue-700"
                    >
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copied ? 'コピーしました' : 'コピー'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <a
                      href={shareUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      新しいタブでプレビュー
                    </a>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => void revoke()}
                        disabled={busy}
                        className="text-xs text-red-500 hover:underline disabled:opacity-50"
                      >
                        共有リンクを無効化
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-500">
                    共有リンクはまだ発行されていません。
                  </p>
                  {canEdit && (
                    <Button
                      type="button"
                      onClick={() => void upsert(scope)}
                      disabled={busy}
                      className="gap-1.5 bg-blue-600 hover:bg-blue-700"
                    >
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                      共有リンクを発行
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
