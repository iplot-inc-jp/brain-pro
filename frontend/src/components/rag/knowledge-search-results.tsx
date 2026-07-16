'use client'

import { AlertTriangle, ArrowUpRight, FileDown, FileSearch, Folder, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type {
  KnowledgeLibraryResultItem,
  KnowledgeLibrarySearchResult,
} from '@/lib/knowledge-library'

export type KnowledgeSourceFilter = 'ALL' | 'RAG' | 'KNOWLEDGE' | 'CHAT' | 'RESOURCE'

const sourceTabs: Array<{ value: KnowledgeSourceFilter; label: string }> = [
  { value: 'ALL', label: 'すべて' },
  { value: 'RAG', label: 'RAG' },
  { value: 'KNOWLEDGE', label: 'ナレッジ' },
  { value: 'CHAT', label: 'チャット' },
  { value: 'RESOURCE', label: 'リソース' },
]

const typeLabels: Record<KnowledgeLibraryResultItem['itemType'], string> = {
  RAG: 'RAG',
  KNOWLEDGE_DOCUMENT: 'ナレッジ文書',
  KNOWLEDGE_NODE: 'ナレッジノード',
  CHAT: 'チャット',
  RESOURCE: 'リソース',
}

interface KnowledgeSearchResultsProps {
  items: KnowledgeLibraryResultItem[]
  sourceFilter: KnowledgeSourceFilter
  onSourceFilterChange: (value: KnowledgeSourceFilter) => void
  folderNames: Record<string, string>
  warnings?: KnowledgeLibrarySearchResult['warnings']
  loading?: boolean
  error?: string | null
  onSelectItem?: (item: KnowledgeLibraryResultItem) => void
}

export function KnowledgeSearchResults({
  items,
  sourceFilter,
  onSourceFilterChange,
  folderNames,
  warnings = [],
  loading = false,
  error = null,
  onSelectItem,
}: KnowledgeSearchResultsProps) {
  return (
    <div>
      <nav aria-label="検索対象" className="mb-4 flex overflow-x-auto border-b border-slate-300">
        {sourceTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-pressed={sourceFilter === tab.value}
            onClick={() => onSourceFilterChange(tab.value)}
            className={`relative shrink-0 px-4 py-3 text-xs font-semibold transition-colors ${
              sourceFilter === tab.value
                ? 'text-slate-950 after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-amber-500'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {warnings.length > 0 ? (
        <div role="status" className="mb-4 flex items-start gap-2 border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <strong className="block">一部の検索元を取得できませんでした</strong>
            <span>{warnings.map((warning) => warning.source).join('、')} の結果を除いて表示しています。</span>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-56 items-center justify-center gap-3 border-y border-slate-200 bg-white text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-600" />
          ナレッジを検索中
        </div>
      ) : error ? (
        <div role="alert" className="border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-6 text-center">
          <FileSearch className="mb-4 h-8 w-8 text-slate-300" />
          <h2 className="font-semibold text-slate-800">該当する情報がありません</h2>
          <p className="mt-2 text-sm text-slate-500">検索語や対象を変えてお試しください。</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 border-y border-slate-200 bg-white">
          {items.map((item) => (
            <article
              key={`${item.itemType}:${item.itemId}`}
              className="group px-5 py-5 transition-colors hover:bg-slate-50/80"
              onClick={() => onSelectItem?.(item)}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-sm border-slate-300 bg-white text-[10px] font-semibold text-slate-600">
                  {typeLabels[item.itemType]}
                </Badge>
                <time className="text-[10px] tabular-nums text-slate-400" dateTime={item.occurredAt}>
                  {new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(item.occurredAt))}
                </time>
                {item.score > 0 ? (
                  <span className="ml-auto font-mono text-[10px] text-slate-400">score {item.score.toFixed(2)}</span>
                ) : null}
              </div>

              <h2 className="font-semibold leading-6 text-slate-950">{item.title}</h2>
              <p className="mt-1.5 line-clamp-3 text-sm leading-6 text-slate-600">{item.excerpt}</p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <a
                  href={item.sourcePageUrl}
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1 font-semibold text-cyan-700 hover:text-cyan-900"
                >
                  元ページ <ArrowUpRight className="h-3.5 w-3.5" />
                </a>
                {item.sourceFiles.map((file) => (
                  <a
                    key={file.url}
                    href={file.url}
                    target={/^https?:\/\//.test(file.url) ? '_blank' : undefined}
                    rel={/^https?:\/\//.test(file.url) ? 'noreferrer' : undefined}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-950"
                  >
                    <FileDown className="h-3.5 w-3.5" /> {file.label}
                  </a>
                ))}
              </div>

              {item.folderIds.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.folderIds.map((folderId) => (
                    <span key={folderId} className="inline-flex items-center gap-1 bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">
                      <Folder className="h-3 w-3" /> {folderNames[folderId] ?? '不明なフォルダ'}
                    </span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
