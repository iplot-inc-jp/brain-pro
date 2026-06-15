'use client';

// 【管理者向け】外部課題トラッカー（Backlog / Jira）連携パネル。
//
// CSV を介さず、Backlog / Jira の課題を Brain Pro の Task へ取り込む。
//   - フル移行（full）        … 対象プロジェクトの課題を全件取り込み（再実行は upsert で冪等）
//   - 差分同期（incremental） … 前回同期（lastSyncedAt）以降に更新された課題のみ取り込み
//
// 取り込み本体は backend の TRACKER_IMPORT ジョブが実行するため、ここは
//   設定 CRUD ＋ 接続テスト ＋ 取り込み起票（→ jobId をポーリングして進捗/結果表示）
// を担う。配信/取込の詳細・試行履歴はバッチ管理（種別 TRACKER_IMPORT）で確認できる。
//
// 認可: 一覧/CRUD/test/import はすべてプロジェクト管理者限定。非管理者には backend が
// 403 を返すため、その場合は「管理者のみ」案内を表示する（バックエンドが最終防御線）。
//
// 秘匿情報: credential（APIキー/トークン）はサーバから返らず（hasCredential のみ）、
// 入力時のみ更新する（伏字運用）。

import { useCallback, useEffect, useState } from 'react';
import {
  Plug,
  Plus,
  Trash2,
  Pencil,
  Loader2,
  PlugZap,
  ShieldAlert,
  CheckCircle2,
  AlertCircle,
  X,
  DownloadCloud,
  GitCompareArrows,
  Clock,
  ExternalLink,
  Webhook,
  Copy,
  Check,
  RefreshCw,
  PowerOff,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { useBackgroundJob } from '@/hooks/use-background-job';
import { isTerminalStatus } from '@/lib/jobs';
import {
  trackersApi,
  TrackerApiError,
  TRACKER_PROVIDERS,
  trackerProviderMeta,
  trackerProviderLabel,
  isTrackerImportResult,
  type TrackerConnection,
  type TrackerProvider,
  type TrackerImportMode,
  type TrackerTestResult,
} from '@/lib/trackers';

// 簡易トグル（switch コンポーネントが無いためインライン実装。integrations と同系統）
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50 ${
        checked ? 'bg-blue-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type FormState = {
  provider: TrackerProvider;
  host: string;
  email: string;
  /** 入力時のみ更新。プレースホルダのみで現在値は表示しない。 */
  credential: string;
  projectKey: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
};

const emptyForm: FormState = {
  provider: 'BACKLOG',
  host: '',
  email: '',
  credential: '',
  projectKey: '',
  autoSync: false,
  syncIntervalMinutes: 60,
};

/** 進行中の取り込み（接続ごと1件）。jobId をフックでポーリングする。 */
type ActiveImport = {
  connectionId: string;
  jobId: string;
  mode: TrackerImportMode;
};

/**
 * 接続ごとの Webhook 状態。
 *   - loaded … 初回の url 取得が済んだか（false の間は「読み込み中」）。
 *   - url    … 秘密入り受信 URL。null=webhook 無効。
 *   - busy   … enable/regenerate/disable 実行中。
 *   - error  … 直近の操作エラー。
 *   - copied … URL をクリップボードにコピー済みか（一時表示）。
 */
type WebhookState = {
  loaded: boolean;
  url: string | null;
  busy: boolean;
  error: string | null;
  copied: boolean;
  /** 秘密入り URL を平文表示しているか（既定は伏せる）。 */
  revealed: boolean;
  /** URL 取得（getWebhookUrl）が失敗したか。true のとき「無効」ではなく「取得失敗」を表示する。 */
  loadError: boolean;
};

const initialWebhookState: WebhookState = {
  loaded: false,
  url: null,
  busy: false,
  error: null,
  copied: false,
  revealed: false,
  loadError: false,
};

/**
 * Webhook URL の秘密部分（最後のパスセグメント）だけを伏せて表示する。
 * 例: https://host/api/trackers/webhook/jira/<connId>/<secret> →
 *     https://host/api/trackers/webhook/jira/<connId>/••••••••
 * パスの形が想定外でも、末尾セグメントを丸める安全側のフォールバックにする。
 */
function maskWebhookUrl(url: string): string {
  const idx = url.lastIndexOf('/');
  if (idx < 0 || idx === url.length - 1) return '••••••••';
  return `${url.slice(0, idx + 1)}••••••••`;
}

export function TrackerConnectionsAdminPanel({
  projectId,
}: {
  projectId: string;
}) {
  const [connections, setConnections] = useState<TrackerConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 作成/編集フォーム
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 接続テスト状態（connectionId → 結果メッセージ）
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<
    Record<string, { kind: 'ok' | 'err'; text: string }>
  >({});

  // 取り込み（フル/差分）の起票・ポーリング
  const [active, setActive] = useState<ActiveImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const { job, polling } = useBackgroundJob(active?.jobId ?? null);

  // Webhook（接続ごと）の状態（url 取得・有効化/再生成/無効化・コピー）
  const [webhooks, setWebhooks] = useState<Record<string, WebhookState>>({});

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await trackersApi.list(projectId);
      setForbidden(false);
      setConnections(Array.isArray(data) ? data : []);
    } catch (err) {
      if (err instanceof TrackerApiError && err.status === 403) {
        setForbidden(true);
        setConnections([]);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'トラッカー接続一覧の取得に失敗しました',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchConnections();
  }, [fetchConnections]);

  // 取り込みジョブが終端（成功/失敗）に達したら一覧を更新（lastSyncedAt 等を反映）。
  useEffect(() => {
    if (job && isTerminalStatus(job.status)) {
      void fetchConnections();
    }
  }, [job, fetchConnections]);

  // 一覧取得後、まだ読み込んでいない接続の Webhook URL（有効/無効＝url=null）を取得する。
  useEffect(() => {
    let cancelled = false;
    for (const c of connections) {
      if (webhooks[c.id]?.loaded || webhooks[c.id]?.busy) continue;
      void trackersApi
        .getWebhookUrl(c.id)
        .then((res) => {
          if (cancelled) return;
          setWebhooks((prev) => ({
            ...prev,
            [c.id]: {
              ...initialWebhookState,
              ...prev[c.id],
              loaded: true,
              url: res.url,
              busy: false,
              loadError: false,
            },
          }));
        })
        .catch(() => {
          if (cancelled) return;
          // 取得失敗（ネットワーク / 一時的 5xx 等）を「無効」と誤表示しない。
          // loadError=true で「取得失敗」を表示し、本当に無効（url=null）と区別する。
          setWebhooks((prev) => ({
            ...prev,
            [c.id]: {
              ...initialWebhookState,
              ...prev[c.id],
              loaded: true,
              busy: false,
              loadError: true,
            },
          }));
        });
    }
    return () => {
      cancelled = true;
    };
    // webhooks を依存に含めると毎回ループするため connections のみで起動する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connections]);

  // ---- フォーム操作 ----
  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowForm(true);
  };

  const openEdit = (c: TrackerConnection) => {
    setEditingId(c.id);
    setForm({
      provider: c.provider,
      host: c.host,
      email: c.email ?? '',
      credential: '',
      projectKey: c.projectKey ?? '',
      autoSync: c.autoSync,
      syncIntervalMinutes: c.syncIntervalMinutes,
    });
    setFormError(null);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
  };

  const editing = editingId
    ? connections.find((c) => c.id === editingId)
    : null;
  const providerMeta = trackerProviderMeta(form.provider);

  const handleSave = async () => {
    const host = form.host.trim();
    const email = form.email.trim();
    const credential = form.credential;
    const projectKey = form.projectKey.trim();

    if (!host) {
      setFormError(`${providerMeta.hostLabel}は必須です`);
      return;
    }
    if (providerMeta.requiresEmail && !email) {
      setFormError('Jira 連携には認証メールアドレスが必要です');
      return;
    }
    // 新規作成時は credential 必須（更新時は空＝変更なし）
    if (!editingId && !credential) {
      setFormError(`${providerMeta.credentialLabel}は必須です`);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await trackersApi.update(editingId, {
          host,
          email: providerMeta.requiresEmail ? email : undefined,
          // 入力があったときだけ差し替え（空＝変更なし）
          ...(credential.length > 0 ? { credential } : {}),
          projectKey,
          autoSync: form.autoSync,
          syncIntervalMinutes: form.syncIntervalMinutes,
        });
      } else {
        await trackersApi.create(projectId, {
          provider: form.provider,
          host,
          email: providerMeta.requiresEmail ? email : undefined,
          credential,
          projectKey: projectKey || undefined,
          autoSync: form.autoSync,
          syncIntervalMinutes: form.syncIntervalMinutes,
        });
      }
      closeForm();
      await fetchConnections();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleAutoSync = async (c: TrackerConnection) => {
    const next = !c.autoSync;
    // 楽観的更新
    setConnections((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, autoSync: next } : x)),
    );
    try {
      await trackersApi.update(c.id, { autoSync: next });
    } catch {
      await fetchConnections();
    }
  };

  const handleIntervalBlur = async (c: TrackerConnection, value: string) => {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num <= 0) return;
    if (num === c.syncIntervalMinutes) return;
    setConnections((prev) =>
      prev.map((x) => (x.id === c.id ? { ...x, syncIntervalMinutes: num } : x)),
    );
    try {
      await trackersApi.update(c.id, { syncIntervalMinutes: num });
    } catch {
      await fetchConnections();
    }
  };

  const handleDelete = async (c: TrackerConnection) => {
    if (
      !confirm(
        `${trackerProviderLabel(c.provider)} 連携「${c.host}」を削除してもよろしいですか？`,
      )
    )
      return;
    try {
      await trackersApi.delete(c.id);
      setConnections((prev) => prev.filter((x) => x.id !== c.id));
      if (active?.connectionId === c.id) setActive(null);
    } catch (err) {
      console.error('Failed to delete tracker connection:', err);
      await fetchConnections();
    }
  };

  const handleTest = async (c: TrackerConnection) => {
    setTestingId(c.id);
    setTestMsg((prev) => {
      const next = { ...prev };
      delete next[c.id];
      return next;
    });
    try {
      const res: TrackerTestResult = await trackersApi.test(c.id);
      setTestMsg((prev) => ({
        ...prev,
        [c.id]: res.ok
          ? {
              kind: 'ok',
              text: res.detail
                ? `接続に成功しました（${res.detail}）`
                : '接続に成功しました',
            }
          : {
              kind: 'err',
              text: `接続に失敗しました${res.error ? `: ${res.error}` : ''}`,
            },
      }));
      // status が test 結果で更新されるため一覧をリフレッシュ
      await fetchConnections();
    } catch (err) {
      setTestMsg((prev) => ({
        ...prev,
        [c.id]: {
          kind: 'err',
          text: err instanceof Error ? err.message : '接続テストに失敗しました',
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleImport = async (c: TrackerConnection, mode: TrackerImportMode) => {
    setImportError(null);
    setActive(null);
    try {
      const res = await trackersApi.import(c.id, mode);
      setActive({ connectionId: c.id, jobId: res.jobId, mode });
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : '取り込みの起票に失敗しました',
      );
    }
  };

  // ---- Webhook 操作 ----
  const patchWebhook = (id: string, patch: Partial<WebhookState>) => {
    setWebhooks((prev) => ({
      ...prev,
      [id]: { ...initialWebhookState, ...prev[id], ...patch },
    }));
  };

  const runWebhookAction = async (
    id: string,
    action: () => Promise<{ url: string | null }>,
  ) => {
    patchWebhook(id, { busy: true, error: null, copied: false });
    try {
      const res = await action();
      patchWebhook(id, {
        url: res.url,
        busy: false,
        loaded: true,
        loadError: false,
      });
    } catch (err) {
      patchWebhook(id, {
        busy: false,
        error: err instanceof Error ? err.message : 'Webhook の操作に失敗しました',
      });
    }
  };

  const handleEnableWebhook = (c: TrackerConnection) =>
    runWebhookAction(c.id, () => trackersApi.enableWebhook(c.id));

  const handleRegenerateWebhook = (c: TrackerConnection) => {
    if (
      !confirm(
        'Webhook URL を再生成すると、現在の URL は無効になります。Jira/Backlog 側の設定も新しい URL に貼り替える必要があります。続行しますか？',
      )
    )
      return;
    void runWebhookAction(c.id, () => trackersApi.regenerateWebhook(c.id));
  };

  const handleDisableWebhook = (c: TrackerConnection) => {
    if (
      !confirm(
        'Webhook を無効化すると、この URL での受信は停止します。続行しますか？',
      )
    )
      return;
    void runWebhookAction(c.id, () => trackersApi.disableWebhook(c.id));
  };

  const handleCopyWebhookUrl = async (c: TrackerConnection) => {
    const url = webhooks[c.id]?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      patchWebhook(c.id, { copied: true });
      setTimeout(() => patchWebhook(c.id, { copied: false }), 2000);
    } catch {
      patchWebhook(c.id, { error: 'クリップボードへのコピーに失敗しました' });
    }
  };

  // 取り込み結果（job.result）の表示文言。
  const importResult = isTrackerImportResult(job?.result) ? job.result : null;

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-5 space-y-4">
        {/* ヘッダ */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <Plug className="h-5 w-5 text-gray-500" />
            課題トラッカー連携（Backlog / Jira）
            <HelpTooltip text="Backlog / Jira の課題を CSV を介さず Task へ取り込みます。「フル移行」で全件、「差分同期」で前回同期以降の更新分のみを取り込みます（再実行しても重複作成しない冪等動作）。自動同期をONにすると、背景エージェントが指定間隔で差分を取り込みます。取り込みの詳細・試行履歴はバッチ管理（種別 TRACKER_IMPORT）で確認できます。" />
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700">
              <ShieldAlert className="h-3 w-3" />
              管理者限定
            </span>
          </h2>
          {!forbidden && !loading && (
            <Button
              size="sm"
              onClick={openCreate}
              className="bg-blue-600 hover:bg-blue-700 gap-1.5"
            >
              <Plus className="h-4 w-4" />
              トラッカー連携を追加
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : forbidden ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <ShieldAlert className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-medium">管理者のみ</p>
              <p className="mt-0.5 text-amber-700">
                トラッカー連携の設定はプロジェクト管理者のみが行えます。
              </p>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {error}
              </div>
            )}

            {/* 取込の詳細案内（バッチ管理へのリンク） */}
            <p className="text-xs text-gray-500">
              取り込みの詳細・進捗・失敗時の自動リトライ（試行履歴）は、下の{' '}
              <a
                href="#batch-jobs"
                className="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline"
              >
                バックグラウンド処理 / バッチ管理
                <ExternalLink className="h-3 w-3" />
              </a>{' '}
              （種別{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">
                TRACKER_IMPORT
              </code>
              ）で確認できます。
            </p>

            {/* 作成/編集フォーム */}
            {showForm && (
              <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-4 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">
                  {editingId
                    ? 'トラッカー連携を編集'
                    : 'トラッカー連携を追加'}
                </h3>

                {/* プロバイダ選択（編集時は変更不可） */}
                <div className="space-y-1.5">
                  <Label className="text-gray-700">プロバイダ</Label>
                  {editingId ? (
                    <div className="text-sm text-gray-700">
                      {trackerProviderLabel(form.provider)}
                      <span className="ml-2 text-xs text-gray-400">
                        （プロバイダは作成後に変更できません）
                      </span>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {TRACKER_PROVIDERS.map((p) => (
                        <button
                          key={p.value}
                          type="button"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              provider: p.value,
                              // プロバイダ切替で email をクリア（Backlog は不要）
                              email: p.requiresEmail ? f.email : '',
                            }))
                          }
                          className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                            form.provider === p.value
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* host */}
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 flex items-center gap-1.5">
                      {providerMeta.hostLabel}{' '}
                      <span className="text-red-500">*</span>
                      <HelpTooltip text={providerMeta.hostHint} />
                    </Label>
                    <Input
                      placeholder={providerMeta.hostPlaceholder}
                      value={form.host}
                      onChange={(e) =>
                        setForm({ ...form, host: e.target.value })
                      }
                      className="bg-white border-gray-300 font-mono text-sm"
                    />
                  </div>

                  {/* projectKey */}
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 flex items-center gap-1.5">
                      プロジェクトキー（任意）
                      <HelpTooltip text="取り込み対象を1プロジェクトに絞る場合に指定します（例: IPLOT / ABC）。未指定の場合は接続権限のある課題が対象になります。" />
                    </Label>
                    <Input
                      placeholder="例: IPLOT"
                      value={form.projectKey}
                      onChange={(e) =>
                        setForm({ ...form, projectKey: e.target.value })
                      }
                      className="bg-white border-gray-300 font-mono text-sm"
                    />
                  </div>
                </div>

                {/* email（Jira のみ） */}
                {providerMeta.requiresEmail && (
                  <div className="space-y-1.5">
                    <Label className="text-gray-700 flex items-center gap-1.5">
                      認証メールアドレス{' '}
                      <span className="text-red-500">*</span>
                      <HelpTooltip text="Jira（Atlassian）の Basic 認証に使うアカウントのメールアドレス。API トークンと併用します。" />
                    </Label>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      value={form.email}
                      onChange={(e) =>
                        setForm({ ...form, email: e.target.value })
                      }
                      autoComplete="off"
                      className="bg-white border-gray-300"
                    />
                  </div>
                )}

                {/* credential（伏字運用） */}
                <div className="space-y-1.5">
                  <Label className="text-gray-700 flex items-center gap-1.5">
                    {providerMeta.credentialLabel}{' '}
                    {!editingId && <span className="text-red-500">*</span>}
                    <HelpTooltip text={providerMeta.credentialHint} />
                  </Label>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      editing?.hasCredential
                        ? '設定済み（変更する場合のみ入力）'
                        : `${providerMeta.credentialLabel}を入力`
                    }
                    value={form.credential}
                    onChange={(e) =>
                      setForm({ ...form, credential: e.target.value })
                    }
                    className="bg-white border-gray-300 font-mono"
                  />
                  <p className="text-xs text-gray-400">
                    保存後は値を表示できません（伏字運用）。
                    {editingId && '空のままなら変更されません。'}
                  </p>
                </div>

                {/* 自動同期 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={form.autoSync}
                      onChange={(next) =>
                        setForm({ ...form, autoSync: next })
                      }
                    />
                    <Label className="text-gray-700 flex items-center gap-1.5">
                      自動同期を有効にする
                      <HelpTooltip text="ONにすると、背景エージェントが指定した間隔（分）ごとに差分同期（前回同期以降の更新分）を自動で取り込みます。" />
                    </Label>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-gray-700">同期間隔（分）</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.syncIntervalMinutes}
                      disabled={!form.autoSync}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          syncIntervalMinutes:
                            parseInt(e.target.value, 10) || 0,
                        })
                      }
                      className="bg-white border-gray-300 disabled:opacity-50"
                    />
                  </div>
                </div>

                {formError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {formError}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={closeForm}>
                    キャンセル
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        保存中...
                      </>
                    ) : editingId ? (
                      '更新'
                    ) : (
                      '追加'
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* 一覧 */}
            {connections.length === 0 && !showForm ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
                  <Plug className="h-6 w-6 text-gray-400" />
                </div>
                <p className="text-sm text-gray-600">
                  登録済みのトラッカー連携はありません
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Backlog / Jira の課題を CSV なしで Task へ取り込めます
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {connections.map((c) => {
                  const isTesting = testingId === c.id;
                  const msg = testMsg[c.id];
                  const isActive = active?.connectionId === c.id;
                  const isImporting = isActive && polling;
                  return (
                    <div
                      key={c.id}
                      className="rounded-lg border border-gray-200 bg-white p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                              {trackerProviderLabel(c.provider)}
                            </span>
                            {c.projectKey && (
                              <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-mono text-gray-600">
                                {c.projectKey}
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium ${
                                c.status === 'error'
                                  ? 'border-red-200 bg-red-50 text-red-600'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {c.status === 'error' ? '接続エラー' : '正常'}
                            </span>
                            {c.autoSync && (
                              <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                                自動同期 {c.syncIntervalMinutes}分
                              </span>
                            )}
                          </div>
                          <p className="mt-1 break-all font-mono text-sm text-gray-700">
                            {c.host}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                            {c.email && (
                              <span className="break-all">{c.email}</span>
                            )}
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3.5 w-3.5" />
                              最終同期: {formatDateTime(c.lastSyncedAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-shrink-0 items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleTest(c)}
                            disabled={isTesting}
                            className="gap-1.5 border-gray-300 text-gray-700"
                            title="接続を確認します"
                          >
                            {isTesting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <PlugZap className="h-4 w-4" />
                            )}
                            接続テスト
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(c)}
                            className="h-9 w-9 p-0 text-gray-600"
                            title="編集"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(c)}
                            className="h-9 w-9 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                            title="削除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* 接続テスト結果 */}
                      {msg && (
                        <div
                          className={`mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-sm ${
                            msg.kind === 'ok'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-red-200 bg-red-50 text-red-700'
                          }`}
                        >
                          {msg.kind === 'ok' ? (
                            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          ) : (
                            <X className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          )}
                          <span className="break-all">{msg.text}</span>
                        </div>
                      )}

                      {/* 取り込み操作（フル移行 / 差分同期） */}
                      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg bg-gray-50 border border-gray-100 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleImport(c, 'full')}
                            disabled={isImporting}
                            className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                            title="対象の課題を全件取り込みます（冪等：再実行しても重複しません）"
                          >
                            {isImporting && active?.mode === 'full' ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <DownloadCloud className="h-4 w-4" />
                            )}
                            フル移行
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleImport(c, 'incremental')}
                            disabled={isImporting}
                            className="gap-1.5 border-gray-300 text-gray-700"
                            title="前回同期以降に更新された課題のみ取り込みます"
                          >
                            {isImporting && active?.mode === 'incremental' ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <GitCompareArrows className="h-4 w-4" />
                            )}
                            差分同期
                          </Button>
                        </div>

                        {/* 自動同期トグル */}
                        <div className="flex items-center gap-3">
                          <Toggle
                            checked={c.autoSync}
                            onChange={() => handleToggleAutoSync(c)}
                          />
                          <span className="text-sm text-gray-700 inline-flex items-center gap-1.5">
                            自動同期{' '}
                            <span
                              className={
                                c.autoSync
                                  ? 'text-blue-700 font-medium'
                                  : 'text-gray-400'
                              }
                            >
                              {c.autoSync ? 'ON' : 'OFF'}
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label className="text-sm text-gray-600">
                            同期間隔（分）
                          </Label>
                          <Input
                            type="number"
                            min={1}
                            defaultValue={c.syncIntervalMinutes}
                            disabled={!c.autoSync}
                            onBlur={(e) =>
                              handleIntervalBlur(c, e.target.value)
                            }
                            className="h-8 w-24 bg-white border-gray-300 disabled:opacity-50"
                          />
                        </div>
                      </div>

                      {/* 取り込み進捗 / 結果（この接続でアクティブな場合のみ） */}
                      {isActive && (
                        <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm">
                          <div className="flex items-center gap-2 text-gray-700">
                            {polling ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                                <span>
                                  {active.mode === 'full'
                                    ? 'フル移行'
                                    : '差分同期'}
                                  を実行中...（{job?.status ?? 'QUEUED'}）
                                </span>
                              </>
                            ) : job?.status === 'SUCCEEDED' ? (
                              <>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                <span className="font-medium text-emerald-800">
                                  取り込みが完了しました
                                </span>
                              </>
                            ) : job?.status === 'FAILED' ? (
                              <>
                                <AlertCircle className="h-4 w-4 text-red-600" />
                                <span className="font-medium text-red-700">
                                  取り込みに失敗しました
                                </span>
                              </>
                            ) : (
                              <span>取り込みを起票しました</span>
                            )}
                          </div>

                          {/* 進捗バー */}
                          {polling && typeof job?.progress === 'number' && (
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full bg-blue-500 transition-all"
                                style={{
                                  width: `${Math.min(100, Math.max(0, job.progress))}%`,
                                }}
                              />
                            </div>
                          )}

                          {/* 結果サマリ */}
                          {importResult && (
                            <p className="mt-2 text-gray-700">
                              取得 {importResult.fetched} 件 / 新規{' '}
                              {importResult.created} 件 / 更新{' '}
                              {importResult.updated} 件 / スキップ{' '}
                              {importResult.skipped} 件 / コメント{' '}
                              {importResult.commentsCreated} 件
                              {importResult.errors.length > 0 && (
                                <span className="ml-1 text-amber-700">
                                  （警告 {importResult.errors.length} 件）
                                </span>
                              )}
                            </p>
                          )}

                          {/* 失敗理由 */}
                          {job?.status === 'FAILED' && job.error && (
                            <p className="mt-2 break-all text-red-700">
                              {job.error}
                            </p>
                          )}

                          {/* 部分的なエラー（警告） */}
                          {importResult &&
                            importResult.errors.length > 0 && (
                              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-700">
                                {importResult.errors
                                  .slice(0, 5)
                                  .map((e, i) => (
                                    <li key={i} className="break-all">
                                      {e}
                                    </li>
                                  ))}
                                {importResult.errors.length > 5 && (
                                  <li>
                                    ほか {importResult.errors.length - 5} 件
                                  </li>
                                )}
                              </ul>
                            )}

                          <p className="mt-2 text-xs text-gray-400">
                            進捗・試行履歴の詳細は{' '}
                            <a
                              href="#batch-jobs"
                              className="text-blue-600 hover:underline"
                            >
                              バッチ管理（TRACKER_IMPORT）
                            </a>{' '}
                            で確認できます。
                          </p>
                        </div>
                      )}

                      {/* Webhook（インバウンド同期）節 */}
                      {(() => {
                        const wh = webhooks[c.id] ?? initialWebhookState;
                        const enabled = wh.url != null;
                        return (
                          <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-800">
                                <Webhook className="h-4 w-4 text-gray-500" />
                                Webhook（インバウンド同期）
                                <HelpTooltip text="Jira/Backlog で課題が作成/更新/削除されたとき、この URL に通知（Webhook）を送ると、該当の1課題だけを即座に取り込みます。有効化すると自動同期のポーリングは日次バックストップに間引かれます。" />
                                <span
                                  className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${
                                    enabled
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : wh.loadError
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-gray-200 bg-gray-50 text-gray-500'
                                  }`}
                                >
                                  {!wh.loaded
                                    ? '読み込み中…'
                                    : enabled
                                      ? '有効'
                                      : wh.loadError
                                        ? '取得失敗'
                                        : '無効'}
                                </span>
                              </span>

                              <div className="flex flex-shrink-0 items-center gap-1">
                                {enabled ? (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleRegenerateWebhook(c)}
                                      disabled={wh.busy}
                                      className="gap-1.5 border-gray-300 text-gray-700"
                                      title="新しい URL を発行します（現在の URL は無効化されます）"
                                    >
                                      {wh.busy ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-4 w-4" />
                                      )}
                                      URL 再生成
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleDisableWebhook(c)}
                                      disabled={wh.busy}
                                      className="gap-1.5 text-red-500 hover:bg-red-50 hover:text-red-600"
                                      title="Webhook 受信を無効化します"
                                    >
                                      <PowerOff className="h-4 w-4" />
                                      無効化
                                    </Button>
                                  </>
                                ) : (
                                  <Button
                                    size="sm"
                                    onClick={() => handleEnableWebhook(c)}
                                    disabled={wh.busy || !wh.loaded}
                                    className="bg-blue-600 hover:bg-blue-700 gap-1.5"
                                    title="Webhook を有効化し、受信用 URL を発行します"
                                  >
                                    {wh.busy ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Webhook className="h-4 w-4" />
                                    )}
                                    Webhook を有効化
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* URL コピー欄（有効時のみ）。秘密を含むため既定はマスクし、表示は明示操作で。 */}
                            {enabled && wh.url && (
                              <div className="mt-3 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <code className="min-w-0 flex-1 break-all rounded border border-gray-200 bg-white px-2 py-1.5 font-mono text-xs text-gray-700">
                                    {wh.revealed
                                      ? wh.url
                                      : maskWebhookUrl(wh.url)}
                                  </code>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      patchWebhook(c.id, {
                                        revealed: !wh.revealed,
                                      })
                                    }
                                    className="flex-shrink-0 gap-1.5 text-gray-600"
                                    title={
                                      wh.revealed
                                        ? '秘密を隠す'
                                        : '秘密を表示する'
                                    }
                                  >
                                    {wh.revealed ? (
                                      <>
                                        <EyeOff className="h-4 w-4" />
                                        隠す
                                      </>
                                    ) : (
                                      <>
                                        <Eye className="h-4 w-4" />
                                        表示
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleCopyWebhookUrl(c)}
                                    className="flex-shrink-0 gap-1.5 border-gray-300 text-gray-700"
                                    title="URL をコピー（表示せずにコピーできます）"
                                  >
                                    {wh.copied ? (
                                      <>
                                        <Check className="h-4 w-4 text-emerald-600" />
                                        コピー済み
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="h-4 w-4" />
                                        コピー
                                      </>
                                    )}
                                  </Button>
                                </div>
                                <p className="text-xs text-gray-500">
                                  この URL を Jira/Backlog の Webhook 設定に貼り付けてください（課題の作成/更新/削除イベント）。
                                  <span className="font-medium text-amber-700">
                                    {' '}
                                    URL には秘密が含まれます（既定では伏せています。「表示」せずそのままコピーできます）。
                                  </span>
                                </p>
                              </div>
                            )}

                            {/* 操作エラー */}
                            {wh.error && (
                              <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
                                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                                <span className="break-all">{wh.error}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 起票自体の失敗（ジョブが作れなかった場合） */}
            {importError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {importError}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
