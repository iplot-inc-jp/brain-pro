'use client'

import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { DatabaseZap, Loader2, RotateCcw, Search } from 'lucide-react'
import { KnowledgeSearchResults, type KnowledgeSourceFilter } from '@/components/rag/knowledge-search-results'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  knowledgeLibraryApi,
  type KnowledgeFolder,
  type KnowledgeLibraryItemType,
  type KnowledgeLibrarySearchResult,
} from '@/lib/knowledge-library'
import { RAG_FEATURE_LABELS, RAG_FEATURE_TYPES } from '@/lib/rag'
import { type RagFeatureFilter, type RagScopeFilter } from '@/lib/rag-search-state'

const emptyResult: KnowledgeLibrarySearchResult = {
  items: [],
  warnings: [],
  totals: { RAG: 0, KNOWLEDGE_DOCUMENT: 0, KNOWLEDGE_NODE: 0, CHAT: 0, RESOURCE: 0, all: 0 },
}

const sourceItemTypes: Record<KnowledgeSourceFilter, KnowledgeLibraryItemType[] | undefined> = {
  ALL: undefined,
  RAG: ['RAG'],
  KNOWLEDGE: ['KNOWLEDGE_DOCUMENT', 'KNOWLEDGE_NODE'],
  CHAT: ['CHAT'],
  RESOURCE: ['RESOURCE'],
}

function indexFolderNames(folders: KnowledgeFolder[]): Record<string, string> {
  const names: Record<string, string> = {}
  const visit = (nodes: KnowledgeFolder[]) => {
    for (const node of nodes) {
      names[node.id] = node.name
      visit(node.children)
    }
  }
  visit(folders)
  return names
}

export default function RagIndexPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<KnowledgeSourceFilter>('ALL')
  const [featureType, setFeatureType] = useState<RagFeatureFilter>('ALL')
  const [scopeLevel, setScopeLevel] = useState<RagScopeFilter>('ALL')
  const [result, setResult] = useState<KnowledgeLibrarySearchResult>(emptyResult)
  const [folderNames, setFolderNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const ragFiltersEnabled = sourceFilter === 'ALL' || sourceFilter === 'RAG'
  const request = useMemo(() => ({
    ...(debouncedQuery.trim() ? { q: debouncedQuery.trim() } : {}),
    itemTypes: sourceItemTypes[sourceFilter],
    ...(ragFiltersEnabled && featureType !== 'ALL' ? { ragFeatureType: featureType } : {}),
    ...(ragFiltersEnabled && scopeLevel !== 'ALL' ? { ragScopeLevel: scopeLevel } : {}),
    limit: 100,
  }), [debouncedQuery, featureType, ragFiltersEnabled, scopeLevel, sourceFilter])

  useEffect(() => {
    let cancelled = false
    knowledgeLibraryApi.folders(projectId)
      .then((folders) => {
        if (!cancelled) setFolderNames(indexFolderNames(folders))
      })
      .catch(() => {
        if (!cancelled) setFolderNames({})
      })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    knowledgeLibraryApi.search(projectId, request)
      .then((nextResult) => {
        if (!cancelled) setResult(nextResult)
      })
      .catch((cause) => {
        if (!cancelled) {
          setResult(emptyResult)
          setError(cause instanceof Error ? cause.message : 'ナレッジを検索できませんでした')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId, request])

  const hasFilters = Boolean(query.trim()) || sourceFilter !== 'ALL' || featureType !== 'ALL' || scopeLevel !== 'ALL'
  const reset = () => {
    setQuery('')
    setDebouncedQuery('')
    setSourceFilter('ALL')
    setFeatureType('ALL')
    setScopeLevel('ALL')
  }
  const nonRagCount = Math.max(0, result.totals.all - result.totals.RAG)

  return (
    <main className="min-h-full bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white px-6 py-7 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            <DatabaseZap className="h-4 w-4 text-cyan-600" />
            Project knowledge index
          </div>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">ナレッジ横断検索</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                RAG索引、ナレッジ、チャット、受信リソースをひとつの索引から検索します。
              </p>
            </div>
            <div className="flex items-center gap-5 border-l border-slate-200 pl-5 text-sm">
              <div><span className="block text-[10px] uppercase tracking-wider text-slate-400">Results</span><strong className="text-xl text-slate-900">{result.totals.all}</strong></div>
              <div><span className="block text-[10px] uppercase tracking-wider text-slate-400">RAG</span><strong className="text-xl text-slate-900">{result.totals.RAG}</strong></div>
              <div><span className="block text-[10px] uppercase tracking-wider text-slate-400">Sources</span><strong className="text-xl text-slate-900">{nonRagCount}</strong></div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-7 px-6 py-7 lg:grid-cols-[14rem_minmax(0,1fr)] lg:px-10">
        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div className={!ragFiltersEnabled ? 'opacity-45' : undefined}>
            <label className="mb-2 block text-xs font-semibold text-slate-700">機能</label>
            <Select disabled={!ragFiltersEnabled} value={featureType} onValueChange={(value) => setFeatureType(value as RagFeatureFilter)}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">すべての機能</SelectItem>
                {RAG_FEATURE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{RAG_FEATURE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={!ragFiltersEnabled ? 'opacity-45' : undefined}>
            <label className="mb-2 block text-xs font-semibold text-slate-700">粒度</label>
            <Select disabled={!ragFiltersEnabled} value={scopeLevel} onValueChange={(value) => setScopeLevel(value as RagScopeFilter)}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">すべての粒度</SelectItem>
                <SelectItem value="OVERVIEW">全体概要</SelectItem>
                <SelectItem value="COMPONENT">コンポーネント</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!ragFiltersEnabled ? (
            <p className="text-xs leading-5 text-slate-500">機能と粒度は、RAGを含む検索で利用できます。</p>
          ) : null}
          {hasFilters ? (
            <Button variant="ghost" size="sm" className="px-0 text-slate-500" onClick={reset}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />条件をリセット
            </Button>
          ) : null}
          <div className="border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
            RAG索引がない機能は、元ページ右下の「RAG用の概要を作る」から生成できます。
          </div>
        </aside>

        <section>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="業務名、会話、文書、キーワードで検索"
              aria-label="プロジェクトナレッジを検索"
              className="h-12 border-slate-300 bg-white pl-11 pr-12 shadow-sm"
            />
            {loading ? <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-600" /> : null}
          </div>

          <KnowledgeSearchResults
            items={result.items}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            folderNames={folderNames}
            warnings={result.warnings}
            loading={loading}
            error={error}
          />
        </section>
      </div>
    </main>
  )
}
