'use client'

// ナレッジグラフ 一覧編集ページ。
//   GET /api/projects/:id/knowledge/graph で取得した nodes/documents/edges を
//   表で一覧・編集する（グラフ可視化ページの「表」版）。
//
//   タブ: ノード / 文書 / 関係。
//   ・ノード: ラベル/種別/entityKind/言及数/説明を表示。編集（updateNode）、削除（deleteNode）、
//     別ノードへ統合（mergeNodes）。種別/言及数フィルタ・ラベル検索・ヘッダソート。
//   ・文書: タイトル/要約/ソース種別/原本リンク/言及数。編集（updateDocument）・削除（deleteDocument）。
//   ・関係: from→to/ラベル/種別/確信度/出典文書。ラベル・種別編集（updateRelation）・削除（deleteRelation）。
//   各操作後はグラフを再取得して表を更新。編集系の失敗はトースト表示。
//
// API クライアントは lib/knowledge.ts の knowledgeGraphApi / knowledgeEditApi を使う。

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { SortableTh } from '@/components/ui/sortable-th'
import { useTableSort } from '@/lib/use-table-sort'
import { useToast } from '@/components/ui/use-toast'
import { useReadOnly } from '@/components/read-only-context'
import {
  Brain,
  Loader2,
  RefreshCw,
  Search,
  FileStack,
  X,
  Pencil,
  Trash2,
  Merge,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  knowledgeGraphApi,
  knowledgeEditApi,
  type KnowledgeNode,
  type KnowledgeEdge,
  type KnowledgeDocument,
  type KnowledgeNodeType,
  type IngestionSourceType,
} from '@/lib/knowledge'
import {
  ENTITY_KIND_LABEL,
  ENTITY_KIND_ORDER,
  nodeColor,
  presentEntityKinds,
} from '@/components/knowledge/knowledge-graph-colors'

// ---------------------------------------------------------------------------
// 表示用ユーティリティ
// ---------------------------------------------------------------------------

const SOURCE_TYPE_LABEL: Record<IngestionSourceType, string> = {
  UPLOAD: 'アップロード',
  ATTACHMENT: '添付',
  DRIVE: 'Drive',
}

/** 種別バッジ（TAG / ENTITY）。 */
function TypeBadge({ type }: { type: KnowledgeNodeType }) {
  return type === 'TAG' ? (
    <Badge variant="secondary">タグ</Badge>
  ) : (
    <Badge variant="muted">実体</Badge>
  )
}

/** entityKind の表示ラベル（未設定は「-」）。 */
function entityKindLabel(kind: string | null): string {
  if (!kind) return '-'
  return ENTITY_KIND_LABEL[kind] ?? kind
}

/** http(s) のリンクだけ「原本」として開けるようにする（それ以外は null）。 */
function httpLink(url: string | null): string | null {
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : null
}

// entityKind の選択肢（未設定 + spec の kind 候補）。
const ENTITY_KIND_NONE = '__none__'

// ===========================================================================
// ページ本体
// ===========================================================================

export default function KnowledgeListPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const { canEdit } = useReadOnly()
  const { toast } = useToast()

  const [nodes, setNodes] = useState<KnowledgeNode[]>([])
  const [edges, setEdges] = useState<KnowledgeEdge[]>([])
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const g = await knowledgeGraphApi.getGraph(projectId)
      setNodes(g.nodes)
      setEdges(g.edges)
      setDocuments(g.documents)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ナレッジグラフの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  const isEmpty =
    !loading && nodes.length === 0 && documents.length === 0 && edges.length === 0

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            ナレッジ 一覧編集
          </span>
        }
        description="抽出したノード・文書・関係を表で一覧し、ラベルや種別の修正・統合・削除を行います。"
        help="行クリックで編集。ノードは別ノードへ統合（merge）できます。各操作後に表は自動更新されます。"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-1.5', loading && 'animate-spin')} />
            更新
          </Button>
        }
      />

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          読み込み中…
        </div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="space-y-3 py-14 text-center">
            <Brain className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <div className="text-sm text-muted-foreground">
              まだナレッジがありません。まずは取り込みで文書を読み込んでください。
            </div>
            <Link
              href={`/dashboard/projects/${projectId}/knowledge/ingestion`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <FileStack className="h-4 w-4" />
              取り込みダッシュボードへ
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="nodes">
          <TabsList>
            <TabsTrigger value="nodes">ノード（{nodes.length}）</TabsTrigger>
            <TabsTrigger value="documents">文書（{documents.length}）</TabsTrigger>
            <TabsTrigger value="relations">関係（{edges.length}）</TabsTrigger>
          </TabsList>

          <TabsContent value="nodes">
            <NodesTab
              nodes={nodes}
              canEdit={canEdit}
              toast={toast}
              reload={load}
            />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab
              documents={documents}
              canEdit={canEdit}
              toast={toast}
              reload={load}
            />
          </TabsContent>

          <TabsContent value="relations">
            <RelationsTab
              edges={edges}
              nodes={nodes}
              documents={documents}
              canEdit={canEdit}
              toast={toast}
              reload={load}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// 子タブ共通の props 補助型。
type ToastFn = ReturnType<typeof useToast>['toast']

// ===========================================================================
// ノードタブ
// ===========================================================================

const NODE_ACCESSORS: Record<
  string,
  (n: KnowledgeNode) => string | number | null | undefined
> = {
  label: (n) => n.label,
  type: (n) => n.type,
  entityKind: (n) => n.entityKind,
  mentionCount: (n) => n.mentionCount,
}

function NodesTab({
  nodes,
  canEdit,
  toast,
  reload,
}: {
  nodes: KnowledgeNode[]
  canEdit: boolean
  toast: ToastFn
  reload: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | KnowledgeNodeType>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')

  const [editing, setEditing] = useState<KnowledgeNode | null>(null)
  const [merging, setMerging] = useState<KnowledgeNode | null>(null)

  const kinds = useMemo(() => presentEntityKinds(nodes), [nodes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return nodes.filter((n) => {
      if (typeFilter !== 'all' && n.type !== typeFilter) return false
      if (kindFilter !== 'all') {
        const k = n.entityKind ?? 'OTHER'
        if (n.type !== 'ENTITY' || k !== kindFilter) return false
      }
      if (q && !n.label.toLowerCase().includes(q)) return false
      return true
    })
  }, [nodes, query, typeFilter, kindFilter])

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(
    filtered,
    NODE_ACCESSORS,
  )

  return (
    <div className="space-y-3">
      {/* フィルタ・検索 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ラベル検索…"
            className="h-9 w-52 pl-8"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="検索クリア"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as 'all' | KnowledgeNodeType)}
        >
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder="種別" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">種別: すべて</SelectItem>
            <SelectItem value="TAG">タグ</SelectItem>
            <SelectItem value="ENTITY">実体</SelectItem>
          </SelectContent>
        </Select>

        {kinds.length > 0 && (
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue placeholder="種類" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">種類: すべて</SelectItem>
              {kinds.map((k) => (
                <SelectItem key={k} value={k}>
                  {ENTITY_KIND_LABEL[k] ?? k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <span className="text-xs text-muted-foreground">{sorted.length} 件</span>
      </div>

      {/* 表 */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <SortableTh label="ラベル" sortKey="label" current={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="種別" sortKey="type" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-20" />
              <SortableTh label="種類" sortKey="entityKind" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-28" />
              <SortableTh label="言及数" sortKey="mentionCount" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-20" />
              <th className="px-3 py-2">説明</th>
              <th className="w-28 px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                  該当するノードがありません。
                </td>
              </tr>
            ) : (
              sorted.map((n) => (
                <tr
                  key={n.id}
                  onClick={() => canEdit && setEditing(n)}
                  className={cn(
                    'border-t',
                    canEdit && 'cursor-pointer hover:bg-secondary/40',
                  )}
                >
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ background: nodeColor(n) }}
                      />
                      <span className="font-medium">{n.label}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <TypeBadge type={n.type} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {n.type === 'ENTITY' ? entityKindLabel(n.entityKind) : '-'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{n.mentionCount}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">
                    {n.description || '-'}
                  </td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {canEdit && (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="統合" onClick={() => setMerging(n)}>
                          <Merge className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="編集" onClick={() => setEditing(n)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <NodeEditDialog
          node={editing}
          toast={toast}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
      {merging && (
        <NodeMergeDialog
          node={merging}
          allNodes={nodes}
          toast={toast}
          reload={reload}
          onClose={() => setMerging(null)}
        />
      )}
    </div>
  )
}

function NodeEditDialog({
  node,
  toast,
  reload,
  onClose,
}: {
  node: KnowledgeNode
  toast: ToastFn
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [label, setLabel] = useState(node.label)
  const [description, setDescription] = useState(node.description ?? '')
  const [color, setColor] = useState(node.color ?? '')
  const [type, setType] = useState<KnowledgeNodeType>(node.type)
  const [entityKind, setEntityKind] = useState<string>(
    node.entityKind ?? ENTITY_KIND_NONE,
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleSave = async () => {
    const trimmed = label.trim()
    if (!trimmed) {
      toast({ variant: 'destructive', title: 'ラベルを入力してください' })
      return
    }
    setSaving(true)
    try {
      await knowledgeEditApi.updateNode(node.id, {
        label: trimmed,
        description: description.trim() === '' ? null : description.trim(),
        color: color.trim() === '' ? null : color.trim(),
        type,
        entityKind:
          type === 'ENTITY' && entityKind !== ENTITY_KIND_NONE ? entityKind : null,
      })
      toast({ title: 'ノードを更新しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ノードの更新に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`ノード「${node.label}」を削除します。よろしいですか？`)) return
    setDeleting(true)
    try {
      await knowledgeEditApi.deleteNode(node.id)
      toast({ title: 'ノードを削除しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ノードの削除に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  const busy = saving || deleting

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ノードを編集</DialogTitle>
          <DialogDescription>ラベル・説明・色・種別を編集します。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="node-label">ラベル</Label>
            <Input
              id="node-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>種別</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as KnowledgeNodeType)}
                disabled={busy}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TAG">タグ</SelectItem>
                  <SelectItem value="ENTITY">実体</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>種類（実体）</Label>
              <Select
                value={entityKind}
                onValueChange={setEntityKind}
                disabled={busy || type !== 'ENTITY'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="未設定" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENTITY_KIND_NONE}>未設定</SelectItem>
                  {ENTITY_KIND_ORDER.map((k) => (
                    <SelectItem key={k} value={k}>
                      {ENTITY_KIND_LABEL[k] ?? k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="node-color">色（任意・空で自動）</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color.trim() === '' ? nodeColor(node) : color}
                onChange={(e) => setColor(e.target.value)}
                disabled={busy}
                className="h-9 w-12 cursor-pointer rounded border"
                aria-label="色を選択"
              />
              <Input
                id="node-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#6366f1（空で自動）"
                disabled={busy}
                className="flex-1"
              />
              {color && (
                <Button variant="ghost" size="sm" onClick={() => setColor('')} disabled={busy}>
                  自動に戻す
                </Button>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="node-desc">説明</Label>
            <Textarea
              id="node-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="destructive" onClick={handleDelete} disabled={busy}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
            削除
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function NodeMergeDialog({
  node,
  allNodes,
  toast,
  reload,
  onClose,
}: {
  node: KnowledgeNode
  allNodes: KnowledgeNode[]
  toast: ToastFn
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [targetId, setTargetId] = useState<string>('')
  const [merging, setMerging] = useState(false)
  const [query, setQuery] = useState('')

  // 統合先候補: 自分以外・同 type（別 type は backend が 400 なので候補から外す）。
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allNodes
      .filter((n) => n.id !== node.id && n.type === node.type)
      .filter((n) => (q ? n.label.toLowerCase().includes(q) : true))
  }, [allNodes, node, query])

  const handleMerge = async () => {
    if (!targetId) {
      toast({ variant: 'destructive', title: '統合先を選択してください' })
      return
    }
    setMerging(true)
    try {
      await knowledgeEditApi.mergeNodes(node.id, targetId)
      toast({ title: 'ノードを統合しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'ノードの統合に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setMerging(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !merging && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ノードを統合</DialogTitle>
          <DialogDescription>
            「{node.label}」を統合先ノードへまとめます。言及・関係は統合先に付け替えられ、
            このノードは削除されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="統合先を検索…"
              className="h-9 pl-8"
              disabled={merging}
            />
          </div>

          <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
            {candidates.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                統合先の候補がありません（同じ種別の別ノードが必要です）。
              </div>
            ) : (
              candidates.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setTargetId(n.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-secondary',
                    targetId === n.id && 'bg-primary/10 ring-1 ring-primary',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ background: nodeColor(n) }}
                  />
                  <span className="flex-1 truncate font-medium">{n.label}</span>
                  <span className="text-xs text-muted-foreground">
                    言及 {n.mentionCount}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={merging}>
            キャンセル
          </Button>
          <Button onClick={handleMerge} disabled={merging || !targetId}>
            {merging ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Merge className="h-4 w-4 mr-1.5" />}
            統合する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// 文書タブ
// ===========================================================================

const DOCUMENT_ACCESSORS: Record<
  string,
  (d: KnowledgeDocument) => string | number | null | undefined
> = {
  title: (d) => d.title,
  sourceType: (d) => d.sourceType,
}

function DocumentsTab({
  documents,
  canEdit,
  toast,
  reload,
}: {
  documents: KnowledgeDocument[]
  canEdit: boolean
  toast: ToastFn
  reload: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<KnowledgeDocument | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return documents
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (d.summary ?? '').toLowerCase().includes(q),
    )
  }, [documents, query])

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(
    filtered,
    DOCUMENT_ACCESSORS,
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="タイトル・要約検索…"
            className="h-9 w-56 pl-8"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="検索クリア"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{sorted.length} 件</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <SortableTh label="タイトル" sortKey="title" current={sortKey} dir={sortDir} onToggle={toggleSort} />
              <th className="px-3 py-2">要約</th>
              <SortableTh label="ソース種別" sortKey="sourceType" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-28" />
              <th className="w-20 px-3 py-2">原本</th>
              <th className="w-24 px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted-foreground">
                  該当する文書がありません。
                </td>
              </tr>
            ) : (
              sorted.map((d) => {
                const link = httpLink(d.blobUrl)
                return (
                  <tr
                    key={d.id}
                    onClick={() => canEdit && setEditing(d)}
                    className={cn(
                      'border-t',
                      canEdit && 'cursor-pointer hover:bg-secondary/40',
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{d.title}</td>
                    <td className="max-w-md truncate px-3 py-2 text-muted-foreground">
                      {d.summary || '-'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {SOURCE_TYPE_LABEL[d.sourceType] ?? d.sourceType}
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          開く
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="編集" onClick={() => setEditing(d)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <DocumentEditDialog
          document={editing}
          toast={toast}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function DocumentEditDialog({
  document: doc,
  toast,
  reload,
  onClose,
}: {
  document: KnowledgeDocument
  toast: ToastFn
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(doc.title)
  const [summary, setSummary] = useState(doc.summary ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const busy = saving || deleting

  const handleSave = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      toast({ variant: 'destructive', title: 'タイトルを入力してください' })
      return
    }
    setSaving(true)
    try {
      await knowledgeEditApi.updateDocument(doc.id, {
        title: trimmed,
        summary: summary.trim() === '' ? null : summary.trim(),
      })
      toast({ title: '文書を更新しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: '文書の更新に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (
      !window.confirm(
        `文書「${doc.title}」を削除します。この文書から抽出された言及も削除されます。よろしいですか？`,
      )
    )
      return
    setDeleting(true)
    try {
      await knowledgeEditApi.deleteDocument(doc.id)
      toast({ title: '文書を削除しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: '文書の削除に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>文書を編集</DialogTitle>
          <DialogDescription>タイトルと要約を編集します。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">タイトル</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-summary">要約</Label>
            <Textarea
              id="doc-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={5}
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="destructive" onClick={handleDelete} disabled={busy}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
            削除
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ===========================================================================
// 関係タブ
// ===========================================================================

function RelationsTab({
  edges,
  nodes,
  documents,
  canEdit,
  toast,
  reload,
}: {
  edges: KnowledgeEdge[]
  nodes: KnowledgeNode[]
  documents: KnowledgeDocument[]
  canEdit: boolean
  toast: ToastFn
  reload: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<KnowledgeEdge | null>(null)

  const nodeById = useMemo(
    () => new Map(nodes.map((n) => [n.id, n] as const)),
    [nodes],
  )
  const docById = useMemo(
    () => new Map(documents.map((d) => [d.id, d] as const)),
    [documents],
  )

  const labelOf = useCallback(
    (id: string) => nodeById.get(id)?.label ?? '(不明なノード)',
    [nodeById],
  )

  const accessors = useMemo<
    Record<string, (e: KnowledgeEdge) => string | number | null | undefined>
  >(
    () => ({
      from: (e) => nodeById.get(e.fromNodeId)?.label,
      to: (e) => nodeById.get(e.toNodeId)?.label,
      label: (e) => e.label,
      type: (e) => e.type,
      confidence: (e) => e.confidence,
    }),
    [nodeById],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return edges
    return edges.filter((e) => {
      const from = labelOf(e.fromNodeId).toLowerCase()
      const to = labelOf(e.toNodeId).toLowerCase()
      const lbl = (e.label ?? '').toLowerCase()
      const typ = (e.type ?? '').toLowerCase()
      return (
        from.includes(q) || to.includes(q) || lbl.includes(q) || typ.includes(q)
      )
    })
  }, [edges, query, labelOf])

  const { sorted, sortKey, sortDir, toggleSort } = useTableSort(filtered, accessors)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ノード・ラベル・種別で検索…"
            className="h-9 w-64 pl-8"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="検索クリア"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <span className="text-xs text-muted-foreground">{sorted.length} 件</span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <SortableTh label="from" sortKey="from" current={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="to" sortKey="to" current={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="ラベル" sortKey="label" current={sortKey} dir={sortDir} onToggle={toggleSort} />
              <SortableTh label="種別" sortKey="type" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-28" />
              <SortableTh label="確信度" sortKey="confidence" current={sortKey} dir={sortDir} onToggle={toggleSort} className="w-20" />
              <th className="px-3 py-2">出典文書</th>
              <th className="w-20 px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                  該当する関係がありません。
                </td>
              </tr>
            ) : (
              sorted.map((e) => {
                const doc = e.sourceDocumentId ? docById.get(e.sourceDocumentId) : null
                return (
                  <tr
                    key={e.id}
                    onClick={() => canEdit && setEditing(e)}
                    className={cn(
                      'border-t',
                      canEdit && 'cursor-pointer hover:bg-secondary/40',
                    )}
                  >
                    <td className="px-3 py-2 font-medium">{labelOf(e.fromNodeId)}</td>
                    <td className="px-3 py-2 font-medium">{labelOf(e.toNodeId)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.label || '-'}</td>
                    <td className="px-3 py-2 text-muted-foreground">{e.type || '-'}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {e.confidence != null ? e.confidence.toFixed(2) : '-'}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-muted-foreground">
                      {doc ? doc.title : '-'}
                    </td>
                    <td className="px-3 py-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="編集" onClick={() => setEditing(e)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <RelationEditDialog
          relation={editing}
          fromLabel={labelOf(editing.fromNodeId)}
          toLabel={labelOf(editing.toNodeId)}
          toast={toast}
          reload={reload}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function RelationEditDialog({
  relation,
  fromLabel,
  toLabel,
  toast,
  reload,
  onClose,
}: {
  relation: KnowledgeEdge
  fromLabel: string
  toLabel: string
  toast: ToastFn
  reload: () => Promise<void>
  onClose: () => void
}) {
  const [label, setLabel] = useState(relation.label ?? '')
  const [type, setType] = useState(relation.type ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const busy = saving || deleting

  const handleSave = async () => {
    setSaving(true)
    try {
      await knowledgeEditApi.updateRelation(relation.id, {
        label: label.trim() === '' ? null : label.trim(),
        type: type.trim() === '' ? null : type.trim(),
      })
      toast({ title: '関係を更新しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: '関係の更新に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm('この関係を削除します。よろしいですか？')) return
    setDeleting(true)
    try {
      await knowledgeEditApi.deleteRelation(relation.id)
      toast({ title: '関係を削除しました' })
      onClose()
      await reload()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: '関係の削除に失敗しました',
        description: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>関係を編集</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{fromLabel}</span>
            {' → '}
            <span className="font-medium text-foreground">{toLabel}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="rel-label">ラベル</Label>
            <Input
              id="rel-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例: 含む / 担当する"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rel-type">種別</Label>
            <Input
              id="rel-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="例: RELATED_TO"
              disabled={busy}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="destructive" onClick={handleDelete} disabled={busy}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
            削除
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              保存
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
