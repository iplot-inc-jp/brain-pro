'use client'
import { useOthers, useSelf } from '@/lib/liveblocks.config'
import { dedupeByUserId, displayName, initialsFromName } from '@/lib/presence-helpers'

type Entry = { id: string; info: { name: string; email: string; avatarUrl: string | null; color: string }; isSelf: boolean }

function Avatar({ entry }: { entry: Entry }) {
  const label = displayName(entry.info)
  return (
    <div
      title={entry.isSelf ? `${label}（あなた）` : label}
      className="relative -ml-2 h-8 w-8 overflow-hidden rounded-full border-2 bg-white text-[11px] font-semibold text-white"
      style={{ borderColor: entry.info.color }}
    >
      {entry.info.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.info.avatarUrl} alt={label} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center" style={{ background: entry.info.color }}>
          {initialsFromName(label)}
        </span>
      )}
    </div>
  )
}

/** プロジェクト内でオンラインの人を重なりアバターで表示（サブページ問わず全員）。複数タブは user.id で重複排除。 */
export function WhoIsOnline() {
  const others = useOthers()
  const self = useSelf()

  const entries: Entry[] = []
  if (self) entries.push({ id: self.id ?? 'self', info: self.info, isSelf: true })
  for (const o of others) entries.push({ id: o.id ?? `c${o.connectionId}`, info: o.info, isSelf: false })
  const unique = dedupeByUserId(entries)

  if (unique.length === 0) return null
  const shown = unique.slice(0, 5)
  const overflow = unique.length - shown.length

  return (
    <div className="flex items-center rounded-full bg-white/90 px-2 py-1 shadow-sm ring-1 ring-gray-200">
      <div className="flex items-center pl-2">
        {shown.map((e) => (
          <Avatar key={e.id} entry={e} />
        ))}
      </div>
      {overflow > 0 && (
        <span className="ml-1 text-xs font-medium text-gray-500">+{overflow}</span>
      )}
    </div>
  )
}
