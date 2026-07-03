'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GoogleSignInButton, isGoogleEnabled } from '@/components/auth/GoogleSignInButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';
const NAVY = '#050f3e';

export default function RegisterPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || '登録に失敗しました');
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'エラーが発生しました');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 text-gray-900">
      <div className="w-full max-w-sm bg-white border border-gray-200 rounded-2xl shadow-sm p-8">
        {/* ロゴ・プロダクト名 */}
        <div className="flex flex-col items-center mb-8 text-center">
          <span
            className="w-10 h-10 rounded-lg flex items-center justify-center text-white mb-3"
            style={{ backgroundColor: NAVY }}
          >
            <Database className="h-5 w-5" />
          </span>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: NAVY }}>
            Brain Pro
          </h1>
          <p className="mt-2 text-sm text-gray-500">新規登録</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-gray-700 text-sm">
              お名前
            </Label>
            <Input
              id="name"
              name="name"
              type="text"
              required
              autoFocus
              placeholder="山田 太郎"
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-gray-700 text-sm">
              メールアドレス
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              placeholder="you@example.com"
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-gray-700 text-sm">
              パスワード
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              placeholder="6文字以上"
              className="bg-white border-gray-300 text-gray-900"
            />
          </div>

          <Button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-full font-bold text-white hover:opacity-90"
            style={{ backgroundColor: NAVY }}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                登録中...
              </>
            ) : (
              'アカウントを作成'
            )}
          </Button>
        </form>

        {isGoogleEnabled && (
          <div className="mt-6">
            <div className="relative flex items-center justify-center">
              <span className="absolute inset-x-0 top-1/2 h-px bg-gray-200" />
              <span className="relative bg-white px-3 text-xs text-gray-400">または</span>
            </div>
            <div className="mt-4 flex justify-center">
              <GoogleSignInButton
                onAuthed={() => router.push('/dashboard')}
                onError={(msg) => setError(msg)}
              />
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-gray-500">
          すでにアカウントをお持ちの方は{' '}
          <Link href="/login" className="font-medium" style={{ color: '#2563eb' }}>
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
