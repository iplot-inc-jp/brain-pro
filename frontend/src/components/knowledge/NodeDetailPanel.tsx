'use client'

// ナレッジグラフの右パネル。
//   ノード選択時: GET /api/knowledge-nodes/:id（mentions / outRelations / inRelations 込み）を取得し、
//     label / kind / description / 出典文書＋snippet / 関連ノード を表示。
//   文書選択時: グラフ取得済みの KnowledgeDocument から 要約＋原本リンク（http(s) のみ）を表示。
//
// API は frontend/src/lib/knowledge.ts に node-detail / search が無いため、ここで raw fetch する
// （token=localStorage 'accessToken'、API_URL と '/api...' を結合：既存 lib 慣習）。

import { useEffect, useRef, useState } from 'react'
import {
  X,
  Loader2,
  Tag as TagIcon,
  Box,
  FileText,
  ExternalLink,
  ArrowRight,
  ArrowLeft,
  RotateCw,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  KnowledgeNode,
  KnowledgeDocument,
  KnowledgeDocumentPage,
} from '@/lib/knowledge'
import {
  getKnowledgeDocumentPages,
  retryKnowledgeDocumentPage,
} from '@/lib/knowledge'
import {
  ENTITY_KIND_COLOR,
  ENTITY_KIND_LABEL,
  TAG_COLOR,
  nodeColor,
} from './knowledge-graph-colors'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5021'

// ---------------------------------------------------------------------------
// node-detail のレスポンス型（backend KnowledgeNodeDetailOutput と一致）
// ---------------------------------------------------------------------------

interface KnowledgeMentionDetail {
  id: string
  documentId: string
  nodeId: string
  relevance: number | null
  snippet: string | null
  documentTitle: string
  documentBlobUrl: string | null
}

interface KnowledgeEdgeDetail {
  id: string
  projectId: string
  fromNodeId: string
  toNodeId: string
  label: string | null
  type: string | null
  confidence: number | null
  sourceDocumentId: string | null
}

export interface KnowledgeNodeDetail {
  node: KnowledgeNode
  mentions: KnowledgeMentionDetail[]
  outRelations: KnowledgeEdgeDetail[]
  inRelations: KnowledgeEdgeDetail[]
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {}
  const t =
    typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null
  if (t) h['Authorization'] = `Bearer ${t}`
  return h
}

async function fetchNodeDetail(id: string): Promise<KnowledgeNodeDetail> {
  const res = await fetch(`${API_URL}/api/knowledge-nodes/${id}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('ノード詳細の取得に失敗しました')
  return res.json() as Promise<KnowledgeNodeDetail>
}

/**
 * 絶対 http(s) URL のときだけ開く。
 *   - base 無しで parse するので相対パスは無効（API_URL に解決しない）。
 *     → blobUrl が Drive ref（'drive:...' 等）や相対値でも誤って踏ませない。
 *   - スキームは http/https のみ許可（javascript:/data: 等を弾く）。
 */
function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    // base を渡さない＝相対 URL はここで例外になり null を返す。
    const u = new URL(url)
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href
  } catch {
    /* 不正 URL・相対 URL は無効扱い */
  }
  return null
}

// ---------------------------------------------------------------------------
// 共通: パネルの外枠
// ---------------------------------------------------------------------------

function PanelShell({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="absolute right-0 top-0 z-20 h-full w-80 max-w-[85vw] border-l bg-white shadow-xl flex flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <span className="text-sm font-semibold text-foreground">詳細</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-secondary"
          aria-label="閉じる"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ノード詳細
// ---------------------------------------------------------------------------

interface NodeDetailPanelProps {
  /** 選択中ノード（一覧由来。詳細は API で上書き取得）。 */
  selectedNode: KnowledgeNode | null
  /** 選択中文書（一覧由来）。 */
  selectedDocument: KnowledgeDocument | null
  /** グラフ全体のノード（関連ノードのラベル解決に使う）。 */
  nodeById: Map<string, KnowledgeNode>
  /** 別ノードへジャンプ（関連ノードクリック）。 */
  onSelectNode: (id: string) => void
  /** 文書へジャンプ（出典文書クリック）。 */
  onSelectDocument: (id: string) => void
  onClose: () => void
}

export function NodeDetailPanel({
  selectedNode,
  selectedDocument,
  nodeById,
  onSelectNode,
  onSelectDocument,
  onClose,
}: NodeDetailPanelProps) {
  const [detail, setDetail] = useState<KnowledgeNodeDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<KnowledgeDocumentPage[]>([])
  const [pagesLoading, setPagesLoading] = useState(false)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [retryingPageId, setRetryingPageId] = useState<string | null>(null)
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set())
  const activeDocumentId = useRef<string | null>(selectedDocument?.id ?? null)
  const documentGeneration = useRef(0)
  const pageRequest = useRef<AbortController | null>(null)
  const retryRequest = useRef<AbortController | null>(null)
  activeDocumentId.current = selectedDocument?.id ?? null

  useEffect(() => {
    if (!selectedNode) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    fetchNodeDetail(selectedNode.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'ノード詳細の取得に失敗しました')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedNode])

  const isActiveDocument = (documentId: string, generation: number) =>
    activeDocumentId.current === documentId &&
    documentGeneration.current === generation

  const loadPages = async (
    documentId: string,
    generation: number,
    signal: AbortSignal,
  ) => {
    if (!isActiveDocument(documentId, generation)) return
    setPagesLoading(true)
    setPagesError(null)
    try {
      const result = await getKnowledgeDocumentPages(documentId, { signal })
      if (!signal.aborted && isActiveDocument(documentId, generation)) {
        setPages(result)
      }
    } catch (e) {
      if (!signal.aborted && isActiveDocument(documentId, generation)) {
        setPagesError(
          e instanceof Error ? e.message : 'ページ抽出結果の取得に失敗しました',
        )
      }
    } finally {
      if (!signal.aborted && isActiveDocument(documentId, generation)) {
        setPagesLoading(false)
      }
    }
  }

  useEffect(() => {
    const generation = ++documentGeneration.current
    pageRequest.current?.abort()
    retryRequest.current?.abort()
    setPages([])
    setPagesError(null)
    setPagesLoading(false)
    setRetryingPageId(null)
    setExpandedPages(new Set())
    if (!selectedDocument) {
      return
    }
    const controller = new AbortController()
    pageRequest.current = controller
    void loadPages(selectedDocument.id, generation, controller.signal)
    return () => {
      controller.abort()
    }
  }, [selectedDocument?.id])

  const retryPage = async (page: KnowledgeDocumentPage) => {
    if (!selectedDocument || page.status !== 'FAILED' || !page.retryable) return
    const documentId = selectedDocument.id
    const generation = documentGeneration.current
    retryRequest.current?.abort()
    const controller = new AbortController()
    retryRequest.current = controller
    setRetryingPageId(page.id)
    setPagesError(null)
    try {
      await retryKnowledgeDocumentPage(page.id, { signal: controller.signal })
      if (controller.signal.aborted || !isActiveDocument(documentId, generation)) {
        return
      }
      pageRequest.current?.abort()
      const reloadController = new AbortController()
      pageRequest.current = reloadController
      await loadPages(documentId, generation, reloadController.signal)
    } catch (e) {
      if (!controller.signal.aborted && isActiveDocument(documentId, generation)) {
        setPagesError(
          e instanceof Error ? e.message : 'ページの再試行に失敗しました',
        )
      }
    } finally {
      if (isActiveDocument(documentId, generation)) {
        setRetryingPageId(null)
      }
    }
  }

  // ---- 文書詳細 ----
  if (selectedDocument) {
    const link = safeHttpUrl(selectedDocument.blobUrl)
    return (
      <PanelShell onClose={onClose}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-500 shrink-0" />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              文書
            </span>
          </div>
          <h3 className="text-base font-semibold break-words">
            {selectedDocument.title}
          </h3>
          {selectedDocument.mimeType && (
            <div className="text-xs text-muted-foreground">
              {selectedDocument.mimeType}
            </div>
          )}
        </div>

        <Section title="要約">
          {selectedDocument.summary ? (
            <p className="whitespace-pre-wrap text-sm text-foreground/90">
              {selectedDocument.summary}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">（要約なし）</p>
          )}
        </Section>

        <Section title="原本">
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline break-all"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              原本を開く
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">
              原本リンクがありません。
            </p>
          )}
        </Section>

        <Section title="ページごとの抽出内容">
          {pagesError && (
            <p role="alert" className="text-xs text-destructive">
              {pagesError}
            </p>
          )}
          {pagesLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              読み込み中…
            </div>
          ) : pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              ページ単位の抽出結果はありません。
            </p>
          ) : (
            <ol className="space-y-2">
              {pages.map((page) => {
                const label = `${
                  page.pageKind === 'PPTX_SLIDE' ? 'スライド' : 'ページ'
                } ${page.pageNumber}`
                const text = page.contentText?.trim() ?? ''
                const isLong = text.length > 320
                const expanded = expandedPages.has(page.id)
                return (
                  <li
                    key={page.id}
                    className="rounded-md border border-border bg-slate-50/50 p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">
                        {label}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] font-medium',
                          page.status === 'FAILED'
                            ? 'text-destructive'
                            : page.status === 'SUCCEEDED'
                              ? 'text-emerald-700'
                              : 'text-muted-foreground',
                        )}
                      >
                        {page.status === 'FAILED'
                          ? '失敗'
                          : page.status === 'SUCCEEDED'
                            ? '抽出済み'
                            : '処理中'}
                      </span>
                    </div>
                    {page.summary?.trim() && (
                      <p className="mt-1.5 text-xs text-foreground/80 whitespace-pre-wrap">
                        {page.summary}
                      </p>
                    )}
                    {page.status === 'FAILED' ? (
                      <div className="mt-2 space-y-2">
                        {page.error && (
                          <p className="flex items-start gap-1 text-xs text-destructive">
                            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{page.error}</span>
                          </p>
                        )}
                        {page.retryable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 min-h-11 min-w-11 px-2 text-xs"
                            disabled={retryingPageId === page.id}
                            onClick={() => void retryPage(page)}
                            aria-label={`${selectedDocument.title} ${label}を再試行`}
                          >
                            {retryingPageId === page.id ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : (
                              <RotateCw className="mr-1 h-3 w-3" />
                            )}
                            再試行
                          </Button>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            自動再試行中、または現在は再試行できません。
                          </p>
                        )}
                      </div>
                    ) : text ? (
                      <div className="mt-2">
                        <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                          {isLong && !expanded ? `${text.slice(0, 320)}…` : text}
                        </p>
                        {isLong && (
                          <button
                            type="button"
                            className="mt-1 text-xs font-medium text-primary hover:underline"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedPages((current) => {
                                const next = new Set(current)
                                if (next.has(page.id)) next.delete(page.id)
                                else next.add(page.id)
                                return next
                              })
                            }
                          >
                            {expanded ? '折りたたむ' : '全文を表示'}
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        抽出内容なし
                      </p>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </Section>
      </PanelShell>
    )
  }

  // ---- ノード詳細 ----
  if (!selectedNode) return null

  const node = detail?.node ?? selectedNode
  const isTag = node.type === 'TAG'
  const color = nodeColor(node)
  const kindLabel = isTag
    ? 'タグ'
    : ENTITY_KIND_LABEL[node.entityKind ?? 'OTHER'] ??
      node.entityKind ??
      '実体'

  const relations = detail
    ? [
        ...detail.outRelations.map((r) => ({
          ...r,
          dir: 'out' as const,
          otherId: r.toNodeId,
        })),
        ...detail.inRelations.map((r) => ({
          ...r,
          dir: 'in' as const,
          otherId: r.fromNodeId,
        })),
      ]
    : []

  return (
    <PanelShell onClose={onClose}>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {isTag ? (
            <TagIcon className="h-4 w-4 shrink-0" style={{ color }} />
          ) : (
            <Box className="h-4 w-4 shrink-0" style={{ color }} />
          )}
          <span
            className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
            style={{ background: color }}
          >
            {kindLabel}
          </span>
          <span className="text-[11px] text-muted-foreground">
            言及 {node.mentionCount} 件
          </span>
        </div>
        <h3 className="text-base font-semibold break-words">{node.label}</h3>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {node.description && (
        <Section title="説明">
          <p className="whitespace-pre-wrap text-sm text-foreground/90">
            {node.description}
          </p>
        </Section>
      )}

      <Section title="出典文書">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            読み込み中…
          </div>
        ) : detail && detail.mentions.length > 0 ? (
          <ul className="space-y-2">
            {detail.mentions.map((m) => (
              <li key={m.id} className="rounded-md border bg-slate-50/60 p-2">
                <button
                  onClick={() => onSelectDocument(m.documentId)}
                  className="flex w-full items-center gap-1.5 text-left text-sm font-medium text-foreground hover:text-primary"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  <span className="truncate">{m.documentTitle}</span>
                </button>
                {m.snippet && (
                  <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                    {m.snippet}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            （出典文書はありません）
          </p>
        )}
      </Section>

      <Section title="関連ノード">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            読み込み中…
          </div>
        ) : relations.length > 0 ? (
          <ul className="space-y-1">
            {relations.map((r) => {
              const other = nodeById.get(r.otherId)
              return (
                <li key={`${r.id}-${r.dir}`}>
                  <button
                    onClick={() => onSelectNode(r.otherId)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-secondary"
                  >
                    {r.dir === 'out' ? (
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-indigo-600" />
                    )}
                    {r.label && (
                      <span className="shrink-0 rounded bg-slate-100 px-1 text-[11px] text-slate-600">
                        {r.label}
                      </span>
                    )}
                    <span className="truncate">
                      {other?.label ?? '(不明なノード)'}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            （関連ノードはありません）
          </p>
        )}
      </Section>
    </PanelShell>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
        )}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

// 色定数を再エクスポート（page から個別 import を避けたい場合の利便）
export { ENTITY_KIND_COLOR, ENTITY_KIND_LABEL, TAG_COLOR }
