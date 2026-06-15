'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { useOthers, useUpdateMyPresence } from '@/lib/liveblocks.config'
import { displayName, shouldShowCursor } from '@/lib/presence-helpers'

function CursorSvg({ color }: { color: string }) {
  return (
    <svg width="18" height="24" viewBox="0 0 18 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1 1L1 17.5L5.5 13.5L8.5 20L11 19L8 12.5L14 12.5L1 1Z" fill={color} stroke="white" strokeWidth="1.2" />
    </svg>
  )
}

/**
 * 全画面の固定オーバーレイ。pointermove で自分の cursor（viewport 座標）を更新し、
 * 同一サブページのピアのカーソルを描画する。Liveblocks client が throttle(100ms) で送信を間引く。
 */
export function LiveCursors() {
  const others = useOthers()
  const updateMyPresence = useUpdateMyPresence()
  const pathname = usePathname()

  useEffect(() => {
    const onMove = (e: PointerEvent) => updateMyPresence({ cursor: { x: e.clientX, y: e.clientY } })
    const onLeave = () => updateMyPresence({ cursor: null })
    window.addEventListener('pointermove', onMove)
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }, [updateMyPresence])

  return (
    <div className="pointer-events-none fixed inset-0 z-50">
      {others.map((o) => {
        if (!shouldShowCursor(o, pathname) || !o.presence.cursor) return null
        const { x, y } = o.presence.cursor
        return (
          <div key={o.connectionId} className="absolute" style={{ left: x, top: y, transform: 'translate(-2px, -2px)' }}>
            <CursorSvg color={o.info.color} />
            <span
              className="ml-3 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
              style={{ background: o.info.color }}
            >
              {displayName(o.info)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
