import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  generateRagIndex,
  getRagStatus,
  resolveRagRoute,
  searchRagDocuments,
} from './rag'

const project = '/dashboard/projects/p1'

describe('resolveRagRoute', () => {
  it.each([
    [`${project}/flows`, 'BUSINESS_FLOW', undefined],
    [`${project}/flows/f1`, 'BUSINESS_FLOW', 'f1'],
    [`${project}/requirements`, 'REQUIREMENT', undefined],
    [`${project}/issue-trees/tree1`, 'ISSUE_TREE', 'tree1'],
    [`${project}/tasks/gantt`, 'TASK', undefined],
    [`${project}/stakeholder-management`, 'STAKEHOLDER', undefined],
    [`${project}/risk-management`, 'RISK', undefined],
    [`${project}/ai-accuracy`, 'KPI', undefined],
    [`${project}/systems`, 'SYSTEM', undefined],
    [`${project}/catalog/tbl1`, 'DATA_CATALOG', undefined],
    [`${project}/object-map`, 'DATA_CATALOG', undefined],
    [`${project}/meeting-occurrences`, 'MEETING', undefined],
  ])('%s を対応機能へ解決する', (pathname, featureType, targetId) => {
    expect(resolveRagRoute(pathname, 'p1')).toMatchObject({
      supported: true,
      featureType,
      targetId,
    })
  })

  it('未対応ページは共通アクション用の未対応状態を返す', () => {
    expect(resolveRagRoute(`${project}/settings`, 'p1')).toEqual({
      supported: false,
      label: 'この機能',
    })
  })

  it('RAG索引ページ自身ではアクションを表示しない', () => {
    expect(resolveRagRoute(`${project}/rag`, 'p1')).toBeNull()
    expect(resolveRagRoute(`${project}/rag/settings`, 'p1')).toBeNull()
  })
})

describe('RAG API client', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => 'token' })
  })

  it('生成時に機能種別とtargetIdをJSONで送る', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ jobId: 'j1', status: 'QUEUED' }) })
    await generateRagIndex('p1', 'BUSINESS_FLOW', 'f1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/rag/generate'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ featureType: 'BUSINESS_FLOW', targetId: 'f1' }),
      }),
    )
  })

  it('状態取得にfeatureTypeとtargetIdを付ける', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ state: 'FRESH' }) })
    await getRagStatus('p1', 'ISSUE_TREE', 'tree1')
    expect(fetchMock.mock.calls[0][0]).toContain(
      '/api/projects/p1/rag/status?featureType=ISSUE_TREE&targetId=tree1',
    )
  })

  it('検索条件をURLエンコードして送る', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] })
    await searchRagDocuments('p1', {
      q: '受注 処理', featureType: 'TASK', scopeLevel: 'COMPONENT', limit: 7,
    })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('q=%E5%8F%97%E6%B3%A8+%E5%87%A6%E7%90%86')
    expect(url).toContain('featureType=TASK')
    expect(url).toContain('scopeLevel=COMPONENT')
    expect(url).toContain('limit=7')
  })
})
