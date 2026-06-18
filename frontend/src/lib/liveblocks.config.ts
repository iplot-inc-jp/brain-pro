'use client'
import { createClient } from '@liveblocks/client'
import { createRoomContext } from '@liveblocks/react'
import { projectIdFromRoom, roomIdForProject } from './presence-helpers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export type Presence = {
  page: string
  cursor: { x: number; y: number } | null
  space: 'screen'
}
export type UserMeta = {
  id: string
  info: { name: string; email: string; avatarUrl: string | null; color: string }
}

export const liveblocksClient = createClient({
  throttle: 100,
  authEndpoint: async (room) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
    // 実 room を送る（project:{id} もしくは meetingdoc:{id}）。サーバが room→project を解決し認可する。
    // projectId は project ルームの後方互換用に併せて送る。
    const projectId = projectIdFromRoom(room ?? '')
    const res = await fetch(`${API_URL}/api/liveblocks/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
      body: JSON.stringify({ room, projectId }),
    })
    if (!res.ok) throw new Error(`liveblocks auth failed: ${res.status}`)
    return res.json()
  },
})

export const {
  RoomProvider,
  useRoom,
  useOthers,
  useSelf,
  useUpdateMyPresence,
  useErrorListener,
} = createRoomContext<Presence, Record<string, never>, UserMeta>(liveblocksClient)

export { roomIdForProject }
