'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useReadOnly } from '@/components/read-only-context'
import { useBackgroundJob } from '@/hooks/use-background-job'
import {
  generateRagIndex,
  getRagStatus,
  resolveRagRoute,
  type RagStatus,
} from '@/lib/rag'
import {
  ragActionPresentation,
  type RagActionState,
  type RagActionTone,
} from './rag-action-state'

export { ragActionPresentation } from './rag-action-state'

const toneClass: Record<RagActionTone, string> = {
  neutral: 'border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900',
  running: 'border-sky-300 bg-sky-50 text-sky-800',
  fresh: 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  stale: 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100',
  error: 'border-red-300 bg-red-50 text-red-800 hover:bg-red-100',
  unsupported: 'border-slate-200 bg-slate-50 text-slate-400',
}

export function RagSummaryAction({
  projectId,
  pathname,
}: {
  projectId: string
  pathname: string
}) {
  const route = useMemo(() => resolveRagRoute(pathname, projectId), [pathname, projectId])
  const { canEdit } = useReadOnly()
  const [status, setStatus] = useState<RagStatus | null>(null)
  const [state, setState] = useState<RagActionState>('LOADING')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const job = useBackgroundJob(jobId)

  const load = useCallback(async () => {
    if (!route?.supported || !route.featureType) return
    try {
      const next = await getRagStatus(projectId, route.featureType, route.targetId)
      setStatus(next)
      setState(next.state)
      setError(null)
    } catch (err) {
      setState('FAILED')
      setError(err instanceof Error ? err.message : '状態を取得できませんでした')
    }
  }, [projectId, route])

  useEffect(() => {
    setStatus(null)
    setJobId(null)
    setError(null)
    if (!route) return
    if (!route.supported) {
      setState('UNGENERATED')
      return
    }
    setState('LOADING')
    void load()
  }, [load, route])

  useEffect(() => {
    if (!job.job) return
    if (job.job.status === 'QUEUED' || job.job.status === 'RUNNING') {
      setState('RUNNING')
    } else if (job.job.status === 'SUCCEEDED') {
      setJobId(null)
      void load()
    } else if (job.job.status === 'FAILED') {
      setState('FAILED')
      setError(job.job.error || 'RAG概要の生成に失敗しました')
      setJobId(null)
    }
  }, [job.job, load])

  if (!route) return null
  const presentation = ragActionPresentation({ supported: route.supported, state, canEdit })
  const Icon = state === 'RUNNING' || state === 'LOADING'
    ? Loader2
    : state === 'FRESH'
      ? CheckCircle2
      : state === 'STALE'
        ? RefreshCw
        : state === 'FAILED'
          ? AlertTriangle
          : Sparkles

  const start = async () => {
    if (!route.supported || !route.featureType || presentation.disabled) return
    setError(null)
    setState('RUNNING')
    try {
      const result = await generateRagIndex(projectId, route.featureType, route.targetId)
      setJobId(result.jobId)
    } catch (err) {
      setState('FAILED')
      setError(err instanceof Error ? err.message : '生成を開始できませんでした')
    }
  }

  if (!route.supported) {
    return (
      <div className={`fixed bottom-5 right-5 z-40 inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-medium ${toneClass.unsupported}`}>
        <DatabaseZap className="h-3.5 w-3.5" />
        {presentation.label}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`fixed bottom-5 right-5 z-40 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-xs font-semibold shadow-[0_8px_30px_rgba(15,23,42,0.12)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${toneClass[presentation.tone]}`}
        >
          <Icon className={`h-4 w-4 ${state === 'RUNNING' || state === 'LOADING' ? 'animate-spin' : ''}`} />
          {presentation.label}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-xl overflow-hidden border-slate-200 p-0">
        <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-slate-50">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            <DatabaseZap className="h-3.5 w-3.5 text-cyan-300" />
            Retrieval index
          </div>
          <DialogHeader>
            <DialogTitle className="text-xl text-slate-50">{route.label}のRAG概要</DialogTitle>
            <DialogDescription className="text-slate-400">
              IPROくんが探しやすい全体概要とコンポーネント索引を作ります。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={toneClass[presentation.tone]}>{presentation.label}</Badge>
            {status?.documentCount ? <span className="text-xs text-slate-500">{status.documentCount} 文書</span> : null}
            {status?.generatedAt ? (
              <span className="text-xs text-slate-500">{new Date(status.generatedAt).toLocaleString('ja-JP')}</span>
            ) : null}
          </div>

          {status?.overviewSummary ? (
            <div className="border-l-2 border-slate-300 pl-4 text-sm leading-7 text-slate-700">
              {status.overviewSummary}
            </div>
          ) : (
            <p className="text-sm leading-6 text-slate-600">
              まだ索引はありません。生成すると、この機能の全体像と個別要素を検索できるようになります。
            </p>
          )}

          {status?.model ? (
            <div className="grid grid-cols-[7rem_1fr] gap-y-1 border-t border-slate-100 pt-3 text-xs">
              <span className="text-slate-400">生成モデル</span>
              <span className="font-medium text-slate-600">{status.model}</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="border-t border-slate-100 bg-slate-50 px-6 py-4">
          {!canEdit ? <span className="mr-auto self-center text-xs text-slate-500">閲覧権限では再生成できません</span> : null}
          <Button variant="outline" onClick={() => setOpen(false)}>閉じる</Button>
          <Button onClick={() => void start()} disabled={presentation.disabled}>
            {state === 'RUNNING' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {status ? '概要を再生成' : '概要を生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
