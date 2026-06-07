'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Database, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021';
const NAVY = '#050f3e';

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || 'ログインに失敗しました');
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
            style={{ backgroundColor: NAVY }}
          >
            <Database className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight" style={{ color: NAVY }}>
            ai-data-flow
          </span>
        </Link>

        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 text-center mb-6">ログイン</h1>

          <form onSubmit={onSubmit} className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-600 text-sm">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-gray-700 text-sm">
                メールアドレス
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
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
                className="bg-white border-gray-300 text-gray-900"
              />
            </div>

            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ログイン中...
                </>
              ) : (
                'ログイン'
              )}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            アカウントをお持ちでない方は{' '}
            <Link href="/register" className="font-medium" style={{ color: '#2563eb' }}>
              新規登録
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
