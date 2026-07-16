import type { MetadataRoute } from 'next'

// PWA マニフェスト（Next.js が /manifest.webmanifest として配信し、<link> も自動挿入する）。
// iPhone は Safari の「共有 → ホーム画面に追加」でインストールでき、
// display: standalone によりアドレスバーなしの全画面アプリとして起動する。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Brain Pro',
    short_name: 'Brain Pro',
    description: 'プロジェクトの“脳”を、人とAIで共有するプロジェクト管理システム',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
