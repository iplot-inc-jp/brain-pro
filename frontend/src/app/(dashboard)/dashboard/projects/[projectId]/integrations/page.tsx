'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ChevronLeft,
  Github,
  Plus,
  Loader2,
  Trash2,
  RefreshCw,
  History,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  GitCommit,
  Sparkles,
} from 'lucide-react';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { HowToPanel } from '@/components/ui/how-to-panel';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useTableSort } from '@/lib/use-table-sort';
import { SortableTh } from '@/components/ui/sortable-th';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';

// ---- 型定義 ----
type GithubConnection = {
  id: string;
  projectId: string;
  repoFullName: string;
  branch: string | null;
  autoSync: boolean;
  syncIntervalMinutes: number | null;
  lastSyncedSha: string | null;
  lastSyncedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type SyncStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';
type SyncTrigger = 'MANUAL' | 'AUTO';

type SyncSummary = {
  apis?: number;
  tables?: number;
  statuses?: number;
  roles?: number;
} | null;

type SyncRun = {
  id: string;
  status: SyncStatus;
  trigger: SyncTrigger;
  commitSha: string | null;
  summary: SyncSummary;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

// ---- ステータスバッジのメタ ----
const statusMeta: Record<SyncStatus, { label: string; badge: string }> = {
  PENDING: { label: 'PENDING', badge: 'text-gray-600 bg-gray-50 border-gray-300' },
  RUNNING: { label: 'RUNNING', badge: 'text-blue-700 bg-blue-50 border-blue-300' },
  SUCCESS: { label: 'SUCCESS', badge: 'text-emerald-700 bg-emerald-50 border-emerald-300' },
  FAILED: { label: 'FAILED', badge: 'text-red-700 bg-red-50 border-red-300' },
};

const triggerMeta: Record<SyncTrigger, { label: string; badge: string }> = {
  MANUAL: { label: 'MANUAL', badge: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
  AUTO: { label: 'AUTO', badge: 'text-amber-700 bg-amber-50 border-amber-200' },
};

// ---- ユーティリティ ----
function shortSha(sha: string | null): string {
  if (!sha) return '—';
  return sha.length > 7 ? sha.slice(0, 7) : sha;
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

function summaryText(summary: SyncSummary): string {
  if (!summary) return '—';
  const parts: string[] = [];
  if (typeof summary.apis === 'number') parts.push(`API ${summary.apis}`);
  if (typeof summary.tables === 'number') parts.push(`テーブル ${summary.tables}`);
  if (typeof summary.statuses === 'number') parts.push(`ステータス ${summary.statuses}`);
  if (typeof summary.roles === 'number') parts.push(`ロール ${summary.roles}`);
  return parts.length > 0 ? parts.join(' / ') : '—';
}

// 簡易トグルスイッチ（switch コンポーネントが無いためインライン実装）
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

// ---- 実行履歴テーブル ----
// 日時文字列をソート用の数値（エポックms）に変換する。未設定・不正値は null（末尾送り）。
function dateSortValue(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

// ヘッダーソート用 accessor（表示用の派生値で比較する）。
// 操作列は無いため全列をソート対象にできる。モジュール定数なのでレンダー毎に再生成されない。
const RUN_SORT_ACCESSORS: Record<string, (run: SyncRun) => string | number | null | undefined> = {
  status: (run) => (statusMeta[run.status] ?? statusMeta.PENDING).label,
  trigger: (run) => (triggerMeta[run.trigger] ?? triggerMeta.MANUAL).label,
  commit: (run) => (run.commitSha ? shortSha(run.commitSha) : null),
  summary: (run) => {
    // 表示と同じく FAILED 時はエラー文言、それ以外は抽出サマリ文字列で比較
    const text = run.status === 'FAILED' && run.error ? run.error : summaryText(run.summary);
    return text === '—' ? null : text;
  },
  startedAt: (run) => dateSortValue(run.startedAt),
  finishedAt: (run) => dateSortValue(run.finishedAt),
};

// 同期実行履歴の小テーブル。連携カードごとに描画されるため、
// ソート状態（useTableSort）をカード単位で持てるよう子コンポーネントに切り出している。
// ソート解除時は API が返した従来の並びに戻る。
function SyncRunsTable({ runs }: { runs: SyncRun[] }) {
  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(runs, RUN_SORT_ACCESSORS);
  const thClass = 'font-medium border-b border-gray-200';
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-600">
            <SortableTh
              label="状態"
              sortKey="status"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[110px]`}
            >
              <HelpTooltip text="同期実行の状態。PENDING（待機）→RUNNING（実行中）→SUCCESS（成功）またはFAILED（失敗）。FAILED時は抽出結果欄にエラー内容が表示されます。" />
            </SortableTh>
            <SortableTh
              label="トリガー"
              sortKey="trigger"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[100px]`}
            />
            <SortableTh
              label="コミット"
              sortKey="commit"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[100px]`}
            />
            <SortableTh
              label="抽出結果"
              sortKey="summary"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={thClass}
            />
            <SortableTh
              label="開始"
              sortKey="startedAt"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[150px]`}
            />
            <SortableTh
              label="完了"
              sortKey="finishedAt"
              current={sortKey}
              dir={sortDir}
              onToggle={toggleSort}
              className={`${thClass} w-[150px]`}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((run) => {
            const sm = statusMeta[run.status] ?? statusMeta.PENDING;
            const tm = triggerMeta[run.trigger] ?? triggerMeta.MANUAL;
            return (
              <tr
                key={run.id}
                className="border-b border-gray-100 hover:bg-gray-50/60 align-top"
              >
                <td className="px-3 py-2">
                  <span
                    className={`inline-block text-xs px-2 py-0.5 rounded border font-medium ${sm.badge}`}
                  >
                    {sm.label}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block text-xs px-2 py-0.5 rounded border ${tm.badge}`}
                  >
                    {tm.label}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-gray-700">
                  {shortSha(run.commitSha)}
                </td>
                <td className="px-3 py-2 text-gray-700">
                  {run.status === 'FAILED' && run.error ? (
                    <span className="inline-flex items-start gap-1 text-red-600">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span className="break-all">{run.error}</span>
                    </span>
                  ) : (
                    summaryText(run.summary)
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  {formatDateTime(run.startedAt)}
                </td>
                <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                  {formatDateTime(run.finishedAt)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function IntegrationsPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [connections, setConnections] = useState<GithubConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 作成フォーム
  const [showCreate, setShowCreate] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // キーボードショートカット
  // - mod+Enter / n : リポジトリ連携フォームを開く
  // - mod+s         : 既定の保存挙動を抑止（同期間隔は blur で自動保存されるため）
  // - shift+/（?）   : 操作方法ダイアログを開く
  useKeyboardShortcuts([
    { combo: 'mod+enter', handler: () => setShowCreate(true) },
    { combo: 'n', handler: () => setShowCreate(true) },
    { combo: 'mod+s', handler: () => { /* blur で自動保存。ブラウザ保存ダイアログを抑止 */ }, whenTyping: true },
    { combo: 'shift+/', handler: () => setHowToOpen(true) },
  ]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [form, setForm] = useState({
    repoFullName: '',
    branch: 'main',
    token: '',
    autoSync: false,
    syncIntervalMinutes: 60,
  });

  // 同期中の接続ID
  const [syncingId, setSyncingId] = useState<string | null>(null);
  // 同期結果サマリ（接続IDごと）
  const [syncResult, setSyncResult] = useState<Record<string, string>>({});

  // 実行履歴の展開状態
  const [openRunsId, setOpenRunsId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, SyncRun[]>>({});
  const [runsLoading, setRunsLoading] = useState<string | null>(null);

  const getHeaders = useCallback(() => {
    const token = localStorage.getItem('accessToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, []);

  const fetchConnections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/github-connections`, {
        headers: getHeaders(),
      });
      if (res.ok) {
        const data: GithubConnection[] = await res.json();
        setConnections(Array.isArray(data) ? data : []);
      } else {
        setError('連携一覧の取得に失敗しました');
      }
    } catch (err) {
      console.error('Failed to fetch github connections:', err);
      setError('エラーが発生しました');
    } finally {
      setLoading(false);
    }
  }, [projectId, getHeaders]);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  // ---- 作成 ----
  const handleCreate = async () => {
    if (!form.repoFullName.trim() || !form.token.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_URL}/api/projects/${projectId}/github-connections`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          repoFullName: form.repoFullName.trim(),
          branch: form.branch.trim() || undefined,
          token: form.token,
          autoSync: form.autoSync,
          syncIntervalMinutes: form.autoSync ? form.syncIntervalMinutes : undefined,
        }),
      });
      if (res.ok) {
        await fetchConnections();
        setShowCreate(false);
        setForm({
          repoFullName: '',
          branch: 'main',
          token: '',
          autoSync: false,
          syncIntervalMinutes: 60,
        });
      } else {
        const data = await res.json().catch(() => null);
        setCreateError(
          (data && (Array.isArray(data.message) ? data.message.join(' / ') : data.message)) ||
            '連携の作成に失敗しました',
        );
      }
    } catch (err) {
      console.error('Failed to create connection:', err);
      setCreateError('エラーが発生しました');
    } finally {
      setCreating(false);
    }
  };

  // ---- 部分更新（PUT） ----
  const patchConnection = async (id: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`${API_URL}/api/github-connections/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const updated: GithubConnection = await res.json();
        setConnections((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
      } else {
        await fetchConnections();
      }
    } catch (err) {
      console.error('Failed to update connection:', err);
      await fetchConnections();
    }
  };

  const handleToggleAutoSync = (conn: GithubConnection) => {
    const next = !conn.autoSync;
    // 楽観的更新
    setConnections((prev) =>
      prev.map((c) => (c.id === conn.id ? { ...c, autoSync: next } : c)),
    );
    patchConnection(conn.id, {
      autoSync: next,
      syncIntervalMinutes: conn.syncIntervalMinutes ?? 60,
    });
  };

  const handleIntervalBlur = (conn: GithubConnection, value: string) => {
    const num = parseInt(value, 10);
    if (Number.isNaN(num) || num <= 0) return;
    if (num === conn.syncIntervalMinutes) return;
    setConnections((prev) =>
      prev.map((c) => (c.id === conn.id ? { ...c, syncIntervalMinutes: num } : c)),
    );
    patchConnection(conn.id, { syncIntervalMinutes: num });
  };

  // ---- 手動同期 ----
  const handleSync = async (conn: GithubConnection) => {
    setSyncingId(conn.id);
    setSyncResult((prev) => {
      const next = { ...prev };
      delete next[conn.id];
      return next;
    });
    try {
      const res = await fetch(`${API_URL}/api/github-connections/${conn.id}/sync`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (res.ok) {
        const run: SyncRun = await res.json().catch(() => null);
        if (run && run.summary) {
          setSyncResult((prev) => ({ ...prev, [conn.id]: summaryText(run.summary) }));
        } else if (run && run.status === 'FAILED' && run.error) {
          setSyncResult((prev) => ({ ...prev, [conn.id]: `失敗: ${run.error}` }));
        } else {
          setSyncResult((prev) => ({ ...prev, [conn.id]: '同期を実行しました' }));
        }
        await fetchConnections();
        // 履歴が開いていれば再取得
        if (openRunsId === conn.id) await fetchRuns(conn.id);
      } else {
        const data = await res.json().catch(() => null);
        setSyncResult((prev) => ({
          ...prev,
          [conn.id]:
            `同期に失敗しました${data && data.message ? `: ${data.message}` : ''}`,
        }));
      }
    } catch (err) {
      console.error('Failed to sync:', err);
      setSyncResult((prev) => ({ ...prev, [conn.id]: '同期中にエラーが発生しました' }));
    } finally {
      setSyncingId(null);
    }
  };

  // ---- 実行履歴 ----
  const fetchRuns = useCallback(
    async (id: string) => {
      setRunsLoading(id);
      try {
        const res = await fetch(`${API_URL}/api/github-connections/${id}/runs`, {
          headers: getHeaders(),
        });
        if (res.ok) {
          const data: SyncRun[] = await res.json();
          setRuns((prev) => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
        } else {
          setRuns((prev) => ({ ...prev, [id]: [] }));
        }
      } catch (err) {
        console.error('Failed to fetch runs:', err);
        setRuns((prev) => ({ ...prev, [id]: [] }));
      } finally {
        setRunsLoading(null);
      }
    },
    [getHeaders],
  );

  const handleToggleRuns = (conn: GithubConnection) => {
    if (openRunsId === conn.id) {
      setOpenRunsId(null);
      return;
    }
    setOpenRunsId(conn.id);
    fetchRuns(conn.id);
  };

  // ---- 削除 ----
  const handleDelete = async (conn: GithubConnection) => {
    if (!confirm(`リポジトリ連携「${conn.repoFullName}」を削除してもよろしいですか？`)) return;
    try {
      const res = await fetch(`${API_URL}/api/github-connections/${conn.id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (res.ok || res.status === 204) {
        setConnections((prev) => prev.filter((c) => c.id !== conn.id));
        if (openRunsId === conn.id) setOpenRunsId(null);
      }
    } catch (err) {
      console.error('Failed to delete connection:', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/dashboard/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="text-gray-600">
              <ChevronLeft className="w-4 h-4 mr-1" />
              戻る
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Github className="w-7 h-7 text-blue-600" />
              コード連携（GitHub）
              <HelpTooltip text="連携したリポジトリのコードをAIが解析し、API・テーブル・ステータス・ロールを抽出して、API×ロール権限表やテーブル状態×ロール（ステータス×ロール）マトリクスへ自動反映します。" />
            </h1>
            <p className="text-gray-500 mt-1">
              ソースコードを解析し、API・テーブル・ステータス・ロールを各マトリクスへ自動反映します。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <HowToPanel
            open={howToOpen}
            onOpenChange={setHowToOpen}
            steps={[
              '「リポジトリ連携」で owner/repo・ブランチ・Personal Access Token を入力して連携します。',
              'PAT は repo 読み取り権限のあるトークンを使用します（プライベートリポジトリの読み取り用）。',
              '「今すぐ同期」でコードを解析し、API・テーブル・ステータス・ロール（CRUD権限の元データ）を抽出します。',
              '「自動同期」をONにすると、背景エージェントが指定間隔で commit を監視し、変更を検知するたびに同期します。',
              '「実行履歴」で過去の同期の状態（PENDING/RUNNING/SUCCESS/FAILED）や抽出結果を確認できます。',
            ]}
            shortcuts={[
              { keys: '⌘/Ctrl+Enter', desc: 'リポジトリ連携フォームを開く' },
              { keys: 'n', desc: 'リポジトリ連携フォームを開く' },
              { keys: '⌘/Ctrl+S', desc: '保存（同期間隔は blur で自動保存）' },
              { keys: '?', desc: 'この操作方法を開く' },
            ]}
          />
          <Button onClick={() => setShowCreate((v) => !v)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" />
            リポジトリ連携
          </Button>
        </div>
      </div>

      {/* 説明バナー */}
      <Card className="bg-blue-50/50 border-blue-200">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-700 leading-relaxed">
              <p className="font-medium text-gray-900 mb-1">コードからマトリクスを自動生成</p>
              <p>
                連携したリポジトリのコードから、AIが
                <span className="font-semibold text-blue-700">API・テーブル・ステータス・ロール</span>
                を抽出し、<span className="font-semibold">API×ロール</span>権限表や
                <span className="font-semibold">テーブル状態×ロール</span>マトリクスへ反映します。
                自動同期を有効にすると、背景エージェントが対象ブランチの commit
                を監視して、変更を検知するたびに同期を実行します。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 作成フォーム */}
      {showCreate && (
        <Card className="bg-white border-gray-200">
          <CardContent className="p-5 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Github className="h-5 w-5 text-blue-600" />
              リポジトリ連携を追加
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-gray-700">
                  リポジトリ <span className="text-red-500">*</span>
                </Label>
                <Input
                  placeholder="owner/repo"
                  value={form.repoFullName}
                  onChange={(e) => setForm({ ...form, repoFullName: e.target.value })}
                  className="bg-white border-gray-300"
                />
                <p className="text-xs text-gray-400">例: my-org/backend-api</p>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">ブランチ</Label>
                <Input
                  placeholder="main"
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  className="bg-white border-gray-300"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-700 flex items-center gap-1.5">
                Personal Access Token <span className="text-red-500">*</span>
                <HelpTooltip text="GitHubの個人アクセストークン。リポジトリのコードを読み取るために使います。repo 読み取り権限のあるトークンを入力してください。" />
              </Label>
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
                autoComplete="off"
                className="bg-white border-gray-300 font-mono"
              />
              <p className="text-xs text-gray-400">
                プライベートリポジトリの読み取りに使用します。repo 読み取り権限のあるトークンを入力してください。
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="flex items-center gap-3">
                <Toggle
                  checked={form.autoSync}
                  onChange={(next) => setForm({ ...form, autoSync: next })}
                />
                <Label className="text-gray-700">自動同期を有効にする</Label>
              </div>
              <div className="space-y-2">
                <Label className="text-gray-700">同期間隔（分）</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.syncIntervalMinutes}
                  disabled={!form.autoSync}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      syncIntervalMinutes: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="bg-white border-gray-300 disabled:opacity-50"
                />
              </div>
            </div>

            {createError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {createError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                キャンセル
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!form.repoFullName.trim() || !form.token.trim() || creating}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    連携中...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    連携する
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 本体 */}
      {loading ? (
        <div className="flex items-center justify-center h-[300px]">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <p className="text-red-600 mb-4">{error}</p>
            <Button variant="outline" onClick={fetchConnections}>
              再読み込み
            </Button>
          </CardContent>
        </Card>
      ) : connections.length === 0 ? (
        <Card className="bg-white border-gray-200">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <Github className="h-8 w-8 text-gray-400" />
            </div>
            <p className="text-gray-700 font-medium mb-2">連携中のリポジトリがありません</p>
            <p className="text-sm text-gray-500 mb-4">
              リポジトリを連携すると、コードからマトリクスを自動生成できます。
            </p>
            <Button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              最初のリポジトリを連携
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {connections.map((conn) => {
            const isSyncing = syncingId === conn.id;
            const result = syncResult[conn.id];
            const runsOpen = openRunsId === conn.id;
            const connRuns = runs[conn.id] ?? [];
            return (
              <Card key={conn.id} className="bg-white border-gray-200">
                <CardContent className="p-5">
                  {/* 上段: リポジトリ情報 + 操作 */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Github className="h-5 w-5 text-gray-700 flex-shrink-0" />
                        <span className="font-semibold text-gray-900 font-mono truncate">
                          {conn.repoFullName}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-gray-200 bg-gray-50 text-gray-600">
                          <GitCommit className="h-3 w-3" />
                          {conn.branch || 'main'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <GitCommit className="h-3.5 w-3.5" />
                          最終同期コミット:{' '}
                          <span className="font-mono text-gray-700">
                            {shortSha(conn.lastSyncedSha)}
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          最終同期: {formatDateTime(conn.lastSyncedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleSync(conn)}
                        disabled={isSyncing}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        {isSyncing ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                            同期中...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-1.5" />
                            今すぐ同期
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleToggleRuns(conn)}
                        className="border-gray-300 text-gray-700"
                      >
                        <History className="h-4 w-4 mr-1.5" />
                        実行履歴
                        {runsOpen ? (
                          <ChevronDown className="h-4 w-4 ml-1" />
                        ) : (
                          <ChevronRight className="h-4 w-4 ml-1" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(conn)}
                        className="h-9 w-9 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                        title="連携を削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {/* 同期結果サマリ */}
                  {result && (
                    <div className="mt-3 flex items-center gap-2 text-sm p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800">
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                      <span>同期結果: {result}</span>
                    </div>
                  )}

                  {/* 中段: 自動同期設定 */}
                  <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-3">
                      <Toggle
                        checked={conn.autoSync}
                        onChange={() => handleToggleAutoSync(conn)}
                      />
                      <span className="text-sm text-gray-700 inline-flex items-center gap-1.5">
                        自動同期{' '}
                        <span
                          className={
                            conn.autoSync ? 'text-blue-700 font-medium' : 'text-gray-400'
                          }
                        >
                          {conn.autoSync ? 'ON' : 'OFF'}
                        </span>
                        <HelpTooltip text="ONにすると、背景エージェントが指定した間隔（分）ごとに対象ブランチの commit を監視し、変更があれば自動で再同期します。" />
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-gray-600">同期間隔（分）</Label>
                      <Input
                        type="number"
                        min={1}
                        defaultValue={conn.syncIntervalMinutes ?? 60}
                        disabled={!conn.autoSync}
                        onBlur={(e) => handleIntervalBlur(conn, e.target.value)}
                        className="h-8 w-24 bg-white border-gray-300 disabled:opacity-50"
                      />
                    </div>
                    {conn.autoSync && (
                      <span className="text-xs text-gray-400">
                        背景エージェントが {conn.syncIntervalMinutes ?? 60} 分ごとに commit を監視します
                      </span>
                    )}
                  </div>

                  {/* 下段: 実行履歴テーブル */}
                  {runsOpen && (
                    <div className="mt-4 border-t border-gray-100 pt-4">
                      {runsLoading === conn.id ? (
                        <div className="flex items-center justify-center py-6 text-gray-400">
                          <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          履歴を読み込み中...
                        </div>
                      ) : connRuns.length === 0 ? (
                        <p className="py-4 text-sm text-gray-400 text-center">
                          実行履歴はまだありません。
                        </p>
                      ) : (
                        <SyncRunsTable runs={connRuns} />
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
