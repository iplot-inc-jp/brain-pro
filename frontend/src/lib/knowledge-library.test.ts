import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildKnowledgeFolderTree,
  buildKnowledgeLibrarySearchParams,
  collectDescendantFolderIds,
  knowledgeLibraryApi,
  normalizeFolderTemplates,
  optimisticallyReplaceItemFolders,
  type KnowledgeFolder,
  type KnowledgeLibraryResultItem,
} from './knowledge-library'

describe('knowledge library client', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => 'token' })
  })

  it('serializes search text, repeated types, folder, unclassified, and limit', () => {
    const query = buildKnowledgeLibrarySearchParams({
      q: '受注 処理', itemTypes: ['RAG', 'CHAT'], folderId: 'f/1', unclassified: true, limit: 25,
    })
    expect(query.toString()).toBe(
      'q=%E5%8F%97%E6%B3%A8+%E5%87%A6%E7%90%86&itemTypes=RAG&itemTypes=CHAT&folderId=f%2F1&unclassified=true&limit=25',
    )
  })

  it('serializes RAG feature and scope filters for federated search', () => {
    const query = buildKnowledgeLibrarySearchParams({
      ragFeatureType: 'BUSINESS_FLOW',
      ragScopeLevel: 'OVERVIEW',
    })
    expect(query.toString()).toBe('ragFeatureType=BUSINESS_FLOW&ragScopeLevel=OVERVIEW')
  })

  it('encodes project/item ids and sends auth when replacing memberships', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ folderIds: ['f1'] }) })
    await knowledgeLibraryApi.replaceItemFolders('project/1', 'RAG', 'rag/1', ['f1'])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/projects/project%2F1/knowledge-library/items/RAG/rag%2F1/folders'),
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ folderIds: ['f1'] }),
      }),
    )
  })
})

describe('folder tree helpers', () => {
  const rows: KnowledgeFolder[] = [
    { id: 'b', name: 'B', order: 1, parentId: null, itemCount: 0, children: [] },
    { id: 'a2', name: '子', order: 0, parentId: 'a', itemCount: 0, children: [] },
    { id: 'orphan', name: '孤児', order: 2, parentId: 'missing', itemCount: 0, children: [] },
    { id: 'a', name: 'A', order: 1, parentId: null, itemCount: 0, children: [] },
    { id: 'a1', name: '先', order: -1, parentId: 'a', itemCount: 0, children: [] },
  ]

  it('sorts stably and keeps orphans visible at root', () => {
    const tree = buildKnowledgeFolderTree(rows)
    expect(tree.map((node) => node.id)).toEqual(['a', 'b', 'orphan'])
    expect(tree[0].children.map((node) => node.id)).toEqual(['a1', 'a2'])
  })

  it('collects all descendants for cycle-safe move controls', () => {
    expect(Array.from(collectDescendantFolderIds(buildKnowledgeFolderTree(rows), 'a'))).toEqual(['a1', 'a2'])
  })

  it('returns an optimistic next state and an exact rollback snapshot', () => {
    const items: KnowledgeLibraryResultItem[] = [{
      itemType: 'RAG', itemId: 'r1', title: 'RAG', excerpt: '', occurredAt: '2026-07-17',
      sourcePageUrl: '/r', sourceFiles: [], folderIds: ['old'], score: 1,
    }]
    const change = optimisticallyReplaceItemFolders(items, 'RAG', 'r1', ['new'])
    expect(change.next[0].folderIds).toEqual(['new'])
    expect(change.rollback).toEqual(items)
    expect(change.next).not.toBe(items)
  })

  it('normalizes built-in and company templates into one discriminated list', () => {
    expect(normalizeFolderTemplates({
      builtIn: [{ id: 'builtin:x', name: '標準', description: 'built in', nodes: [] }],
      custom: [{ id: 'custom', name: '社内', nodes: [], updatedAt: '2026-07-17' }],
    })).toEqual([
      expect.objectContaining({ id: 'builtin:x', kind: 'builtIn', name: '標準' }),
      expect.objectContaining({ id: 'custom', kind: 'custom', name: '社内' }),
    ])
  })
})
