'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Braces,
  DatabaseZap,
  FileSearch,
  Layers3,
  Loader2,
  RotateCcw,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  RAG_FEATURE_LABELS,
  RAG_FEATURE_TYPES,
  searchRagDocuments,
  type RagDocument,
} from '@/lib/rag'
import {
  buildRagSearchRequest,
  countRagDocuments,
  type RagFeatureFilter,
  type RagScopeFilter,
} from '@/lib/rag-search-state'

const scopeLabels = {
  OVERVIEW: '全体概要',
  COMPONENT: 'コンポーネント',
} as const

export default function RagIndexPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [featureType, setFeatureType] = useState<RagFeatureFilter>('ALL')
  const [scopeLevel, setScopeLevel] = useState<RagScopeFilter>('ALL')
  const [documents, setDocuments] = useState<RagDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const request = useMemo(() => buildRagSearchRequest({
    query: debouncedQuery,
    featureType,
    scopeLevel,
  }), [debouncedQuery, featureType, scopeLevel])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    searchRagDocuments(projectId, request)
      .then((result) => {
        if (!cancelled) setDocuments(result)
      })
      .catch((cause) => {
        if (!cancelled) {
          setDocuments([])
          setError(cause instanceof Error ? cause.message : 'RAG索引を検索できませんでした')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, request])

  const counts = useMemo(() => countRagDocuments(documents), [documents])
  const hasFilters = Boolean(query.trim()) || featureType !== 'ALL' || scopeLevel !== 'ALL'
  const reset = () => {
    setQuery('')
    setDebouncedQuery('')
    setFeatureType('ALL')
    setScopeLevel('ALL')
  }

  return (
    <main className="min-h-full bg-slate-50/70">
      <header className="border-b border-slate-200 bg-white px-6 py-7 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            <DatabaseZap className="h-4 w-4 text-cyan-600" />
            Retrieval index
          </div>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-950">RAG索引</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                各機能から圧縮した全体概要と個別要素を横断検索します。結果から元ページへ直接戻れます。
              </p>
            </div>
            <div className="flex items-center gap-5 border-l border-slate-200 pl-5 text-sm">
              <div><span className="block text-[10px] uppercase tracking-wider text-slate-400">Results</span><strong className="text-xl text-slate-900">{counts.total}</strong></div>
              <div><span className="block text-[10px] uppercase tracking-wider text-slate-400">Overview</span><strong className="text-xl text-slate-900">{counts.overview}</strong></div>
              <div><span className="block text-[10px] uppercase tracking-wider text-slate-400">Parts</span><strong className="text-xl text-slate-900">{counts.component}</strong></div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-7 px-6 py-7 lg:grid-cols-[14rem_minmax(0,1fr)] lg:px-10">
        <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-700">機能</label>
            <Select value={featureType} onValueChange={(value) => setFeatureType(value as RagFeatureFilter)}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">すべての機能</SelectItem>
                {RAG_FEATURE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>{RAG_FEATURE_LABELS[type]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-semibold text-slate-700">粒度</label>
            <Select value={scopeLevel} onValueChange={(value) => setScopeLevel(value as RagScopeFilter)}>
              <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">すべての粒度</SelectItem>
                <SelectItem value="OVERVIEW">全体概要</SelectItem>
                <SelectItem value="COMPONENT">コンポーネント</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {hasFilters ? (
            <Button variant="ghost" size="sm" className="px-0 text-slate-500" onClick={reset}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" />条件をリセット
            </Button>
          ) : null}
          <div className="border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
            索引がない機能は、元ページ右下の「RAG用の概要を作る」から生成できます。
          </div>
        </aside>

        <section>
          <div className="relative mb-5">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="業務名、別名、質問文、キーワードで検索"
              aria-label="RAG索引を検索"
              className="h-12 border-slate-300 bg-white pl-11 pr-12 shadow-sm"
            />
            {loading ? <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-cyan-600" /> : null}
          </div>

          {error ? (
            <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
          ) : null}

          {!loading && !error && documents.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center">
              <FileSearch className="mb-4 h-8 w-8 text-slate-300" />
              <h2 className="font-semibold text-slate-800">該当する索引がありません</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                条件を変えるか、対象機能のページでRAG概要を生成してください。
              </p>
            </div>
          ) : null}

          <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
            {documents.map((document) => (
              <article key={document.id} className="group px-5 py-5 transition-colors hover:bg-slate-50/80">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-sm border-slate-300 bg-white text-[10px] font-semibold text-slate-600">
                    {RAG_FEATURE_LABELS[document.featureType]}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                    {document.scopeLevel === 'OVERVIEW' ? <Layers3 className="h-3 w-3" /> : <Braces className="h-3 w-3" />}
                    {scopeLabels[document.scopeLevel]}
                  </span>
                  {typeof document.score === 'number' ? (
                    <span className="ml-auto font-mono text-[10px] text-slate-400">score {document.score.toFixed(3)}</span>
                  ) : null}
                </div>
                <Link href={document.sourceUrl} className="inline-flex items-center gap-2 font-semibold text-slate-900 hover:text-cyan-700">
                  {document.title}
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
                <p className="mt-2 text-sm leading-6 text-slate-600">{document.summary || document.content}</p>
                {document.keywords.length ? (
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    {document.keywords.slice(0, 6).map((keyword) => <span key={keyword}>#{keyword}</span>)}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
