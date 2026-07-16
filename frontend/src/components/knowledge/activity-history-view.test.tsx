import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  facets: vi.fn(),
  context: vi.fn(),
}))

vi.mock('@/lib/ipro-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ipro-activity')>()
  return {
    ...actual,
    iproActivityApi: mocks,
  }
})

import { ActivityHistoryView } from './activity-history-view'

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'document-1',
    source: 'chat',
    sourceRef: 'line:room-1:message-1',
    platform: 'line',
    roomId: 'room-1',
    roomName: '営業定例',
    authorId: 'user-1',
    authorName: '山田さん',
    title: null,
    content: '見積条件を確認しました',
    hasMedia: false,
    occurredAt: '2026-07-17T00:00:00.000Z',
    eventId: 'event-1',
    metadata: null,
    messageId: 'message-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.search.mockResolvedValue({ items: [], nextCursor: null })
  mocks.facets.mockResolvedValue({ sources: [], platforms: [], rooms: [], authors: [] })
  mocks.context.mockResolvedValue({ selected: { id: 'message-1', content: '選択発言' }, before: [], after: [] })
})

describe('ActivityHistoryView', () => {
  it('renders chat results and loads surrounding conversation when selected', async () => {
    mocks.search.mockResolvedValueOnce({ items: [item()], nextCursor: null })
    mocks.facets.mockResolvedValueOnce({
      sources: [{ key: 'chat', label: 'chat', count: 1 }],
      platforms: [{ key: 'line', label: 'line', count: 1 }],
      rooms: [],
      authors: [],
    })
    mocks.context.mockResolvedValueOnce({
      before: [{ id: 'message-0', content: '前の発言', authorName: '佐藤さん', sentAt: '2026-07-16T23:59:00.000Z' }],
      selected: { id: 'message-1', content: '見積条件を確認しました', authorName: '山田さん', sentAt: '2026-07-17T00:00:00.000Z' },
      after: [{ id: 'message-2', content: '次の発言', authorName: '鈴木さん', sentAt: '2026-07-17T00:01:00.000Z' }],
    })

    render(<ActivityHistoryView projectId="project-1" kind="chat" />)

    expect(await screen.findByText('見積条件を確認しました')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /山田さん.*見積条件/ }))
    expect(await screen.findByText('前の発言')).toBeInTheDocument()
    expect(screen.getByText('次の発言')).toBeInTheDocument()
    expect(mocks.context).toHaveBeenCalledWith('project-1', 'message-1')
  })

  it('renders resource labels and receipt metadata in the inspector', async () => {
    mocks.search.mockResolvedValueOnce({
      items: [item({
        id: 'resource-1',
        source: 'document',
        sourceRef: 'doc-42',
        platform: null,
        roomId: null,
        roomName: null,
        authorId: null,
        authorName: null,
        title: '提案書 v2',
        content: '顧客向け提案書を更新しました',
        eventId: 'event-doc-1',
        messageId: null,
        metadata: { mimeType: 'application/pdf' },
      })],
      nextCursor: null,
    })

    render(<ActivityHistoryView projectId="project-1" kind="resource" />)

    expect(await screen.findByText('提案書 v2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /提案書 v2/ }))
    expect(screen.getAllByText('文書').length).toBeGreaterThan(0)
    expect(screen.getByText('event-doc-1')).toBeInTheDocument()
    expect(screen.getByText(/application\/pdf/)).toBeInTheDocument()
  })

  it('applies search and period filters before reloading', async () => {
    render(<ActivityHistoryView projectId="project-1" kind="chat" />)
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1))

    await userEvent.type(screen.getByRole('searchbox', { name: '受信履歴を検索' }), '見積')
    await userEvent.click(screen.getByRole('button', { name: '検索する' }))
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(2))
    expect(mocks.search.mock.calls[1][2]).toEqual(expect.objectContaining({ q: '見積' }))

    await userEvent.click(screen.getByRole('button', { name: '過去7日' }))
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(3))
    expect(mocks.search.mock.calls[2][2]).toEqual(expect.objectContaining({ period: '7d' }))
  })

  it('appends the next cursor page without dropping current results', async () => {
    mocks.search
      .mockResolvedValueOnce({ items: [item({ id: 'first', content: '最初の受信' })], nextCursor: 'next-1' })
      .mockResolvedValueOnce({ items: [item({ id: 'second', content: '次の受信' })], nextCursor: null })

    render(<ActivityHistoryView projectId="project-1" kind="chat" />)
    expect(await screen.findByText('最初の受信')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'さらに読み込む' }))
    expect(await screen.findByText('次の受信')).toBeInTheDocument()
    expect(screen.getByText('最初の受信')).toBeInTheDocument()
    expect(mocks.search.mock.calls[1][3]).toBe('next-1')
  })

  it('shows actionable empty and error states', async () => {
    mocks.search.mockRejectedValueOnce(new Error('受信履歴を取得できませんでした。'))
    const { rerender } = render(<ActivityHistoryView projectId="project-1" kind="chat" />)
    expect(await screen.findByText('受信履歴を取得できませんでした。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeInTheDocument()

    mocks.search.mockResolvedValueOnce({ items: [], nextCursor: null })
    await userEvent.click(screen.getByRole('button', { name: '再読み込み' }))
    rerender(<ActivityHistoryView projectId="project-1" kind="chat" />)
    expect(await screen.findByText('受信したチャットはまだありません')).toBeInTheDocument()
  })
})
