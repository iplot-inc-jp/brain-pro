'use client'

// ナレッジ取り込みダッシュボード（バッチ一覧 ＋ 新規バッチ作成）。
//   一覧: status バッジ・件数・作成日。行クリックで詳細へ。
//   新規バッチ: NewBatchDialog（アップロード（ZIP可・複数）/既存添付選択 → 開始）。

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useReadOnly } from '@/components/read-only-context'
import { NewBatchDialog } from '@/components/knowledge/NewBatchDialog'
import {
  Brain,
  Plus,
  Loader2,
  FileStack,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ingestionApi,
  knowledgeSettingsApi,
  BATCH_STATUS_LABEL,
  isBatchTerminal,
  type IngestionBatch,
  type IngestionBatchStatus,
  type ProjectKnowledgeSettings,
} from '@/lib/knowledge'

const BATCH_STATUS_STYLE: Record<IngestionBatchStatus, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  EXPANDING: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-indigo-100 text-indigo-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  SUCCEEDED: 'bg-emerald-100 text-emerald-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function IngestionDashboardPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.projectId as string
  const { canEdit } = useReadOnly()

  const [batches, setBatches] = useState<IngestionBatch[]>([])
  const [settings, setSettings] = useState<ProjectKnowledgeSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await ingestionApi.listBatches(projectId)
      setBatches(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'バッチ一覧の取得に失敗しました')
    }
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setLoading(true)
      // 設定はベストエフォート（バッチ一覧が主）
      try {
        const s = await knowledgeSettingsApi.get(projectId)
        if (!cancelled) setSettings(s)
      } catch {
        /* 設定は既定値で扱う */
      }
      await load()
      if (!cancelled) setLoading(false)
    }
    init()
    return () => {
      cancelled = true
    }
  }, [projectId, load])

  // 実行中バッチがある間は 4 秒ポーリングで一覧を更新
  useEffect(() => {
    const hasActive = batches.some((b) => !isBatchTerminal(b.status))
    if (!hasActive) return
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [batches, load])

  const handleCreated = (batchId: string) => {
    setDialogOpen(false)
    load()
    router.push(
      `/dashboard/projects/${projectId}/knowledge/ingestion/${batchId}`,
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            ナレッジ取り込み
          </span>
        }
        description="文書ファイル群（アップロード・ZIP・既存添付）をバッチで読み、AI でナレッジグラフへ取り込みます。"
        help="各ファイル単位でステータス・試行回数・エラーを保存します。失敗は個別リトライ・バッチ再開できます。"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
            {canEdit && (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                新規バッチ
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          読み込み中…
        </div>
      ) : batches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <FileStack className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <div className="text-sm text-muted-foreground">
              まだ取り込みバッチがありません。
            </div>
            {canEdit && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                最初のバッチを作成
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {batches.map((b) => (
            <Link
              key={b.id}
              href={`/dashboard/projects/${projectId}/knowledge/ingestion/${b.id}`}
              className="block"
            >
              <Card className="hover:border-primary/50 transition-colors">
                <CardContent className="py-3.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {b.name || '（無題のバッチ）'}
                      </span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
                          BATCH_STATUS_STYLE[b.status],
                        )}
                      >
                        {!isBatchTerminal(b.status) && (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        {BATCH_STATUS_LABEL[b.status]}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      作成: {formatDate(b.createdAt)}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                    <div>
                      全 {b.totalFiles} 件 / 完了 {b.succeededFiles} / 失敗{' '}
                      {b.failedFiles}
                    </div>
                    <div className="mt-1 h-1.5 w-32 rounded-full bg-secondary overflow-hidden ml-auto">
                      <div
                        className="h-full bg-emerald-500"
                        style={{
                          width: `${
                            b.totalFiles > 0
                              ? Math.round((b.succeededFiles / b.totalFiles) * 100)
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewBatchDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        projectId={projectId}
        settings={settings}
        onCreated={handleCreated}
      />
    </div>
  )
}
