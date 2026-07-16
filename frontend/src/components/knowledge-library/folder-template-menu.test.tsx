import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderTemplateMenu } from './folder-template-menu'
import { knowledgeLibraryApi } from '@/lib/knowledge-library'

vi.mock('@/lib/knowledge-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge-library')>()
  return {
    ...actual,
    knowledgeLibraryApi: Object.fromEntries(
      Object.keys(actual.knowledgeLibraryApi).map((key) => [key, vi.fn()]),
    ),
  }
})

describe('FolderTemplateMenu', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(knowledgeLibraryApi.templates).mockResolvedValue({
      builtIn: [{ id: 'builtin:delivery', name: 'プロジェクト標準', description: '企画から運用まで', nodes: [] }],
      custom: [{ id: 't1', name: '自社標準', nodes: [], updatedAt: '2026-07-17' }],
    })
    vi.mocked(knowledgeLibraryApi.applyTemplate).mockResolvedValue({ created: 3 })
    vi.mocked(knowledgeLibraryApi.createTemplate).mockResolvedValue({ id: 't2', name: '監査標準', nodes: [], updatedAt: '2026-07-17' })
    vi.mocked(knowledgeLibraryApi.updateTemplate).mockResolvedValue({ id: 't1', name: '全社標準', nodes: [], updatedAt: '2026-07-17' })
    vi.mocked(knowledgeLibraryApi.deleteTemplate).mockResolvedValue({ id: 't1', name: '自社標準', nodes: [], updatedAt: '2026-07-17' })
  })

  it('applies a built-in template and saves the current tree as a company template', async () => {
    const onApplied = vi.fn()
    render(<FolderTemplateMenu projectId="p1" onApplied={onApplied} />)
    fireEvent.click(await screen.findByRole('button', { name: 'プロジェクト標準を適用' }))
    await waitFor(() => expect(knowledgeLibraryApi.applyTemplate).toHaveBeenCalledWith('p1', 'builtin:delivery'))
    expect(onApplied).toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('会社テンプレート名'), { target: { value: '監査標準' } })
    fireEvent.click(screen.getByRole('button', { name: '現在の構成を保存' }))
    await waitFor(() => expect(knowledgeLibraryApi.createTemplate).toHaveBeenCalledWith('p1', '監査標準'))
  })

  it('renames and deletes a custom company template', async () => {
    render(<FolderTemplateMenu projectId="p1" onApplied={() => undefined} />)
    const input = await screen.findByLabelText('自社標準の名前')
    fireEvent.change(input, { target: { value: '全社標準' } })
    fireEvent.click(screen.getByRole('button', { name: '自社標準の名前を保存' }))
    await waitFor(() => expect(knowledgeLibraryApi.updateTemplate).toHaveBeenCalledWith('p1', 't1', '全社標準'))

    fireEvent.click(screen.getByRole('button', { name: '自社標準を削除' }))
    await waitFor(() => expect(knowledgeLibraryApi.deleteTemplate).toHaveBeenCalledWith('p1', 't1'))
  })
})
