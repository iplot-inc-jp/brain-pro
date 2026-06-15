'use client'

// 取り込みバッチ詳細（ファイル行ステータス）。
//   上部: [再開][全リトライ][キャンセル]。
//   FileStatusTable: 行ごと status/step/進捗/試行/エラー展開/[リトライ][スキップ][原本]。
//                    ZIP は子ファイルをぶら下げた展開可能行。
//   実行中は 4 秒ポーリングで進捗更新。

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useReadOnly } from '@/components/read-only-context'
import { FileStatusTable } from '@/components/knowledge/FileStatusTable'
import {
  Brain,
  Loader2,
  Play,
  RotateCw,
  XCircle,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  ingestionApi,
  BATCH_STATUS_LABEL,
  isBatchTerminal,
  type IngestionBatchDetail,
  type IngestionBatchStatus,
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

export default function IngestionBatchDetailPage() {
  const params = useParams()
  const projectId = params.projectId as string
  const batchId = params.batchId as string
  const { canEdit } = useReadOnly()

  const [batch, setBatch] = useState<IngestionBatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // ポーリング中の再入を避ける
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const data = await ingestionApi.getBatch(batchId)
      setBatch(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'バッチ詳細の取得に失敗しました')
    } finally {
      inFlight.current = false
    }
  }, [batchId])

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      setLoading(true)
      await load()
      if (!cancelled) setLoading(false)
    }
    init()
    return () => {
      cancelled = true
    }
  }, [load])

  // 実行中は 4 秒ポーリング
  useEffect(() => {
    if (!batch) return
    const active =
      !isBatchTerminal(batch.status) ||
      batch.files.some(
        (f) =>
          f.status !== 'SUCCEEDED' &&
          f.status !== 'FAILED' &&
          f.status !== 'SKIPPED',
      )
    if (!active) return
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [batch, load])

  const withBusy = async (fn: () => Promise<unknown>, errMsg: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : errMsg)
    } finally {
      setBusy(false)
    }
  }

  const handleResume = () =>
    withBusy(() => ingestionApi.resumeBatch(batchId), 'バッチの再開に失敗しました')

  const handleCancel = () =>
    withBusy(
      () => ingestionApi.cancelBatch(batchId),
      'バッチのキャンセルに失敗しました',
    )

  const handleRetryAll = () =>
    withBusy(async () => {
      const failed = (batch?.files ?? []).filter((f) => f.status === 'FAILED')
      for (const f of failed) {
        await ingestionApi.retryFile(f.id)
      }
    }, '全リトライに失敗しました')

  const handleRetry = (id: string) =>
    withBusy(() => ingestionApi.retryFile(id), 'リトライに失敗しました')

  const handleSkip = (id: string) =>
    withBusy(() => ingestionApi.skipFile(id), 'スキップに失敗しました')

  const failedCount =
    batch?.files.filter((f) => f.status === 'FAILED').length ?? 0
  const canCancel =
    canEdit && batch != null && !isBatchTerminal(batch.status)

  return (
    <div className="space-y-5">
      <PageHeader
        backHref={`/dashboard/projects/${projectId}/knowledge/ingestion`}
        backLabel="取り込み一覧へ"
        title={
          <span className="inline-flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            {batch?.name || 'バッチ詳細'}
            {batch && (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                  BATCH_STATUS_STYLE[batch.status],
                )}
              >
                {!isBatchTerminal(batch.status) && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {BATCH_STATUS_LABEL[batch.status]}
              </span>
            )}
          </span>
        }
        description={
          batch
            ? `全 ${batch.totalFiles} 件 / 完了 ${batch.succeededFiles} / 失敗 ${batch.failedFiles} / 待機 ${batch.pendingFiles}`
            : undefined
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={busy}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              更新
            </Button>
            {canEdit && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResume}
                  disabled={busy}
                  title="未処理・失敗・停止中を再投入"
                >
                  <Play className="h-4 w-4 mr-1.5" />
                  再開
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetryAll}
                  disabled={busy || failedCount === 0}
                  title="失敗したファイルを全てリトライ"
                >
                  <RotateCw className="h-4 w-4 mr-1.5" />
                  全リトライ
                  {failedCount > 0 && (
                    <span className="ml-1">({failedCount})</span>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleCancel}
                  disabled={busy || !canCancel}
                >
                  <XCircle className="h-4 w-4 mr-1.5" />
                  キャンセル
                </Button>
              </>
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
      ) : !batch ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            バッチが見つかりません。
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-3">
            <FileStatusTable
              files={batch.files}
              busy={busy}
              canEdit={canEdit}
              onRetry={handleRetry}
              onSkip={handleSkip}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
