'use client'

// サイドメニューのお気に入り（ユーザー単位）。
//
// 保存先は UserSetting.settings JSON の `sidebarFavorites` キー
// （GET /api/user-settings / PUT /api/user-settings/preferences を流用。専用テーブル不要）。
// お気に入りは href をキーに { href, name, kind } のスナップショットで持ち、
// 描画時に現在のナビ定義・取得済みフロー等から最新名を引き直す（lookup できなければ
// スナップショット名で表示する）。
//
// 表示スコープは「開いているプロジェクトのお気に入り＋プロジェクト非依存項目」。
// href に /dashboard/projects/<id> を含むかどうかで判定する（favoriteProjectId 参照）。

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

/** お気に入り対象の種別。アイコンのフォールバック導出に使う。 */
export type SidebarFavoriteKind = 'page' | 'flow' | 'meetingDoc'

export interface SidebarFavorite {
  /** 遷移先（クエリ付き可。例: .../meeting-documents?doc=xxx）。一意キーを兼ねる。 */
  href: string
  /** 登録時点の表示名スナップショット。 */
  name: string
  kind: SidebarFavoriteKind
}

/** settings JSON 上のキー名。 */
export const SIDEBAR_FAVORITES_KEY = 'sidebarFavorites'

/** href からプロジェクトIDを抽出（プロジェクト非依存の項目は null）。 */
export function favoriteProjectId(href: string): string | null {
  const m = href.match(/\/dashboard\/projects\/([^/?]+)/)
  return m ? m[1] : null
}

/** 現在開いているプロジェクトで表示すべきお気に入りだけに絞る。 */
export function visibleFavorites(
  favorites: SidebarFavorite[],
  currentProjectId: string | null,
): SidebarFavorite[] {
  return favorites.filter((f) => {
    const pid = favoriteProjectId(f.href)
    return pid === null || pid === currentProjectId
  })
}

/** サーバーの settings JSON から読んだ値の型ガード（壊れた値は黙って捨てる）。 */
export function isValidFavorite(v: unknown): v is SidebarFavorite {
  if (!v || typeof v !== 'object') return false
  const f = v as Record<string, unknown>
  return (
    typeof f.href === 'string' &&
    f.href.length > 0 &&
    typeof f.name === 'string' &&
    (f.kind === 'page' || f.kind === 'flow' || f.kind === 'meetingDoc')
  )
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) headers['Authorization'] = `Bearer ${token}`
  return headers
}

export interface SidebarFavoritesValue {
  favorites: SidebarFavorite[]
  /** 初回ロード完了フラグ。完了までは星は非表示（誤って空配列で上書きしないため）。 */
  loaded: boolean
  isFavorite: (href: string) => boolean
  toggleFavorite: (item: SidebarFavorite) => void
}

/**
 * お気に入りの取得・トグル・保存を行う hook（ダッシュボードレイアウトで1回だけ使う）。
 * 変更は楽観更新し、保存はベストエフォート（失敗は console.error のみ）。
 */
export function useSidebarFavoritesState(): SidebarFavoritesValue {
  const [favorites, setFavorites] = useState<SidebarFavorite[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/user-settings`, { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const raw = (data.settings as Record<string, unknown> | null)?.[SIDEBAR_FAVORITES_KEY]
        if (Array.isArray(raw)) setFavorites(raw.filter(isValidFavorite))
      })
      .catch((err) => console.error('Failed to fetch sidebar favorites:', err))
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((next: SidebarFavorite[]) => {
    fetch(`${API_URL}/api/user-settings/preferences`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ settings: { [SIDEBAR_FAVORITES_KEY]: next } }),
    }).catch((err) => console.error('Failed to save sidebar favorites:', err))
  }, [])

  const toggleFavorite = useCallback(
    (item: SidebarFavorite) => {
      // ロード前のトグルはサーバー値を空配列ベースで潰す恐れがあるので無視する。
      if (!loaded) return
      setFavorites((prev) => {
        const next = prev.some((f) => f.href === item.href)
          ? prev.filter((f) => f.href !== item.href)
          : [...prev, item]
        persist(next)
        return next
      })
    },
    [persist, loaded],
  )

  const isFavorite = useCallback(
    (href: string) => favorites.some((f) => f.href === href),
    [favorites],
  )

  return { favorites, loaded, isFavorite, toggleFavorite }
}

export const SidebarFavoritesContext = createContext<SidebarFavoritesValue | null>(null)

/** サイドメニュー内の各行から参照するための context hook。 */
export function useSidebarFavorites(): SidebarFavoritesValue {
  const ctx = useContext(SidebarFavoritesContext)
  if (!ctx) {
    throw new Error('useSidebarFavorites must be used within SidebarFavoritesContext.Provider')
  }
  return ctx
}
