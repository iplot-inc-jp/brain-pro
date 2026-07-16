const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export type ActivityHistoryKind = 'chat' | 'resource'
export type ActivityHistoryPeriod = 'all' | 'today' | '7d' | '30d'

export const RESOURCE_SOURCES = [
  'document',
  'recording',
  'project_context',
  'project_memory',
  'tracker_task',
] as const

export interface ActivityHistoryFilters {
  q?: string
  period?: ActivityHistoryPeriod
  platform?: string
  source?: string
  hasMedia?: boolean
}

export interface ActivityHistoryItem {
  id: string
  source: string
  sourceRef: string
  platform: string | null
  roomId: string | null
  roomName: string | null
  authorId: string | null
  authorName: string | null
  title: string | null
  content: string
  hasMedia: boolean
  occurredAt: string
  eventId: string
  metadata: unknown
  messageId: string | null
}

export interface ActivityHistoryPage {
  items: ActivityHistoryItem[]
  nextCursor: string | null
}

export interface ActivityHistoryFacetValue {
  key: string
  label: string
  count: number
}

export interface ActivityHistoryFacets {
  sources: ActivityHistoryFacetValue[]
  platforms: ActivityHistoryFacetValue[]
  rooms: ActivityHistoryFacetValue[]
  authors: ActivityHistoryFacetValue[]
}

export interface ActivityChatMessage {
  id: string
  projectId?: string
  activityRoomId?: string
  platform?: string
  externalRoomId?: string
  externalMessageId?: string
  roomType?: string | null
  authorId?: string | null
  authorName?: string | null
  content: string | null
  media?: unknown
  mentions?: unknown
  hasMedia?: boolean
  sentAt?: string
  receivedEventId?: string
  createdAt?: string
  updatedAt?: string
}

export interface ActivityChatContext {
  selected: ActivityChatMessage
  before: ActivityChatMessage[]
  after: ActivityChatMessage[]
}

const SOURCE_LABELS: Record<string, string> = {
  chat: 'チャット',
  document: '文書',
  recording: '録画',
  project_context: 'プロジェクトコンテキスト',
  project_memory: 'プロジェクト記憶',
  tracker_task: '外部タスク',
}

const PLATFORM_LABELS: Record<string, string> = {
  slack: 'Slack',
  line: 'LINE',
  lineworks: 'LINE WORKS',
  linear: 'Linear',
  backlog: 'Backlog',
  trello: 'Trello',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

export function platformLabel(platform: string | null | undefined): string {
  if (!platform) return '未設定'
  return PLATFORM_LABELS[platform.toLowerCase()] ?? platform
}

function periodStart(period: ActivityHistoryPeriod | undefined): Date | null {
  if (!period || period === 'all') return null
  const now = new Date()
  if (period === 'today') {
    now.setHours(0, 0, 0, 0)
    return now
  }
  now.setDate(now.getDate() - (period === '7d' ? 7 : 30))
  return now
}

export function buildActivityHistorySearchParams(
  kind: ActivityHistoryKind,
  filters: ActivityHistoryFilters,
  cursor?: string,
): URLSearchParams {
  const query = new URLSearchParams()
  const sources = kind === 'chat'
    ? ['chat']
    : filters.source
      ? [filters.source]
      : [...RESOURCE_SOURCES]
  for (const source of sources) query.append('sources', source)

  const q = filters.q?.trim()
  if (q) query.set('q', q)
  if (filters.platform) query.append('platforms', filters.platform)
  if (filters.hasMedia !== undefined) query.set('hasMedia', String(filters.hasMedia))
  const from = periodStart(filters.period)
  if (from) query.set('from', from.toISOString())
  if (cursor) query.set('cursor', cursor)
  query.set('sort', 'desc')
  query.set('limit', '50')
  return query
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function requestJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await fetch(url, { headers: authHeaders() })
  if (!response.ok) throw new Error(errorMessage)
  return response.json() as Promise<T>
}

function historyUrl(
  projectId: string,
  suffix: string,
  query?: URLSearchParams,
): string {
  const path = `${API_URL}/api/projects/${encodeURIComponent(projectId)}/chat-history${suffix}`
  return query ? `${path}?${query.toString()}` : path
}

export const iproActivityApi = {
  search(
    projectId: string,
    kind: ActivityHistoryKind,
    filters: ActivityHistoryFilters,
    cursor?: string,
  ): Promise<ActivityHistoryPage> {
    return requestJson(
      historyUrl(projectId, '', buildActivityHistorySearchParams(kind, filters, cursor)),
      '受信履歴を取得できませんでした。時間をおいて再度お試しください。',
    )
  },

  facets(
    projectId: string,
    kind: ActivityHistoryKind,
    filters: ActivityHistoryFilters,
  ): Promise<ActivityHistoryFacets> {
    return requestJson(
      historyUrl(projectId, '/facets', buildActivityHistorySearchParams(kind, filters)),
      '絞り込み候補を取得できませんでした。',
    )
  },

  context(projectId: string, messageId: string): Promise<ActivityChatContext> {
    return requestJson(
      historyUrl(projectId, `/messages/${encodeURIComponent(messageId)}/context`),
      '前後の会話を取得できませんでした。もう一度お試しください。',
    )
  },
}
