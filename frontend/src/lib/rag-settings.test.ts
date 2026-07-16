import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getRagSettings,
  resetRagSettings,
  updateRagSettings,
} from './rag-settings'

describe('RAG settings API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => 'token' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active: { version: 1 } }) })
  })

  it('現在設定と履歴を認証つきで取得する', async () => {
    await getRagSettings('p1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/rag/settings'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    )
  })

  it('モデルとプロンプトをPUTで新しい版として保存する', async () => {
    await updateRagSettings('p1', {
      model: 'claude-haiku-4-5', systemPrompt: '圧縮プロンプト',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/rag/settings'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ model: 'claude-haiku-4-5', systemPrompt: '圧縮プロンプト' }),
      }),
    )
  })

  it('既定値復元をPOSTする', async () => {
    await resetRagSettings('p1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/rag/settings/reset'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
