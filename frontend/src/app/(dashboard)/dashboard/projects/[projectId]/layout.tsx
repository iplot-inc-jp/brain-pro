'use client'

import { useParams, usePathname } from 'next/navigation'
import { ClientSideSuspense } from '@liveblocks/react'
import { useProjectAccess } from '@/hooks/use-project-access'
import { ReadOnlyProvider, ReadOnlyBanner } from '@/components/read-only-context'
import { RoomProvider, roomIdForProject } from '@/lib/liveblocks.config'
import { WhoIsOnline } from '@/components/presence/WhoIsOnline'
import { LiveCursors } from '@/components/presence/LiveCursors'
import { PresencePageSync } from '@/components/presence/PresencePageSync'
import { RoomConnectionGuard } from '@/components/presence/RoomConnectionGuard'

/**
 * プロジェクト配下（/dashboard/projects/[projectId]/...）共通レイアウト。
 *
 * - my-access から実効権限を取得し ReadOnlyContext で配下に供給する（閲覧専用バナー）。
 * - Liveblocks RoomProvider（room=project:{projectId}）で全サブページにプレゼンスを付与。
 *   オンライン表示（WhoIsOnline）とライブカーソル（LiveCursors）を1回だけ設置する。
 *   トークン取得に失敗（秘密鍵未設定/401）してもページは通常表示される（グレースフルデグレード）。
 */
export default function ProjectScopedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const params = useParams()
  const projectId = (params?.projectId as string) ?? null
  const pathname = usePathname()
  const { level, canEdit, loading } = useProjectAccess(projectId)

  const body = (
    <>
      <ReadOnlyBanner />
      {children}
    </>
  )

  if (!projectId) {
    return <ReadOnlyProvider value={{ canEdit, level, loading }}>{body}</ReadOnlyProvider>
  }

  return (
    <ReadOnlyProvider value={{ canEdit, level, loading }}>
      <RoomProvider
        id={roomIdForProject(projectId)}
        initialPresence={{ page: pathname, cursor: null, space: 'screen' }}
      >
        {/* タブ非表示/アイドル時に切断して Liveblocks の「毎分課金」を抑える。 */}
        <RoomConnectionGuard />
        <ClientSideSuspense fallback={null}>
          {() => (
            <>
              <div className="fixed right-4 top-16 z-40">
                <WhoIsOnline />
              </div>
              <PresencePageSync />
              <LiveCursors />
            </>
          )}
        </ClientSideSuspense>
        {body}
      </RoomProvider>
    </ReadOnlyProvider>
  )
}
