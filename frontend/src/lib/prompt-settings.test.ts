import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPromptList,
  getPromptSettings,
  resetPromptSettings,
  updatePromptSettings,
} from './prompt-settings'

describe('prompt settings API', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => 'token' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ active: { version: 1 } }) })
  })

  it('プロンプト一覧を認証つきで取得する', async () => {
    await getPromptList('p1')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/prompts'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    )
  })

  it('キー指定で現在設定と履歴を取得する', async () => {
    await getPromptSettings('p1', 'kpi-generate')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/prompts/kpi-generate'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }),
    )
  })

  it('モデルとプロンプトをPUTで新しい版として保存する', async () => {
    await updatePromptSettings('p1', 'rag', {
      model: 'claude-haiku-4-5', systemPrompt: '圧縮プロンプト',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/prompts/rag'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ model: 'claude-haiku-4-5', systemPrompt: '圧縮プロンプト' }),
      }),
    )
  })

  it('既定値復元をPOSTする', async () => {
    await resetPromptSettings('p1', 'rag')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/p1/prompts/rag/reset'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
