import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  RESOURCE_SOURCES,
  buildActivityHistorySearchParams,
  iproActivityApi,
  platformLabel,
  sourceLabel,
} from './ipro-activity'

describe('ipro activity history client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-17T09:30:00+09:00'))
    localStorage.setItem('accessToken', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('builds chat search with source=chat and active filters', () => {
    const query = buildActivityHistorySearchParams('chat', {
      q: '見積 条件',
      period: '7d',
      platform: 'line',
      hasMedia: true,
    })

    expect(query.getAll('sources')).toEqual(['chat'])
    expect(query.get('q')).toBe('見積 条件')
    expect(query.getAll('platforms')).toEqual(['line'])
    expect(query.get('hasMedia')).toBe('true')
    expect(query.get('from')).toBe('2026-07-10T00:30:00.000Z')
    expect(query.get('sort')).toBe('desc')
    expect(query.get('limit')).toBe('50')
  })

  it('builds resource search with all supported sources or one selected source', () => {
    const all = buildActivityHistorySearchParams('resource', { period: 'all' })
    expect(all.getAll('sources')).toEqual([...RESOURCE_SOURCES])

    const selected = buildActivityHistorySearchParams('resource', {
      period: '30d',
      source: 'recording',
    })
    expect(selected.getAll('sources')).toEqual(['recording'])
    expect(selected.get('from')).toBe('2026-06-17T00:30:00.000Z')
  })

  it('requests cursor pages and message context with auth headers', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], nextCursor: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        selected: { id: 'm2', content: '選択' },
        before: [{ id: 'm1', content: '前' }],
        after: [{ id: 'm3', content: '後' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await iproActivityApi.search('project-1', 'chat', { period: 'all' }, 'cursor-2')
    await iproActivityApi.context('project-1', 'message-2')

    const [searchUrl, searchInit] = fetchMock.mock.calls[0]
    expect(searchUrl).toContain('/api/projects/project-1/chat-history?')
    expect(searchUrl).toContain('cursor=cursor-2')
    expect(searchInit.headers.Authorization).toBe('Bearer test-token')
    expect(fetchMock.mock.calls[1][0]).toContain(
      '/api/projects/project-1/chat-history/messages/message-2/context',
    )
  })

  it('maps source and platform values to stable Japanese labels', () => {
    expect(sourceLabel('document')).toBe('文書')
    expect(sourceLabel('project_memory')).toBe('プロジェクト記憶')
    expect(sourceLabel('future_source')).toBe('future_source')
    expect(platformLabel('lineworks')).toBe('LINE WORKS')
    expect(platformLabel(null)).toBe('未設定')
  })
})
