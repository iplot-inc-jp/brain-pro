'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileText,
  Inbox,
  LibraryBig,
  Loader2,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  Search,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
import {
  RESOURCE_SOURCES,
  iproActivityApi,
  platformLabel,
  sourceLabel,
  type ActivityChatContext,
  type ActivityChatMessage,
  type ActivityHistoryFacets,
  type ActivityHistoryFilters,
  type ActivityHistoryItem,
  type ActivityHistoryKind,
  type ActivityHistoryPeriod,
} from '@/lib/ipro-activity'

export const ACTIVITY_HISTORY_COPY = {
  chat: {
    title: 'チャット履歴',
    description: 'ipro-dbから届いた会話を、ルームや発言者をまたいで確認できます。',
    emptyTitle: '受信したチャットはまだありません',
    emptyBody: 'Webhookでチャットを受信すると、ここに新しい順で表示されます。',
    filterLabel: 'プラットフォーム',
  },
  resource: {
    title: 'リソース履歴',
    description: '文書・録画・案件コンテキスト・外部タスクの受信記録を確認できます。',
    emptyTitle: '受信したリソースはまだありません',
    emptyBody: 'Webhookで文書や録画などを受信すると、ここに新しい順で表示されます。',
    filterLabel: 'リソース種別',
  },
} as const

const PERIODS: Array<{ value: ActivityHistoryPeriod; label: string }> = [
  { value: 'all', label: 'すべて' },
  { value: 'today', label: '今日' },
  { value: '7d', label: '過去7日' },
  { value: '30d', label: '過去30日' },
]

const EMPTY_FACETS: ActivityHistoryFacets = {
  sources: [],
  platforms: [],
  rooms: [],
  authors: [],
}

function formatDateTime(value: string | undefined): string {
  if (!value) return '時刻不明'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '時刻不明'
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function itemTitle(item: ActivityHistoryItem, kind: ActivityHistoryKind): string {
  if (kind === 'chat') return item.authorName || '名前未取得の発言者'
  return item.title || sourceLabel(item.source)
}

function itemSubtitle(item: ActivityHistoryItem, kind: ActivityHistoryKind): string {
  if (kind === 'chat') {
    return [platformLabel(item.platform), item.roomName || item.roomId || 'ルーム未設定']
      .filter(Boolean)
      .join(' · ')
  }
  return [sourceLabel(item.source), item.platform ? platformLabel(item.platform) : null]
    .filter(Boolean)
    .join(' · ')
}

function messageName(message: ActivityChatMessage): string {
  return message.authorName || message.authorId || '名前未取得の発言者'
}

function TimelineSkeleton() {
  return (
    <div aria-label="受信履歴を読み込み中" className="divide-y divide-slate-200">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex gap-4 px-4 py-5 sm:px-5">
          <div className="mt-1 h-9 w-9 animate-pulse rounded-full bg-slate-200" />
          <div className="min-w-0 flex-1 space-y-3">
            <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyHistory({ kind }: { kind: ActivityHistoryKind }) {
  const copy = ACTIVITY_HISTORY_COPY[kind]
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-5 grid h-14 w-14 place-items-center rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        <Inbox className="h-6 w-6" />
      </div>
      <h2 className="text-base font-semibold text-slate-900">{copy.emptyTitle}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{copy.emptyBody}</p>
    </div>
  )
}

function ResourceInspector({ item }: { item: ActivityHistoryItem }) {
  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
            {sourceLabel(item.source)}
          </span>
          {item.hasMedia && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
              <Paperclip className="h-3.5 w-3.5" /> 添付あり
            </span>
          )}
        </div>
        <h2 className="mt-3 text-lg font-semibold leading-7 text-slate-950">
          {item.title || sourceLabel(item.source)}
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
          {item.content || '本文はありません。'}
        </p>
      </div>

      <dl className="grid gap-4 border-t border-slate-200 pt-5 text-sm">
        {[
          ['受信種別', sourceLabel(item.source)],
          ['発生日時', formatDateTime(item.occurredAt)],
          ['sourceRef', item.sourceRef],
          ['eventId', item.eventId],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-[6.5rem_1fr] sm:gap-3">
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="break-all font-mono text-xs leading-5 text-slate-800">{value}</dd>
          </div>
        ))}
      </dl>

      {item.metadata != null && (
        <div className="border-t border-slate-200 pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            受信メタデータ
          </h3>
          <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-slate-950 p-4 text-xs leading-5 text-slate-100">
            {JSON.stringify(item.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function ChatInspector({
  context,
  loading,
  error,
  onRetry,
}: {
  context: ActivityChatContext | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" /> 前後の会話を読み込んでいます
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-3 py-8 text-center">
        <AlertCircle className="mx-auto h-6 w-6 text-rose-600" />
        <p className="text-sm text-slate-700">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          会話を再読み込み
        </Button>
      </div>
    )
  }
  if (!context) return null

  const messages = [...context.before, context.selected, ...context.after]
  return (
    <div className="space-y-1">
      <div className="mb-4 flex items-center gap-2 text-xs font-medium text-slate-500">
        <MessageSquareText className="h-4 w-4" /> 前後{context.before.length + context.after.length}件の会話
      </div>
      {messages.map((message) => {
        const selected = message.id === context.selected.id
        return (
          <div
            key={message.id}
            className={cn(
              'relative border-l-2 py-3 pl-4 pr-2',
              selected ? 'border-blue-600 bg-blue-50/70' : 'border-slate-200',
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800">{messageName(message)}</span>
              <time className="font-mono text-[11px] tabular-nums text-slate-500">
                {formatDateTime(message.sentAt)}
              </time>
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {message.content || '本文はありません。'}
            </p>
          </div>
        )
      })}
    </div>
  )
}

export function ActivityHistoryView({
  projectId,
  kind,
}: {
  projectId: string
  kind: ActivityHistoryKind
}) {
  const copy = ACTIVITY_HISTORY_COPY[kind]
  const [draftQuery, setDraftQuery] = useState('')
  const [filters, setFilters] = useState<ActivityHistoryFilters>({ period: 'all' })
  const [items, setItems] = useState<ActivityHistoryItem[]>([])
  const [facets, setFacets] = useState<ActivityHistoryFacets>(EMPTY_FACETS)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const [selected, setSelected] = useState<ActivityHistoryItem | null>(null)
  const [context, setContext] = useState<ActivityChatContext | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState<string | null>(null)

  const load = useCallback(async (cursor?: string) => {
    const append = Boolean(cursor)
    append ? setLoadingMore(true) : setLoading(true)
    if (!append) setError(null)
    try {
      const page = await iproActivityApi.search(projectId, kind, filters, cursor)
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor)
      setFetchedAt(new Date())
      if (!append) {
        setSelected(null)
        setContext(null)
        const nextFacets = await iproActivityApi.facets(projectId, kind, filters)
          .catch(() => EMPTY_FACETS)
        setFacets(nextFacets)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '受信履歴を取得できませんでした。'
      setError(message)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [filters, kind, projectId])

  useEffect(() => {
    void load()
  }, [load])

  const loadContext = useCallback(async (item: ActivityHistoryItem) => {
    if (kind !== 'chat' || !item.messageId) return
    setContextLoading(true)
    setContextError(null)
    setContext(null)
    try {
      setContext(await iproActivityApi.context(projectId, item.messageId))
    } catch (cause) {
      setContextError(cause instanceof Error ? cause.message : '前後の会話を取得できませんでした。')
    } finally {
      setContextLoading(false)
    }
  }, [kind, projectId])

  const selectItem = (item: ActivityHistoryItem) => {
    setSelected(item)
    if (kind === 'chat') void loadContext(item)
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const q = draftQuery.trim()
    if ((filters.q ?? '') === q) {
      void load()
      return
    }
    setFilters((current) => ({ ...current, q }))
  }

  const sourceOptions = useMemo(() => {
    const counts = new Map(facets.sources.map((facet) => [facet.key, facet.count]))
    return RESOURCE_SOURCES.map((source) => ({
      key: source,
      label: sourceLabel(source),
      count: counts.get(source),
    }))
  }, [facets.sources])

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            {kind === 'chat'
              ? <MessageSquareText className="h-5 w-5 text-blue-700" />
              : <LibraryBig className="h-5 w-5 text-amber-700" />}
            {copy.title}
          </span>
        }
        description={copy.description}
        actions={
          <div className="flex items-center gap-3">
            {fetchedAt && (
              <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                {formatDateTime(fetchedAt.toISOString())} 更新
              </span>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={cn('mr-1.5 h-4 w-4', loading && 'animate-spin')} />
              更新
            </Button>
          </div>
        }
      />

      <section aria-label="受信履歴の絞り込み" className="border-y border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-5">
        <form onSubmit={submitSearch} className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-xs font-semibold text-slate-700">全文検索</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                role="searchbox"
                aria-label="受信履歴を検索"
                value={draftQuery}
                onChange={(event) => setDraftQuery(event.target.value)}
                placeholder={kind === 'chat' ? '発言・ルーム・発言者を検索' : 'タイトル・本文を検索'}
                className="bg-white pl-9"
              />
            </span>
          </label>
          <Button type="submit" className="lg:self-end" aria-label="検索する">
            <Search className="mr-1.5 h-4 w-4" /> 検索
          </Button>
        </form>

        <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-700">受信期間</legend>
            <div className="inline-flex max-w-full overflow-x-auto rounded-md border border-slate-200 bg-white p-1">
              {PERIODS.map((period) => (
                <button
                  key={period.value}
                  type="button"
                  aria-label={period.label}
                  aria-pressed={(filters.period ?? 'all') === period.value}
                  onClick={() => setFilters((current) => ({ ...current, period: period.value }))}
                  className={cn(
                    'min-h-9 whitespace-nowrap rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2',
                    (filters.period ?? 'all') === period.value
                      ? 'bg-[#050f3e] text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                  )}
                >
                  {period.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="min-w-48">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">{copy.filterLabel}</span>
              {kind === 'chat' ? (
                <select
                  aria-label={copy.filterLabel}
                  value={filters.platform ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, platform: event.target.value || undefined }))}
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">すべて</option>
                  {facets.platforms.map((facet) => (
                    <option key={facet.key} value={facet.key}>
                      {platformLabel(facet.key)} ({facet.count})
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  aria-label={copy.filterLabel}
                  value={filters.source ?? ''}
                  onChange={(event) => setFilters((current) => ({ ...current, source: event.target.value || undefined }))}
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">すべて</option>
                  {sourceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}{option.count != null ? ` (${option.count})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.hasMedia === true}
                onChange={(event) => setFilters((current) => ({
                  ...current,
                  hasMedia: event.target.checked ? true : undefined,
                }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <Paperclip className="h-4 w-4 text-slate-500" /> 添付ありのみ
            </label>
          </div>
        </div>
      </section>

      {error && items.length === 0 ? (
        <section className="flex min-h-72 flex-col items-center justify-center border border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
          <AlertCircle className="h-7 w-7 text-rose-600" />
          <h2 className="mt-4 text-base font-semibold text-rose-950">受信履歴を表示できません</h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-rose-800">{error}</p>
          <Button type="button" variant="outline" size="sm" className="mt-5 bg-white" onClick={() => void load()}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> 再読み込み
          </Button>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.8fr)]">
          <section aria-label={`${copy.title}の一覧`} className="overflow-hidden border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <h2 className="text-sm font-semibold text-slate-900">受信タイムライン</h2>
              </div>
              <span className="font-mono text-xs tabular-nums text-slate-500">{items.length}件表示</span>
            </div>

            {loading && items.length === 0 ? (
              <TimelineSkeleton />
            ) : items.length === 0 ? (
              <EmptyHistory kind={kind} />
            ) : (
              <div className="divide-y divide-slate-200">
                {items.map((item) => {
                  const active = selected?.id === item.id
                  const title = itemTitle(item, kind)
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`${title} ${item.content}`.trim()}
                      aria-pressed={active}
                      onClick={() => selectItem(item)}
                      className={cn(
                        'group relative flex min-h-28 w-full gap-4 px-4 py-4 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:px-5',
                        active ? 'bg-blue-50/70' : 'hover:bg-slate-50',
                      )}
                    >
                      <span className={cn(
                        'absolute inset-y-0 left-0 w-1 transition-colors',
                        active ? 'bg-blue-700' : 'bg-transparent group-hover:bg-amber-400',
                      )} />
                      <span className={cn(
                        'mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full',
                        kind === 'chat' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-800',
                      )}>
                        {kind === 'chat' ? <MessageSquareText className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                          <span className="truncate text-sm font-semibold text-slate-950">{title}</span>
                          <time className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-slate-500">
                            <Clock3 className="h-3 w-3" /> {formatDateTime(item.occurredAt)}
                          </time>
                        </span>
                        <span className="mt-1 block text-xs font-medium text-slate-500">
                          {itemSubtitle(item, kind)}
                        </span>
                        {kind === 'resource' && item.title && (
                          <span className="mt-2 block line-clamp-2 text-sm leading-6 text-slate-700">
                            {item.content}
                          </span>
                        )}
                        {kind === 'chat' && (
                          <span className="mt-2 block whitespace-pre-wrap text-sm leading-6 text-slate-700">
                            {item.content || '本文はありません。'}
                          </span>
                        )}
                        {item.hasMedia && (
                          <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                            <Paperclip className="h-3.5 w-3.5" /> 添付あり
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
                {nextCursor && (
                  <div className="px-4 py-4 text-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={loadingMore}
                      onClick={() => void load(nextCursor)}
                    >
                      {loadingMore && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                      さらに読み込む
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>

          <aside aria-label="選択した受信履歴の詳細" className="self-start border border-slate-200 bg-white xl:sticky xl:top-5">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">
                {kind === 'chat' ? '会話の前後' : '受信内容'}
              </h2>
            </div>
            <div className="p-5">
              {!selected ? (
                <div className="flex min-h-52 flex-col items-center justify-center text-center">
                  {kind === 'chat'
                    ? <MessageSquareText className="h-7 w-7 text-slate-300" />
                    : <LibraryBig className="h-7 w-7 text-slate-300" />}
                  <p className="mt-3 text-sm font-medium text-slate-700">一覧から1件選択してください</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {kind === 'chat' ? '選択した発言の前後を表示します。' : '受信元とイベント情報を表示します。'}
                  </p>
                </div>
              ) : kind === 'chat' ? (
                <ChatInspector
                  context={context}
                  loading={contextLoading}
                  error={contextError}
                  onRetry={() => void loadContext(selected)}
                />
              ) : (
                <ResourceInspector item={selected} />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
