import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import { Providers } from '@/components/providers'
import { Toaster } from '@/components/ui/toaster'

export const metadata: Metadata = {
  // og:image 等の相対URLを絶対URLへ解決する基点（共有リンクのunfurl用）
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://brain-pro.iplot.jp',
  ),
  title: 'Brain Pro',
  description: 'プロジェクトの“脳”を、人とAIで共有するプロジェクト管理システム',
  applicationName: 'Brain Pro',
  // iPhone「ホーム画面に追加」用（スタンドアロン起動・ホーム画面名・ステータスバー）
  appleWebApp: {
    capable: true,
    title: 'Brain Pro',
    statusBarStyle: 'default',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // ノッチ・ホームバー領域まで描画し、safe-area inset（globals.css の --safe-*）で余白を取る
  viewportFit: 'cover',
  themeColor: '#ffffff',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Yu Gothic はOSフォント。非搭載環境向けに Noto Sans JP をWebフォント・フォールバックとして読み込む */}
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <Providers>
          {children}
          <Toaster />
        </Providers>
        {/* Vercel モニタリング（本番のみ計測。アクセス解析 + Core Web Vitals） */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
