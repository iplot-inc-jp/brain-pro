'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { invitesApi, type InvitePreview } from '@/lib/api';
import { GoogleSignInButton, isGoogleEnabled } from '@/components/auth/GoogleSignInButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';
const NAVY = '#050f3e';

const REASON_TEXT: Record<string, string> = {
  notfound: 'この招待リンクは存在しません。',
  revoked: 'この招待リンクは無効化されています。',
  expired: 'この招待リンクは有効期限が切れています。',
  maxed: 'この招待リンクは利用上限に達しています。',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-gray-900">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        <div className="flex flex-col items-center mb-6 text-center">
          <span className="w-10 h-10 rounded-lg flex items-center justify-center text-white mb-3" style={{ backgroundColor: NAVY }}>
            <Database className="h-5 w-5" />
          </span>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: NAVY }}>Brain Pro</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = Array.isArray(params?.token) ? params.token[0] : ((params?.token as string) ?? '');

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [hasToken, setHasToken] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setHasToken(Boolean(localStorage.getItem('accessToken')));
    invitesApi
      .preview(token)
      .then(setPreview)
      .catch(() => setPreview({ valid: false, reason: 'notfound', organizationName: null, role: null }))
      .finally(() => setLoadingPreview(false));
  }, [token]);

  // 認証後に招待を受理して会社へ
  async function acceptAndGo() {
    setBusy(true);
    setError('');
    try {
      const { organizationId } = await invitesApi.accept(token);
      localStorage.setItem('selectedOrganizationId', organizationId);
      router.push('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : '参加に失敗しました');
      setBusy(false);
    }
  }

  // メアドで login or register → accept
  async function onEmailSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const email = fd.get('email') as string;
    const password = fd.get('password') as string;
    const name = (fd.get('name') as string) || undefined;
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'login' ? { email, password } : { email, password, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || '認証に失敗しました');
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      await acceptAndGo();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
      setBusy(false);
    }
  }

  if (loadingPreview) {
    return (
      <Shell>
        <div className="flex justify-center py-6 text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Shell>
    );
  }

  if (!preview || !preview.valid) {
    return (
      <Shell>
        <p className="text-center text-sm text-red-600">
          {REASON_TEXT[preview?.reason ?? 'notfound'] ?? '無効な招待リンクです。'}
        </p>
        <p className="mt-6 text-center text-sm text-gray-500">
          <Link href="/login" className="font-medium" style={{ color: '#2563eb' }}>ログインへ</Link>
        </p>
      </Shell>
    );
  }

  // 有効な招待
  return (
    <Shell>
      <p className="mb-5 text-center text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{preview.organizationName}</span> に招待されています
      </p>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
      )}

      {hasToken ? (
        <div className="space-y-3">
          <Button
            onClick={acceptAndGo}
            disabled={busy}
            className="w-full rounded-full font-bold text-white hover:opacity-90"
            style={{ backgroundColor: NAVY }}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            ログイン中のアカウントで参加する
          </Button>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('accessToken');
              setHasToken(false);
            }}
            className="w-full text-center text-xs text-gray-500 hover:text-gray-700"
          >
            別のアカウントでログインする
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {isGoogleEnabled && (
            <>
              <div className="flex justify-center">
                <GoogleSignInButton
                  inviteToken={token}
                  onAuthed={(d) => {
                    if (d.joinedOrganizationId) {
                      localStorage.setItem('selectedOrganizationId', d.joinedOrganizationId);
                    }
                    router.push('/dashboard');
                  }}
                  onError={(msg) => setError(msg)}
                />
              </div>
              <div className="relative flex items-center justify-center">
                <span className="absolute inset-x-0 top-1/2 h-px bg-gray-200" />
                <span className="relative bg-white px-3 text-xs text-gray-400">または</span>
              </div>
            </>
          )}

          <form onSubmit={onEmailSubmit} className="space-y-3">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-gray-700 text-sm">お名前</Label>
                <Input id="name" name="name" type="text" required placeholder="山田 太郎" className="bg-white border-gray-300 text-gray-900" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-gray-700 text-sm">メールアドレス</Label>
              <Input id="email" name="email" type="email" required placeholder="you@example.com" className="bg-white border-gray-300 text-gray-900" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-gray-700 text-sm">パスワード</Label>
              <Input id="password" name="password" type="password" required minLength={mode === 'register' ? 8 : 1} placeholder={mode === 'register' ? '8文字以上' : ''} className="bg-white border-gray-300 text-gray-900" />
            </div>
            <Button type="submit" disabled={busy} className="w-full rounded-full font-bold text-white hover:opacity-90" style={{ backgroundColor: NAVY }}>
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {mode === 'login' ? 'ログインして参加' : '登録して参加'}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500">
            {mode === 'login' ? (
              <>アカウントが無い方は{' '}
                <button type="button" onClick={() => setMode('register')} className="font-medium" style={{ color: '#2563eb' }}>新規登録</button>
              </>
            ) : (
              <>すでにアカウントをお持ちの方は{' '}
                <button type="button" onClick={() => setMode('login')} className="font-medium" style={{ color: '#2563eb' }}>ログイン</button>
              </>
            )}
          </p>
        </div>
      )}
    </Shell>
  );
}
