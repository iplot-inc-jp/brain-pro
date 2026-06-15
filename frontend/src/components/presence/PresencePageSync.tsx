'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useUpdateMyPresence } from '@/lib/liveblocks.config'

/** ルート変更のたびに presence.page を更新する（カーソルの同一ページ判定に使う）。 */
export function PresencePageSync() {
  const pathname = usePathname()
  const updateMyPresence = useUpdateMyPresence()
  useEffect(() => {
    updateMyPresence({ page: pathname })
  }, [pathname, updateMyPresence])
  return null
}
