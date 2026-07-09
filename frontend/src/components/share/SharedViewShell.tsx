'use client';

/**
 * 共有リンク閲覧ページ（/share/**）共通のシェル。
 * ヘッダー（プロダクトロゴ＋タイトル＋閲覧専用バッジ）と
 * ローディング / エラー（ログイン誘導つき）の状態表示を共通化する。
 */

import Link from 'next/link';
import { Database, Loader2, Link2, LogIn } from 'lucide-react';
import type { SharedViewError } from '@/lib/share-view';

const NAVY = '#050f3e';

export function SharedViewShell({
  title,
  subtitle,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string | null;
  loading: boolean;
  error: SharedViewError | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* ヘッダー */}
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-2.5">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md text-white"
          style={{ backgroundColor: NAVY }}
        >
          <Database className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold text-gray-900">{title}</h1>
          {subtitle && (
            <p className="truncate text-[11px] text-gray-400">{subtitle}</p>
          )}
        </div>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500">
          <Link2 className="h-3 w-3" />
          共有リンク（閲覧専用）
        </span>
      </header>

      {/* 本体 */}
      <main className="min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-gray-700">{error.message}</p>
            {error.kind === 'login' ? (
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <LogIn className="h-4 w-4" />
                ログインする
              </Link>
            ) : (
              <p className="text-xs text-gray-400">
                リンクの発行者に確認するか、共有リンクを再発行してもらってください。
              </p>
            )}
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
