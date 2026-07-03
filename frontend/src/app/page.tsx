'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

// 認証はクライアント側（localStorage の accessToken）で管理しているため、
// ルートはサーバーではログイン状態を判定できない。クライアントでトークンの有無を見て
// 振り分ける（ログイン済み→/dashboard、未ログイン→/login）。
export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token =
      typeof window !== 'undefined'
        ? localStorage.getItem('accessToken')
        : null;
    router.replace(token ? '/dashboard' : '/login');
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  );
}
