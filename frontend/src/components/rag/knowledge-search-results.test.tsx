import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { KnowledgeSearchResults, type KnowledgeSourceFilter } from './knowledge-search-results'
import type { KnowledgeLibraryResultItem } from '@/lib/knowledge-library'

const items: KnowledgeLibraryResultItem[] = [
  {
    itemType: 'RAG', itemId: 'r1', title: '受注フロー', excerpt: '営業から受注を連携します。',
    occurredAt: '2026-07-17T00:00:00Z', sourcePageUrl: '/flows/f1', score: 3,
    sourceFiles: [{ label: '要件.pdf', url: '/api/attachments/a1/file', filename: '要件.pdf', mimeType: 'application/pdf' }],
    folderIds: ['f1'],
  },
  {
    itemType: 'CHAT', itemId: 'c1', title: 'Slack相談', excerpt: '確認しました。',
    occurredAt: '2026-07-16T00:00:00Z', sourcePageUrl: '/chat/c1', score: 1,
    sourceFiles: [], folderIds: [],
  },
]

describe('KnowledgeSearchResults', () => {
  it('shows source tabs and delegates source changes', () => {
    const onChange = vi.fn()
    render(<KnowledgeSearchResults items={items} sourceFilter="ALL" onSourceFilterChange={onChange} folderNames={{ f1: '要件' }} />)
    for (const label of ['すべて', 'RAG', 'ナレッジ', 'チャット', 'リソース']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'チャット' }))
    expect(onChange).toHaveBeenCalledWith('CHAT' satisfies KnowledgeSourceFilter)
  })

  it('renders mixed type labels, original page/file links, and folder badges', () => {
    render(<KnowledgeSearchResults items={items} sourceFilter="ALL" onSourceFilterChange={() => undefined} folderNames={{ f1: '要件' }} />)
    expect(screen.getAllByText('RAG')).toHaveLength(2)
    expect(screen.getAllByText('チャット')).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '元ページ' })[0]).toHaveAttribute('href', '/flows/f1')
    expect(screen.getByRole('link', { name: '要件.pdf' })).toHaveAttribute('href', '/api/attachments/a1/file')
    expect(screen.getByText('要件')).toBeInTheDocument()
  })

  it('keeps results visible with partial warnings', () => {
    render(<KnowledgeSearchResults items={items} sourceFilter="ALL" onSourceFilterChange={() => undefined} folderNames={{}} warnings={[{ source: 'CHAT', message: '一時停止' }]} />)
    expect(screen.getByRole('status')).toHaveTextContent('一部の検索元を取得できませんでした')
    expect(screen.getByText('受注フロー')).toBeInTheDocument()
  })

  it('renders loading, full error, and empty states', () => {
    const props = { sourceFilter: 'ALL' as const, onSourceFilterChange: () => undefined, folderNames: {} }
    const { rerender } = render(<KnowledgeSearchResults {...props} items={[]} loading />)
    expect(screen.getByText('ナレッジを検索中')).toBeInTheDocument()
    rerender(<KnowledgeSearchResults {...props} items={[]} error="検索に失敗しました" />)
    expect(screen.getByRole('alert')).toHaveTextContent('検索に失敗しました')
    rerender(<KnowledgeSearchResults {...props} items={[]} />)
    expect(screen.getByText('該当する情報がありません')).toBeInTheDocument()
  })
})
