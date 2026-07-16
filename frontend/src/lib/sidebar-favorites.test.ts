import { describe, expect, it } from 'vitest'
import {
  favoriteProjectId,
  isValidFavorite,
  visibleFavorites,
  type SidebarFavorite,
} from './sidebar-favorites'

describe('favoriteProjectId', () => {
  it('プロジェクト配下の href からプロジェクトIDを抽出する', () => {
    expect(favoriteProjectId('/dashboard/projects/abc-123/catalog')).toBe('abc-123')
    expect(favoriteProjectId('/dashboard/projects/p1/flows/f1')).toBe('p1')
  })

  it('クエリ付き href でもパス部分から抽出する', () => {
    expect(favoriteProjectId('/dashboard/projects/p1/meeting-documents?doc=d1')).toBe('p1')
    // プロジェクトIDの直後にクエリが来るケース
    expect(favoriteProjectId('/dashboard/projects/p1?tab=x')).toBe('p1')
  })

  it('プロジェクト非依存の href は null', () => {
    expect(favoriteProjectId('/dashboard')).toBeNull()
    expect(favoriteProjectId('/dashboard/batches')).toBeNull()
    expect(favoriteProjectId('/dashboard/settings')).toBeNull()
  })
})

describe('visibleFavorites', () => {
  const favs: SidebarFavorite[] = [
    { href: '/dashboard/batches', name: '取り込みバッチ', kind: 'page' },
    { href: '/dashboard/projects/p1/catalog', name: 'データカタログ', kind: 'page' },
    { href: '/dashboard/projects/p2/flows/f1', name: '受注フロー', kind: 'flow' },
  ]

  it('開いているプロジェクトのお気に入り＋プロジェクト非依存項目だけ残す', () => {
    expect(visibleFavorites(favs, 'p1').map((f) => f.href)).toEqual([
      '/dashboard/batches',
      '/dashboard/projects/p1/catalog',
    ])
  })

  it('プロジェクトを開いていないときはプロジェクト非依存項目のみ', () => {
    expect(visibleFavorites(favs, null).map((f) => f.href)).toEqual(['/dashboard/batches'])
  })
})

describe('isValidFavorite', () => {
  it('正しい形の値を受け入れる', () => {
    expect(isValidFavorite({ href: '/dashboard', name: 'ホーム', kind: 'page' })).toBe(true)
    expect(isValidFavorite({ href: '/x?doc=1', name: 'd', kind: 'meetingDoc' })).toBe(true)
  })

  it('壊れた値を弾く', () => {
    expect(isValidFavorite(null)).toBe(false)
    expect(isValidFavorite('str')).toBe(false)
    expect(isValidFavorite({ href: '', name: 'x', kind: 'page' })).toBe(false)
    expect(isValidFavorite({ href: '/x', name: 'x', kind: 'unknown' })).toBe(false)
    expect(isValidFavorite({ name: 'x', kind: 'page' })).toBe(false)
  })
})
