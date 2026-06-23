'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

/**
 * コンテンツタブを URL の ?tab= で駆動するフック。
 *
 * 左サイドメニューのサブ項目（メニューダウン）と、ページ内の Tabs の両方が
 * 同じ ?tab= を読み書きすることで双方向に同期する。
 * （サイドメニューの子リンク → ?tab= 更新 → ページのタブ切替、
 *   ページ内タブ操作 → ?tab= 更新 → サイドメニューのアクティブ表示更新）
 *
 * @param defaultTab tab 未指定時に選択するタブ（＝先頭タブ）。
 *   既定タブのときは URL から ?tab= を外して URL をきれいに保つ。
 */
export function useTabParam(defaultTab: string): [string, (next: string) => void] {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') ?? defaultTab

  const setTab = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (next === defaultTab) params.delete('tab')
      else params.set('tab', next)
      const qs = params.toString()
      // replace（push でない）で履歴を汚さず、scroll:false でタブ切替時のスクロール跳ねを抑止。
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [pathname, router, searchParams, defaultTab],
  )

  return [tab, setTab]
}
