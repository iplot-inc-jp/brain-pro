'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, PlugZap, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { iproBotApi, type IproBotConnectionView } from '@/lib/api';

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

export function IproBotPanel({ orgId }: { orgId: string }) {
  const [view, setView] = useState<IproBotConnectionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [strict, setStrict] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const v = await iproBotApi.get(orgId);
      setView(v);
      setBaseUrl(v.baseUrl ?? '');
      setEnabled(v.enabled ?? true);
      setStrict(v.strict ?? false);
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '読み込みに失敗しました' });
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const v = await iproBotApi.update(orgId, {
        baseUrl,
        ...(apiToken.length > 0 ? { apiToken } : {}),
        enabled,
        strict,
      });
      setView(v);
      setApiToken('');
      setMsg({ kind: 'ok', text: '保存しました' });
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '保存に失敗しました' });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setMsg(null);
    try {
      const res = await iproBotApi.test(orgId);
      setMsg(
        res.ok
          ? { kind: 'ok', text: `接続に成功しました（${res.detail ?? ''}）` }
          : { kind: 'err', text: `接続に失敗しました${res.error ? `: ${res.error}` : ''}` },
      );
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : '接続テストに失敗しました' });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-gray-500" />
        <h3 className="font-semibold text-gray-900">ipro-bot連携（AIゲートウェイ）</h3>
      </div>
      <p className="text-sm text-gray-500">
        有効にすると、この会社のプロジェクトのAI機能（要求定義・課題提案・KPI生成など）が ipro-bot
        経由で実行され、IPLoT頭脳（skill）とAI予算管理が適用されます。
      </p>

      {msg && (
        <div
          className={`flex items-start gap-2 rounded-lg border p-2.5 text-sm ${
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

      <div className="space-y-1.5">
        <Label className="text-gray-700">ゲートウェイURL</Label>
        <Input
          placeholder="https://ipro-bot.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="bg-white border-gray-300"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-gray-700">APIトークン（aig_...）</Label>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder={view?.hasApiToken ? '設定済み（変更する場合のみ入力）' : 'aig_ トークンを入力'}
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          className="bg-white border-gray-300 font-mono"
        />
        <p className="text-xs text-gray-400">
          保存後は値を表示できません（伏字運用）。{view?.hasApiToken && '空のままなら変更されません。'}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-gray-700">連携を有効にする</Label>
          <p className="text-xs text-gray-400">OFFにすると従来どおり直接Anthropicを呼びます</p>
        </div>
        <Toggle checked={enabled} onChange={setEnabled} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-gray-700">厳格モード</Label>
          <p className="text-xs text-gray-400">
            ゲートウェイ障害時に直接Anthropicへフォールバックせずエラーにします
          </p>
        </div>
        <Toggle checked={strict} onChange={setStrict} />
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={save}
          disabled={saving || !baseUrl}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          保存
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={testing || !view?.configured}
          title="ipro-bot の /api/ai/health への到達とトークンを確認します"
          className="gap-1.5 border-gray-300 text-gray-700"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          接続テスト
        </Button>
      </div>
    </div>
  );
}
