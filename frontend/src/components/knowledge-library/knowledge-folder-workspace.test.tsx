import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeFolderWorkspace } from './knowledge-folder-workspace'
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

const folders = [
  {
    id: 'f1', name: '設計', order: 0, parentId: null, itemCount: 1,
    children: [{ id: 'f2', name: '運用', order: 0, parentId: 'f1', itemCount: 0, children: [] }],
  },
]

const items = [
  {
    itemType: 'RAG' as const, itemId: 'r1', title: '文書A', excerpt: '設計の概要',
    occurredAt: '2026-07-17T00:00:00Z', sourcePageUrl: '/a', sourceFiles: [], folderIds: ['f1'], score: 1,
  },
  {
    itemType: 'CHAT' as const, itemId: 'c1', title: '会話B', excerpt: '運用の相談',
    occurredAt: '2026-07-16T00:00:00Z', sourcePageUrl: '/b', sourceFiles: [], folderIds: [], score: 0,
  },
]

describe('KnowledgeFolderWorkspace', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(knowledgeLibraryApi.folders).mockResolvedValue(folders)
    vi.mocked(knowledgeLibraryApi.search).mockResolvedValue({
      items, warnings: [], totals: { RAG: 1, KNOWLEDGE_DOCUMENT: 0, KNOWLEDGE_NODE: 0, CHAT: 1, RESOURCE: 0, all: 2 },
    })
    vi.mocked(knowledgeLibraryApi.createFolder).mockResolvedValue(folders[0])
    vi.mocked(knowledgeLibraryApi.updateFolder).mockResolvedValue(folders[0])
    vi.mocked(knowledgeLibraryApi.deletePreview).mockResolvedValue({ folderCount: 2, membershipCount: 1, sourceItemsDeleted: 0 })
    vi.mocked(knowledgeLibraryApi.deleteFolder).mockResolvedValue({ folderCount: 2, membershipCount: 1, sourceItemsDeleted: 0 })
    vi.mocked(knowledgeLibraryApi.addFolderItems).mockResolvedValue({ added: 1 })
    vi.mocked(knowledgeLibraryApi.replaceItemFolders).mockResolvedValue({ folderIds: [] })
    vi.mocked(knowledgeLibraryApi.templates).mockResolvedValue({ builtIn: [], custom: [] })
  })

  it('shows the folder tree, virtual unclassified node, three panes, and a mobile drawer path', async () => {
    render(<KnowledgeFolderWorkspace projectId="p1" />)
    expect(await screen.findByLabelText('フォルダワークスペース')).toHaveAttribute('data-layout', 'three-pane')
    expect(screen.getByLabelText('モバイルフォルダドロワー')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem', { name: /未分類/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('treeitem', { name: /設計/ }).length).toBeGreaterThan(0)
  })

  it('creates a child, renames and moves a folder, then previews and confirms deletion', async () => {
    render(<KnowledgeFolderWorkspace projectId="p1" />)
    await screen.findByText('文書A')

    fireEvent.change(screen.getByLabelText('新しいフォルダ名'), { target: { value: 'レビュー' } })
    fireEvent.change(screen.getByLabelText('作成先'), { target: { value: 'f1' } })
    fireEvent.click(screen.getByRole('button', { name: 'フォルダを作成' }))
    await waitFor(() => expect(knowledgeLibraryApi.createFolder).toHaveBeenCalledWith('p1', { name: 'レビュー', parentId: 'f1' }))

    fireEvent.click(screen.getAllByRole('button', { name: '運用' })[0])
    fireEvent.change(screen.getByLabelText('選択フォルダ名'), { target: { value: '基本設計' } })
    fireEvent.click(screen.getByRole('button', { name: '名前を保存' }))
    await waitFor(() => expect(knowledgeLibraryApi.updateFolder).toHaveBeenCalledWith('p1', 'f2', { name: '基本設計' }))

    fireEvent.change(screen.getByLabelText('移動先'), { target: { value: 'ROOT' } })
    fireEvent.click(screen.getByRole('button', { name: 'フォルダを移動' }))
    await waitFor(() => expect(knowledgeLibraryApi.updateFolder).toHaveBeenCalledWith('p1', 'f2', { parentId: null }))

    fireEvent.click(screen.getByRole('button', { name: '削除内容を確認' }))
    expect(await screen.findByText('2個のフォルダと1件の分類を削除します。元の資料は削除されません。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '2個のフォルダを削除' }))
    await waitFor(() => expect(knowledgeLibraryApi.deleteFolder).toHaveBeenCalledWith('p1', 'f2'))
  })

  it('adds a dragged item to a folder without replacing existing memberships', async () => {
    render(<KnowledgeFolderWorkspace projectId="p1" />)
    const row = await screen.findByTestId('knowledge-item-RAG:r1')
    const transfer = {
      value: '',
      setData(_type: string, value: string) { this.value = value },
      getData() { return this.value },
    }
    fireEvent.dragStart(row, { dataTransfer: transfer })
    fireEvent.drop(screen.getByTestId('folder-drop-desktop-f2'), { dataTransfer: transfer })
    await waitFor(() => expect(knowledgeLibraryApi.addFolderItems).toHaveBeenCalledWith('p1', 'f2', [{ itemType: 'RAG', itemId: 'r1' }]))
  })

  it('assigns multiple selected items to multiple folders with the keyboard-accessible path', async () => {
    render(<KnowledgeFolderWorkspace projectId="p1" />)
    await screen.findByText('文書A')
    fireEvent.click(screen.getByRole('checkbox', { name: '文書Aを選択' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '会話Bを選択' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '分類先: 設計' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '分類先: 運用' }))
    fireEvent.click(screen.getByRole('button', { name: '選択した2件を分類' }))

    await waitFor(() => {
      expect(knowledgeLibraryApi.addFolderItems).toHaveBeenCalledWith('p1', 'f1', [
        { itemType: 'RAG', itemId: 'r1' }, { itemType: 'CHAT', itemId: 'c1' },
      ])
      expect(knowledgeLibraryApi.addFolderItems).toHaveBeenCalledWith('p1', 'f2', [
        { itemType: 'RAG', itemId: 'r1' }, { itemType: 'CHAT', itemId: 'c1' },
      ])
    })
  })

  it('rolls inspector membership checkboxes back when saving fails', async () => {
    vi.mocked(knowledgeLibraryApi.replaceItemFolders).mockRejectedValueOnce(new Error('分類を保存できませんでした'))
    render(<KnowledgeFolderWorkspace projectId="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: '文書Aの詳細' }))
    const checkbox = screen.getByRole('checkbox', { name: '所属先: 設計' })
    expect(checkbox).toBeChecked()
    fireEvent.click(checkbox)
    expect(await screen.findByRole('alert')).toHaveTextContent('分類を保存できませんでした')
    expect(checkbox).toBeChecked()
  })
})
