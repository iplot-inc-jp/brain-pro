import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RagIndexPage from '@/app/(dashboard)/dashboard/projects/[projectId]/rag/page'
import { knowledgeLibraryApi } from '@/lib/knowledge-library'

vi.mock('next/navigation', () => ({
  useParams: () => ({ projectId: 'project-42' }),
}))

vi.mock('@/lib/knowledge-library', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge-library')>()
  return {
    ...actual,
    knowledgeLibraryApi: {
      ...actual.knowledgeLibraryApi,
      search: vi.fn(),
      folders: vi.fn(),
    },
  }
})

vi.mock('@/lib/rag', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rag')>()
  return { ...actual, searchRagDocuments: vi.fn().mockResolvedValue([]) }
})

describe('RagIndexPage federated search', () => {
  beforeEach(() => {
    vi.mocked(knowledgeLibraryApi.search).mockResolvedValue({
      items: [],
      warnings: [],
      totals: { RAG: 0, KNOWLEDGE_DOCUMENT: 0, KNOWLEDGE_NODE: 0, CHAT: 0, RESOURCE: 0, all: 0 },
    })
    vi.mocked(knowledgeLibraryApi.folders).mockResolvedValue([])
  })

  it('searches the project knowledge library while keeping RAG feature and scope filters', async () => {
    render(<RagIndexPage />)

    expect(screen.getByText('機能')).toBeInTheDocument()
    expect(screen.getByText('粒度')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'すべて' })).toBeInTheDocument()

    await waitFor(() => {
      expect(knowledgeLibraryApi.search).toHaveBeenCalledWith('project-42', {
        itemTypes: undefined,
        limit: 100,
      })
    })
  })
})
