const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

export const KNOWLEDGE_LIBRARY_ITEM_TYPES = [
  'RAG',
  'KNOWLEDGE_DOCUMENT',
  'KNOWLEDGE_NODE',
  'CHAT',
  'RESOURCE',
] as const

export type KnowledgeLibraryItemType = (typeof KNOWLEDGE_LIBRARY_ITEM_TYPES)[number]

export interface KnowledgeLibrarySourceFile {
  label: string
  url: string
  filename: string | null
  mimeType: string | null
}

export interface KnowledgeLibraryResultItem {
  itemType: KnowledgeLibraryItemType
  itemId: string
  title: string
  excerpt: string
  occurredAt: string
  sourcePageUrl: string
  sourceFiles: KnowledgeLibrarySourceFile[]
  folderIds: string[]
  score: number
}

export interface KnowledgeLibrarySearchInput {
  q?: string
  itemTypes?: KnowledgeLibraryItemType[]
  folderId?: string
  unclassified?: boolean
  limit?: number
}

export interface KnowledgeLibrarySearchResult {
  items: KnowledgeLibraryResultItem[]
  warnings: Array<{ source: KnowledgeLibraryItemType | 'ACTIVITY'; message: string }>
  totals: Record<KnowledgeLibraryItemType | 'all', number>
}

export interface KnowledgeFolder {
  id: string
  name: string
  order: number
  parentId: string | null
  itemCount: number
  children: KnowledgeFolder[]
}

export interface FolderTemplateNode {
  id?: string
  name: string
  order?: number
  parentNodeId?: string | null
  children?: FolderTemplateNode[]
}

export interface BuiltInFolderTemplate {
  id: string
  name: string
  description: string
  nodes: FolderTemplateNode[]
}

export interface CustomFolderTemplate {
  id: string
  name: string
  nodes: FolderTemplateNode[]
  updatedAt: string
}

export interface FolderTemplateResponse {
  builtIn: BuiltInFolderTemplate[]
  custom: CustomFolderTemplate[]
}

export type NormalizedFolderTemplate =
  | (BuiltInFolderTemplate & { kind: 'builtIn' })
  | (CustomFolderTemplate & { kind: 'custom'; description?: string })

export function buildKnowledgeLibrarySearchParams(
  input: KnowledgeLibrarySearchInput,
): URLSearchParams {
  const query = new URLSearchParams()
  const q = input.q?.trim()
  if (q) query.set('q', q)
  for (const itemType of input.itemTypes ?? []) query.append('itemTypes', itemType)
  if (input.folderId) query.set('folderId', input.folderId)
  if (input.unclassified !== undefined) query.set('unclassified', String(input.unclassified))
  if (input.limit) query.set('limit', String(input.limit))
  return query
}

export function buildKnowledgeFolderTree(rows: KnowledgeFolder[]): KnowledgeFolder[] {
  const indexed = rows.map((row, index) => ({ row, index }))
  const nodes = new Map<string, KnowledgeFolder>()
  for (const { row } of indexed) nodes.set(row.id, { ...row, children: [] })
  const roots: Array<{ node: KnowledgeFolder; index: number }> = []
  for (const { row, index } of indexed) {
    const node = nodes.get(row.id)!
    const parent = row.parentId ? nodes.get(row.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push({ node, index })
  }
  const sourceIndex = new Map(indexed.map(({ row, index }) => [row.id, index]))
  const sort = (items: KnowledgeFolder[]) => {
    items.sort((left, right) =>
      left.order - right.order ||
      left.name.localeCompare(right.name, 'ja') ||
      (sourceIndex.get(left.id) ?? 0) - (sourceIndex.get(right.id) ?? 0),
    )
    for (const item of items) sort(item.children)
  }
  const result = roots
    .sort((left, right) =>
      left.node.order - right.node.order ||
      left.node.name.localeCompare(right.node.name, 'ja') ||
      left.index - right.index,
    )
    .map(({ node }) => node)
  sort(result)
  return result
}

export function collectDescendantFolderIds(
  tree: KnowledgeFolder[],
  folderId: string,
): Set<string> {
  const result = new Set<string>()
  const visit = (nodes: KnowledgeFolder[], withinTarget: boolean) => {
    for (const node of nodes) {
      const isDescendant = withinTarget
      if (isDescendant) result.add(node.id)
      visit(node.children, withinTarget || node.id === folderId)
    }
  }
  visit(tree, false)
  return result
}

export function optimisticallyReplaceItemFolders(
  items: KnowledgeLibraryResultItem[],
  itemType: KnowledgeLibraryItemType,
  itemId: string,
  folderIds: string[],
): { next: KnowledgeLibraryResultItem[]; rollback: KnowledgeLibraryResultItem[] } {
  return {
    next: items.map((item) =>
      item.itemType === itemType && item.itemId === itemId
        ? { ...item, folderIds: Array.from(new Set(folderIds)) }
        : item,
    ),
    rollback: items,
  }
}

export function normalizeFolderTemplates(
  response: FolderTemplateResponse,
): NormalizedFolderTemplate[] {
  return [
    ...response.builtIn.map((template) => ({ ...template, kind: 'builtIn' as const })),
    ...response.custom.map((template) => ({ ...template, kind: 'custom' as const })),
  ]
}

function authHeaders(): Record<string, string> {
  const result: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (token) result.Authorization = `Bearer ${token}`
  return result
}

async function read<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>
  let message = fallback
  try {
    const body = await response.json()
    if (body?.message) message = Array.isArray(body.message) ? body.message.join(' / ') : body.message
  } catch {
    // JSON以外のエラーは利用者向けfallbackを使う。
  }
  throw new Error(message)
}

function projectUrl(projectId: string, path: string) {
  return `${API_URL}/api/projects/${encodeURIComponent(projectId)}/${path}`
}

async function request<T>(
  projectId: string,
  path: string,
  fallback: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(projectUrl(projectId, path), {
    ...init,
    headers: { ...authHeaders(), ...init.headers },
  })
  return read<T>(response, fallback)
}

export const knowledgeLibraryApi = {
  search(projectId: string, input: KnowledgeLibrarySearchInput = {}) {
    const query = buildKnowledgeLibrarySearchParams(input)
    const suffix = query.size ? `?${query}` : ''
    return request<KnowledgeLibrarySearchResult>(
      projectId,
      `knowledge-library/search${suffix}`,
      'ナレッジを検索できませんでした',
    )
  },

  folders(projectId: string) {
    return request<KnowledgeFolder[]>(projectId, 'knowledge-folders', 'フォルダを取得できませんでした')
  },

  createFolder(projectId: string, input: { name: string; parentId?: string | null; order?: number }) {
    return request<KnowledgeFolder>(projectId, 'knowledge-folders', 'フォルダを作成できませんでした', {
      method: 'POST', body: JSON.stringify(input),
    })
  },

  updateFolder(projectId: string, folderId: string, input: { name?: string; parentId?: string | null; order?: number }) {
    return request<KnowledgeFolder>(projectId, `knowledge-folders/${encodeURIComponent(folderId)}`, 'フォルダを更新できませんでした', {
      method: 'PATCH', body: JSON.stringify(input),
    })
  },

  deletePreview(projectId: string, folderId: string) {
    return request<{ folderCount: number; membershipCount: number; sourceItemsDeleted: 0 }>(
      projectId, `knowledge-folders/${encodeURIComponent(folderId)}/delete-preview`, '削除内容を確認できませんでした',
    )
  },

  deleteFolder(projectId: string, folderId: string) {
    return request<{ folderCount: number; membershipCount: number; sourceItemsDeleted: 0 }>(
      projectId, `knowledge-folders/${encodeURIComponent(folderId)}`, 'フォルダを削除できませんでした', { method: 'DELETE' },
    )
  },

  replaceItemFolders(
    projectId: string,
    itemType: KnowledgeLibraryItemType,
    itemId: string,
    folderIds: string[],
  ) {
    return request<{ folderIds: string[] }>(
      projectId,
      `knowledge-library/items/${encodeURIComponent(itemType)}/${encodeURIComponent(itemId)}/folders`,
      '分類を更新できませんでした',
      { method: 'PUT', body: JSON.stringify({ folderIds }) },
    )
  },

  addFolderItems(projectId: string, folderId: string, items: Array<{ itemType: KnowledgeLibraryItemType; itemId: string }>) {
    return request<{ added: number }>(
      projectId, `knowledge-folders/${encodeURIComponent(folderId)}/items`, 'フォルダへ追加できませんでした',
      { method: 'POST', body: JSON.stringify({ items }) },
    )
  },

  templates(projectId: string) {
    return request<FolderTemplateResponse>(projectId, 'knowledge-folder-templates', 'テンプレートを取得できませんでした')
  },

  createTemplate(projectId: string, name: string) {
    return request<CustomFolderTemplate>(projectId, 'knowledge-folder-templates', 'テンプレートを保存できませんでした', {
      method: 'POST', body: JSON.stringify({ name }),
    })
  },

  updateTemplate(projectId: string, templateId: string, name: string) {
    return request<CustomFolderTemplate>(projectId, `knowledge-folder-templates/${encodeURIComponent(templateId)}`, 'テンプレートを更新できませんでした', {
      method: 'PATCH', body: JSON.stringify({ name }),
    })
  },

  deleteTemplate(projectId: string, templateId: string) {
    return request<CustomFolderTemplate>(projectId, `knowledge-folder-templates/${encodeURIComponent(templateId)}`, 'テンプレートを削除できませんでした', {
      method: 'DELETE',
    })
  },

  applyTemplate(projectId: string, templateId: string) {
    return request<{ created: number }>(projectId, `knowledge-folder-templates/${encodeURIComponent(templateId)}/apply`, 'テンプレートを適用できませんでした', {
      method: 'POST',
    })
  },
}
