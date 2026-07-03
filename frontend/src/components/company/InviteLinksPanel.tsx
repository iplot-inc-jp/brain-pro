'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2, Plus, Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invitesApi, type InviteView } from '@/lib/api';
import { COMPANY_ROLE_OPTIONS, companyRoleLabel } from '@/lib/roles';

const ROLE_OPTIONS = COMPANY_ROLE_OPTIONS;

function inviteUrl(token: string): string {
  if (typeof window === 'undefined') return `/invite/${token}`;
  return `${window.location.origin}/invite/${token}`;
}

/**
 * 会社の招待リンク管理パネル（発行・一覧・コピー・無効化）。
 */
export function InviteLinksPanel({ orgId }: { orgId: string }) {
  const [invites, setInvites] = useState<InviteView[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState('MEMBER');
  const [expiresInDays, setExpiresInDays] = useState('7');
  const [maxUses, setMaxUses] = useState('');
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      setInvites(await invitesApi.list(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setCreating(true);
    setError('');
    try {
      await invitesApi.create(orgId, {
        role,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        maxUses: maxUses ? Number(maxUses) : undefined,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '発行に失敗しました');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError('');
    try {
      await invitesApi.revoke(orgId, id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '無効化に失敗しました');
    }
  }

  async function copy(token: string, id: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setError('クリップボードへのコピーに失敗しました');
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-foreground">招待リンク</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        リンクを知っている人は誰でもこの会社に参加できます。期限・利用上限を設定し、不要になったら無効化してください。
      </p>

      {error && (
        <div className="p-2 rounded bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
      )}

      {/* 発行フォーム */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">ロール</Label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">有効日数（空=無期限）</Label>
          <Input type="number" min={1} value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">最大利用回数（空=無制限）</Label>
          <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </div>
        <Button onClick={create} disabled={creating} className="gap-1">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          発行
        </Button>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex justify-center py-4 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : invites.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">招待リンクはまだありません。</p>
      ) : (
        <ul className="space-y-2">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className={'inline-block rounded px-2 py-0.5 text-xs ' + (inv.valid ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500')}>
                {inv.revoked ? '無効' : inv.valid ? '有効' : '失効'}
              </span>
              <span className="rounded bg-secondary px-2 py-0.5 text-xs">{companyRoleLabel(inv.role)}</span>
              <span className="text-xs text-muted-foreground">
                {inv.expiresAt ? `期限: ${new Date(inv.expiresAt).toLocaleDateString('ja-JP')}` : '無期限'} ・ {inv.maxUses != null ? `${inv.useCount}/${inv.maxUses}` : `${inv.useCount}回`}
              </span>
              <div className="flex-1" />
              <button onClick={() => copy(inv.token, inv.id)} title="リンクをコピー" className="p-1.5 rounded hover:bg-secondary text-muted-foreground">
                {copiedId === inv.id ? <span className="text-xs text-green-600">コピー済</span> : <Copy className="h-4 w-4" />}
              </button>
              {!inv.revoked && (
                <button onClick={() => revoke(inv.id)} title="無効化" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
