'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  ChevronRight,
  FileSearch,
  Folder,
  FolderInput,
  FolderOpen,
  Loader2,
  Search,
  Trash2,
} from 'lucide-react'
import { FolderTemplateMenu } from './folder-template-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  collectDescendantFolderIds,
  knowledgeLibraryApi,
  type KnowledgeFolder,
  type KnowledgeLibraryResultItem,
} from '@/lib/knowledge-library'

interface KnowledgeFolderWorkspaceProps {
  projectId: string
}

type FolderFilter = 'ALL' | 'UNCLASSIFIED' | string

const typeLabels: Record<KnowledgeLibraryResultItem['itemType'], string> = {
  RAG: 'RAG',
  KNOWLEDGE_DOCUMENT: 'ナレッジ文書',
  KNOWLEDGE_NODE: 'ナレッジノード',
  CHAT: 'チャット',
  RESOURCE: 'リソース',
}

function flattenFolders(folders: KnowledgeFolder[]): KnowledgeFolder[] {
  return folders.flatMap((folder) => [folder, ...flattenFolders(folder.children)])
}

function itemKey(item: Pick<KnowledgeLibraryResultItem, 'itemType' | 'itemId'>) {
  return `${item.itemType}:${item.itemId}`
}

interface FolderTreeProps {
  folders: KnowledgeFolder[]
  selected: FolderFilter
  onSelect: (folderId: FolderFilter) => void
  onDropItem: (folderId: string, item: { itemType: KnowledgeLibraryResultItem['itemType']; itemId: string }) => void
  suffix: 'desktop' | 'mobile'
}

function FolderTree({ folders, selected, onSelect, onDropItem, suffix }: FolderTreeProps) {
  const drop = (event: React.DragEvent, folderId: string) => {
    event.preventDefault()
    try {
      const item = JSON.parse(event.dataTransfer.getData('application/x-knowledge-item'))
      if (item.itemType && item.itemId) onDropItem(folderId, item)
    } catch {
      // 別形式のドラッグデータは無視する。
    }
  }
  const renderNodes = (nodes: KnowledgeFolder[], depth = 0): React.ReactNode => nodes.map((folder) => (
    <li
      key={folder.id}
      role="treeitem"
      aria-label={`${folder.name} ${folder.itemCount}件`}
      aria-selected={selected === folder.id}
      data-testid={`folder-drop-${suffix}-${folder.id}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => drop(event, folder.id)}
    >
      <button
        type="button"
        aria-label={folder.name}
        onClick={() => onSelect(folder.id)}
        className={`flex min-h-11 w-full items-center gap-2 border-l-2 px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
          selected === folder.id ? 'border-amber-500 bg-amber-50 text-slate-950' : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950'
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {folder.children.length ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <span className="w-3.5" />}
        {selected === folder.id ? <FolderOpen className="h-4 w-4 text-amber-600" /> : <Folder className="h-4 w-4 text-slate-400" />}
        <span className="min-w-0 flex-1 truncate">{folder.name}</span>
        <span className="text-[10px] tabular-nums text-slate-400">{folder.itemCount}</span>
      </button>
      {folder.children.length ? <ul role="group">{renderNodes(folder.children, depth + 1)}</ul> : null}
    </li>
  ))

  return (
    <ul role="tree" aria-label="ナレッジフォルダ" className="space-y-0.5">
      <li role="treeitem" aria-label="すべて" aria-selected={selected === 'ALL'}>
        <button type="button" onClick={() => onSelect('ALL')} className="flex min-h-11 w-full items-center gap-2 border-l-2 border-transparent px-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100">
          <FileSearch className="h-4 w-4 text-slate-400" />すべて
        </button>
      </li>
      <li role="treeitem" aria-label="未分類" aria-selected={selected === 'UNCLASSIFIED'}>
        <button type="button" onClick={() => onSelect('UNCLASSIFIED')} className={`flex min-h-11 w-full items-center gap-2 border-l-2 px-3 text-left text-sm ${selected === 'UNCLASSIFIED' ? 'border-amber-500 bg-amber-50 font-semibold text-slate-950' : 'border-transparent text-slate-600 hover:bg-slate-100'}`}>
          <FolderInput className="h-4 w-4 text-slate-400" />未分類
        </button>
      </li>
      {renderNodes(folders)}
    </ul>
  )
}

export function KnowledgeFolderWorkspace({ projectId }: KnowledgeFolderWorkspaceProps) {
  const [folders, setFolders] = useState<KnowledgeFolder[]>([])
  const [items, setItems] = useState<KnowledgeLibraryResultItem[]>([])
  const [selectedFolder, setSelectedFolder] = useState<FolderFilter>('ALL')
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [assignmentFolderIds, setAssignmentFolderIds] = useState<Set<string>>(new Set())
  const [inspectedKey, setInspectedKey] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParentId, setNewFolderParentId] = useState('ROOT')
  const [folderNameDraft, setFolderNameDraft] = useState('')
  const [moveParentId, setMoveParentId] = useState('ROOT')
  const [deletePreview, setDeletePreview] = useState<{ folderCount: number; membershipCount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const allFolders = useMemo(() => flattenFolders(folders), [folders])
  const folderNames = useMemo(() => Object.fromEntries(allFolders.map((folder) => [folder.id, folder.name])), [allFolders])
  const activeFolder = allFolders.find((folder) => folder.id === selectedFolder)
  const inspectedItem = items.find((item) => itemKey(item) === inspectedKey) ?? null

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    setFolderNameDraft(activeFolder?.name ?? '')
    setMoveParentId(activeFolder?.parentId ?? 'ROOT')
    setDeletePreview(null)
  }, [activeFolder?.id, activeFolder?.name, activeFolder?.parentId])

  const loadFolders = useCallback(async () => {
    const next = await knowledgeLibraryApi.folders(projectId)
    setFolders(next)
  }, [projectId])

  const loadItems = useCallback(async () => {
    const result = await knowledgeLibraryApi.search(projectId, {
      ...(debouncedQuery.trim() ? { q: debouncedQuery.trim() } : {}),
      ...(selectedFolder === 'UNCLASSIFIED' ? { unclassified: true } : {}),
      ...(selectedFolder !== 'ALL' && selectedFolder !== 'UNCLASSIFIED' ? { folderId: selectedFolder } : {}),
      limit: 100,
    })
    setItems(result.items)
  }, [debouncedQuery, projectId, selectedFolder])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([knowledgeLibraryApi.folders(projectId), knowledgeLibraryApi.search(projectId, { limit: 100 })])
      .then(([nextFolders, result]) => {
        if (!cancelled) {
          setFolders(nextFolders)
          setItems(result.items)
        }
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'フォルダを読み込めませんでした')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (loading) return
    let cancelled = false
    setError(null)
    knowledgeLibraryApi.search(projectId, {
      ...(debouncedQuery.trim() ? { q: debouncedQuery.trim() } : {}),
      ...(selectedFolder === 'UNCLASSIFIED' ? { unclassified: true } : {}),
      ...(selectedFolder !== 'ALL' && selectedFolder !== 'UNCLASSIFIED' ? { folderId: selectedFolder } : {}),
      limit: 100,
    }).then((result) => {
      if (!cancelled) setItems(result.items)
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : '資料を検索できませんでした')
    })
    return () => { cancelled = true }
  }, [debouncedQuery, loading, projectId, selectedFolder])

  const runMutation = async (action: () => Promise<unknown>, reload: 'folders' | 'items' | 'both' = 'folders') => {
    setBusy(true)
    setError(null)
    try {
      await action()
      if (reload === 'folders' || reload === 'both') await loadFolders()
      if (reload === 'items' || reload === 'both') await loadItems()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '変更を保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  const addItemToFolder = async (folderId: string, item: { itemType: KnowledgeLibraryResultItem['itemType']; itemId: string }) => {
    await runMutation(async () => {
      await knowledgeLibraryApi.addFolderItems(projectId, folderId, [item])
      setItems((current) => current.map((candidate) => itemKey(candidate) === itemKey(item)
        ? { ...candidate, folderIds: Array.from(new Set([...candidate.folderIds, folderId])) }
        : candidate))
    }, 'folders')
  }

  const classifySelected = async () => {
    const selectedItems = items.filter((item) => selectedKeys.has(itemKey(item)))
    await runMutation(async () => {
      const targetFolderIds = Array.from(assignmentFolderIds)
      await Promise.all(targetFolderIds.map((folderId) => knowledgeLibraryApi.addFolderItems(
        projectId,
        folderId,
        selectedItems.map(({ itemType, itemId }) => ({ itemType, itemId })),
      )))
      setItems((current) => current.map((item) => selectedKeys.has(itemKey(item))
        ? { ...item, folderIds: Array.from(new Set([...item.folderIds, ...targetFolderIds])) }
        : item))
    }, 'folders')
  }

  const replaceInspectedFolders = async (folderId: string, checked: boolean) => {
    if (!inspectedItem) return
    const previous = inspectedItem.folderIds
    const next = checked ? Array.from(new Set([...previous, folderId])) : previous.filter((id) => id !== folderId)
    setItems((current) => current.map((item) => itemKey(item) === itemKey(inspectedItem) ? { ...item, folderIds: next } : item))
    setError(null)
    try {
      await knowledgeLibraryApi.replaceItemFolders(projectId, inspectedItem.itemType, inspectedItem.itemId, next)
      await loadFolders()
    } catch (cause) {
      setItems((current) => current.map((item) => itemKey(item) === itemKey(inspectedItem) ? { ...item, folderIds: previous } : item))
      setError(cause instanceof Error ? cause.message : '分類を保存できませんでした')
    }
  }

  const descendants = activeFolder ? collectDescendantFolderIds(folders, activeFolder.id) : new Set<string>()
  const moveTargets = activeFolder ? allFolders.filter((folder) => folder.id !== activeFolder.id && !descendants.has(folder.id)) : allFolders

  return (
    <div aria-label="フォルダワークスペース" data-layout="three-pane" className="grid min-h-[42rem] border-y border-slate-300 bg-white lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
      <aside className="hidden border-r border-slate-200 bg-slate-50/80 p-3 lg:block" aria-label="フォルダツリー">
        <div className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Library folders</div>
        <FolderTree folders={folders} selected={selectedFolder} onSelect={setSelectedFolder} onDropItem={(folderId, item) => void addItemToFolder(folderId, item)} suffix="desktop" />
      </aside>

      <section className="min-w-0 border-r border-slate-200">
        <section aria-label="モバイルフォルダドロワー" className="border-b border-slate-200 bg-slate-50 lg:hidden">
          <details>
            <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 text-sm font-semibold text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
              <FolderOpen className="h-4 w-4 text-amber-600" />フォルダを開く
            </summary>
            <div className="border-t border-slate-200 p-3">
              <FolderTree folders={folders} selected={selectedFolder} onSelect={setSelectedFolder} onDropItem={(folderId, item) => void addItemToFolder(folderId, item)} suffix="mobile" />
            </div>
          </details>
        </section>

        <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="フォルダ内を検索" placeholder="タイトル、本文、会話を検索" className="h-11 bg-white pl-10" />
            {loading ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-amber-600" /> : null}
          </div>
        </div>

        {error ? <div role="alert" className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div> : null}
        {!loading && items.length === 0 ? (
          <div className="flex min-h-72 flex-col items-start justify-center px-8">
            <FileSearch className="mb-4 h-7 w-7 text-slate-300" />
            <h2 className="font-semibold text-slate-900">この棚にはまだ資料がありません</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">別のフォルダを選ぶか、検索結果を分類するとここに並びます。</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map((item) => {
              const key = itemKey(item)
              return (
                <article
                  key={key}
                  draggable
                  data-testid={`knowledge-item-${key}`}
                  onDragStart={(event) => event.dataTransfer.setData('application/x-knowledge-item', JSON.stringify({ itemType: item.itemType, itemId: item.itemId }))}
                  className={`group grid grid-cols-[auto_minmax(0,1fr)] gap-3 px-4 py-4 transition-colors sm:px-6 ${inspectedKey === key ? 'bg-amber-50/70' : 'hover:bg-slate-50'}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`${item.title}を選択`}
                    checked={selectedKeys.has(key)}
                    onChange={(event) => setSelectedKeys((current) => {
                      const next = new Set(current)
                      if (event.target.checked) next.add(key)
                      else next.delete(key)
                      return next
                    })}
                    className="mt-1 h-4 w-4 accent-amber-600"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-sm text-[10px]">{typeLabels[item.itemType]}</Badge>
                      <time dateTime={item.occurredAt} className="text-[10px] tabular-nums text-slate-400">{new Intl.DateTimeFormat('ja-JP').format(new Date(item.occurredAt))}</time>
                    </div>
                    <button type="button" aria-label={`${item.title}の詳細`} onClick={() => setInspectedKey(key)} className="mt-2 block text-left font-semibold leading-6 text-slate-950 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                      {item.title}
                    </button>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{item.excerpt}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.folderIds.map((folderId) => <span key={folderId} className="bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{folderNames[folderId] ?? '不明なフォルダ'}</span>)}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <aside className="bg-slate-50/50 p-4 sm:p-5" aria-label="分類と詳細">
        <section aria-labelledby="bulk-classification-heading">
          <h2 id="bulk-classification-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-slate-700">分類する</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">選択した資料は、既存の所属を残したまま複数の棚へ追加できます。</p>
          <div className="mt-3 max-h-36 space-y-1 overflow-y-auto">
            {allFolders.map((folder) => (
              <label key={folder.id} className="flex min-h-9 items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" aria-label={`分類先: ${folder.name}`} checked={assignmentFolderIds.has(folder.id)} onChange={(event) => setAssignmentFolderIds((current) => {
                  const next = new Set(current)
                  if (event.target.checked) next.add(folder.id)
                  else next.delete(folder.id)
                  return next
                })} className="h-4 w-4 accent-amber-600" />
                <span className="truncate">{folder.name}</span>
              </label>
            ))}
          </div>
          <Button type="button" size="sm" className="mt-3 h-10 w-full bg-slate-900 text-white hover:bg-slate-800" disabled={busy || selectedKeys.size === 0 || assignmentFolderIds.size === 0} onClick={() => void classifySelected()}>
            選択した{selectedKeys.size}件を分類
          </Button>
        </section>

        {inspectedItem ? (
          <section aria-labelledby="item-inspector-heading" className="mt-6 border-t border-slate-200 pt-5">
            <h2 id="item-inspector-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-slate-700">選択資料</h2>
            <div className="mt-3 text-sm font-semibold text-slate-950">{inspectedItem.title}</div>
            <a href={inspectedItem.sourcePageUrl} className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-amber-800 hover:text-amber-950">元ページを開く <ArrowUpRight className="h-3.5 w-3.5" /></a>
            <fieldset className="mt-3 space-y-1">
              <legend className="mb-2 text-xs font-semibold text-slate-600">所属先</legend>
              {allFolders.map((folder) => (
                <label key={folder.id} className="flex min-h-9 items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" aria-label={`所属先: ${folder.name}`} checked={inspectedItem.folderIds.includes(folder.id)} onChange={(event) => void replaceInspectedFolders(folder.id, event.target.checked)} className="h-4 w-4 accent-amber-600" />
                  {folder.name}
                </label>
              ))}
            </fieldset>
          </section>
        ) : null}

        <section aria-labelledby="folder-management-heading" className="mt-6 border-t border-slate-200 pt-5">
          <h2 id="folder-management-heading" className="text-xs font-bold uppercase tracking-[0.14em] text-slate-700">フォルダ管理</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="new-folder-name" className="mb-1.5 block text-xs font-semibold text-slate-600">新しいフォルダ名</label>
              <Input id="new-folder-name" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} className="h-9 bg-white" />
            </div>
            <div>
              <label htmlFor="new-folder-parent" className="mb-1.5 block text-xs font-semibold text-slate-600">作成先</label>
              <select id="new-folder-parent" value={newFolderParentId} onChange={(event) => setNewFolderParentId(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                <option value="ROOT">ルート</option>
                {allFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </div>
            <Button type="button" variant="outline" size="sm" className="h-9 w-full" disabled={busy || !newFolderName.trim()} onClick={() => void runMutation(async () => {
              await knowledgeLibraryApi.createFolder(projectId, { name: newFolderName.trim(), parentId: newFolderParentId === 'ROOT' ? null : newFolderParentId })
              setNewFolderName('')
            })}>フォルダを作成</Button>
          </div>

          {activeFolder ? (
            <div className="mt-5 space-y-3 border-t border-slate-200 pt-4">
              <div>
                <label htmlFor="selected-folder-name" className="mb-1.5 block text-xs font-semibold text-slate-600">選択フォルダ名</label>
                <Input id="selected-folder-name" value={folderNameDraft} onChange={(event) => setFolderNameDraft(event.target.value)} className="h-9 bg-white" />
                <Button type="button" variant="outline" size="sm" className="mt-2 h-9 w-full" disabled={busy || !folderNameDraft.trim()} onClick={() => void runMutation(() => knowledgeLibraryApi.updateFolder(projectId, activeFolder.id, { name: folderNameDraft.trim() }))}>名前を保存</Button>
              </div>
              <div>
                <label htmlFor="move-folder-parent" className="mb-1.5 block text-xs font-semibold text-slate-600">移動先</label>
                <select id="move-folder-parent" value={moveParentId} onChange={(event) => setMoveParentId(event.target.value)} className="h-9 w-full border border-slate-300 bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                  <option value="ROOT">ルート</option>
                  {moveTargets.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
                <Button type="button" variant="outline" size="sm" className="mt-2 h-9 w-full" disabled={busy} onClick={() => void runMutation(() => knowledgeLibraryApi.updateFolder(projectId, activeFolder.id, { parentId: moveParentId === 'ROOT' ? null : moveParentId }))}>フォルダを移動</Button>
              </div>
              <Button type="button" variant="ghost" size="sm" className="h-9 w-full text-red-700 hover:bg-red-50 hover:text-red-800" disabled={busy} onClick={() => void runMutation(async () => setDeletePreview(await knowledgeLibraryApi.deletePreview(projectId, activeFolder.id)), 'items')}>
                <Trash2 className="mr-2 h-3.5 w-3.5" />削除内容を確認
              </Button>
              {deletePreview ? (
                <div className="border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-900">
                  <p>{deletePreview.folderCount}個のフォルダと{deletePreview.membershipCount}件の分類を削除します。元の資料は削除されません。</p>
                  <Button type="button" size="sm" className="mt-2 h-9 w-full bg-red-700 text-white hover:bg-red-800" onClick={() => void runMutation(async () => {
                    await knowledgeLibraryApi.deleteFolder(projectId, activeFolder.id)
                    setSelectedFolder('ALL')
                    setDeletePreview(null)
                  }, 'both')}>{deletePreview.folderCount}個のフォルダを削除</Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <FolderTemplateMenu projectId={projectId} onApplied={() => void loadFolders()} />
      </aside>
    </div>
  )
}
